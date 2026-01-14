// lib/ocrPost.ts
// Step 3/4/5: OCR post-processing (input-assist only).
// Scope: NO nutrient mapping, NO per-serve/per-100g logic, NO UI wiring.
//
// MVP POLICY: ship WITHOUT Daily Values.
// - Skip DV boilerplate/table lines.
// - Drop % candidates entirely.

type Vertex = { x?: number; y?: number };

type OcrItem = {
  text: string;
  boundingBox: Vertex[]; // vertices (usually 4)
};

type OcrResultLike = {
  fullText: string;
  items: OcrItem[];
};

export type ValueUnitCandidate = {
  raw: string; // e.g. "300mg", "13 g", "5%"
  value: number;
  unit: string; // "mg" | "g" | "kJ" | "kcal" | "%" | "" (unitless)
  line: string;
  lineIndex: number;
  tokenIndex?: number; // where the value begins in tokens (if token-based)
};

export type LabeledValueUnitCandidate = ValueUnitCandidate & {
  label: string;
};

export type LabelRow = {
  label: string;
  primary: LabeledValueUnitCandidate;
  alternates: LabeledValueUnitCandidate[];
};

type Token = {
  text: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  yMid: number;
  h: number;
};

export type ServingMeta = {
  servingSize: { value: number; unit: "g" | "ml" | "" } | null;
  servingsPerPack: number | null;
};

function finite(n: unknown, fallback = 0): number {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function tokenFromItem(it: OcrItem): Token | null {
  const text = (it.text ?? "").trim();
  if (!text) return null;

  const verts = Array.isArray(it.boundingBox) ? it.boundingBox : [];
  if (verts.length === 0) return null;

  const xs = verts.map((v) => finite(v.x, 0));
  const ys = verts.map((v) => finite(v.y, 0));

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  const h = Math.max(1, yMax - yMin);
  const yMid = (yMin + yMax) / 2;

  return { text, xMin, xMax, yMin, yMax, yMid, h };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const a = [...nums].sort((p, q) => p - q);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

type BuiltLine = {
  text: string;
  tokens: Token[];
};

function buildLinesFromTokens(tokens: Token[]): BuiltLine[] {
  if (tokens.length === 0) return [];

  const medH = median(tokens.map((t) => t.h).filter((h) => h > 0)) || 10;
  const yTol = Math.max(6, medH * 0.6);

  const sorted = [...tokens].sort((a, b) => (a.yMid - b.yMid) || (a.xMin - b.xMin));

  type LineAcc = { yRef: number; tokens: Token[] };
  const lines: LineAcc[] = [];

  for (const t of sorted) {
    let bestIdx = -1;
    let bestDy = Infinity;

    for (let i = 0; i < lines.length; i++) {
      const dy = Math.abs(t.yMid - lines[i].yRef);
      if (dy < bestDy) {
        bestDy = dy;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1 && bestDy <= yTol) {
      const line = lines[bestIdx];
      line.tokens.push(t);
      line.yRef = (line.yRef * (line.tokens.length - 1) + t.yMid) / line.tokens.length;
    } else {
      lines.push({ yRef: t.yMid, tokens: [t] });
    }
  }

  return lines
    .sort((a, b) => a.yRef - b.yRef)
    .map((line) => {
      const lineTokens = [...line.tokens].sort((a, b) => a.xMin - b.xMin);
      const text = lineTokens
        .map((t) => t.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return { text, tokens: lineTokens };
    })
    .filter((l) => l.text.length > 0);
}

function normalizeUnit(u: string): string {
  const s = (u || "").trim();
  if (!s) return "";
  if (/^kj$/i.test(s)) return "kJ";
  if (/^kcal$/i.test(s)) return "kcal";
  if (s === "µg") return "mcg";
  return s.toLowerCase(); // mg, g, %, kg, mcg, ug, cal
}

function normalizeLineForExtraction(line: string): string {
  // Remove thousands separators: 2,000 -> 2000
  let s = line.replace(/(\d),(?=\d{3}\b)/g, "$1");
  // Common OCR: "Omg" -> "0mg"
  s = s.replace(/\bO\s*mg\b/gi, "0mg");
  return s;
}

function normalizeTokenTextForExtraction(tokenText: string): string {
  let s = tokenText.trim();
  s = s.replace(/(\d),(?=\d{3}\b)/g, "$1");
  s = s.replace(/\bO\s*mg\b/gi, "0mg");
  return s;
}

function isNumberOnly(s: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(s);
}

function isUnitOnly(s: string): boolean {
  // Keep % as a boundary token for parsing, but we DROP % candidates later.
  return /^(mg|g|kg|mcg|µg|ug|kj|kcal|cal|ml|%)$/i.test(s.trim());
}

function tokenHasDigits(s: string): boolean {
  return /\d/.test(s);
}

function isConnectorToken(s: string): boolean {
  const t = s.trim();
  return t === "," || t === "-" || t === "–" || t === "—" || t === ":" || t === "/" || t === ".";
}

function isWordLikeToken(s: string): boolean {
  // "Fat," "Carbohydrate" "-sugars" etc.
  const t = s.trim();
  if (!t) return false;
  if (isUnitOnly(t)) return false;
  if (tokenHasDigits(t)) return false;
  return /[A-Za-z]/.test(t);
}

/**
 * DV boilerplate/table lines are high-noise and not shipped in MVP.
 */
function isDailyValuesNoise(originalLineText: string): boolean {
  const s = normalizeLineForExtraction(originalLineText).toLowerCase();

  // DV boilerplate
  if (s.includes("daily value")) return true;
  if (s.includes("daily values")) return true;
  if (s.includes("percent daily values")) return true;
  if (s.includes("calorie diet")) return true;
  if (s.includes("caloric needs")) return true;
  if (s.includes("your daily values")) return true;

  // DV table patterns
  if (s.startsWith("calories :")) return true;
  
  if (s.includes("calories per gram")) return true;

  return false;
}

/**
 * Column/header lines that often create junk rows.
 */
function isHeaderNoise(originalLineText: string): boolean {
  const s = normalizeLineForExtraction(originalLineText).toLowerCase();

  // Common AU header
  if (s.includes("avg.") && s.includes("quantity")) return true;
  if (s.includes("avg") && s.includes("quantity")) return true;

  if (s.includes("per 100")) return true;
  if (s.includes("per serving per")) return true;

  // Generic header-ish
  if (s.trim() === "nutrition information") return true;
  if (s.trim() === "nutrition facts") return true;

  return false;
}

function dropPercentCandidates<T extends ValueUnitCandidate>(arr: T[]): T[] {
  return arr.filter((c) => c.unit !== "%" && !c.raw.includes("%"));
}

/**
 * Clean label: remove trailing punctuation/connectors, and prevent digits/unit fragments
 */
function cleanLabel(label: string): string {
  let s = label.replace(/\s+/g, " ").trim();

  // Strip common OCR prefixes / line-number artifacts: "USE Protein", "BY -saturated", "19 Dietary fibre"
  s = s.replace(/^(use|by)\s+/i, "");
  s = s.replace(/^\d+\s+/, "");
  s = s.replace(/^[:\-–—]+\s*/, "");

  // Trim trailing connectors/punct
  s = s.replace(/[\s,:.\-–—/]+$/g, "").trim();

  // Hard rule: no digits in labels
  if (/\d/.test(s)) return "";

  // Normalize common casing
  if (/^serving\s*size$/i.test(s)) return "Serving Size";
  if (/^servings\s*per\s*(package|pack|container)$/i.test(s)) return "Servings per package";

  return s;
}

function extractLabelFromTokens(lineTokens: Token[], startIdx: number): string {
  // Walk left, collecting a phrase of [word | connector] tokens,
  // stopping once we hit number/unit territory after collection begins.
  const collected: string[] = [];
  let started = false;

  for (let i = startIdx - 1; i >= 0; i--) {
    const raw = normalizeTokenTextForExtraction(lineTokens[i].text);
    const t = raw.trim();
    const compact = t.replace(/\s+/g, "");

    const isNumOrValueUnit =
      isNumberOnly(compact) ||
      /^(\d+(?:\.\d+)?)(mg|g|kg|mcg|µg|ug|kj|kcal|cal|ml|%)$/i.test(compact) ||
      isUnitOnly(compact);

    const isWord = isWordLikeToken(t);
    const isConn = isConnectorToken(t);

    if (!started) {
      if (isWord) {
        started = true;
        collected.push(t);
        continue;
      }
      // keep skipping until we hit the first word
      continue;
    }

    // started
    if (isNumOrValueUnit) break;

    if (isWord || isConn) {
      collected.push(t);
    } else {
      break;
    }
  }

  const label = collected.reverse().join(" ").replace(/\s+/g, " ").trim();
  return cleanLabel(label);
}

function tokenCandidatesFromLine(originalLineText: string, lineIndex: number, lineTokens: Token[]): ValueUnitCandidate[] {
  if (isDailyValuesNoise(originalLineText)) return [];
  if (isHeaderNoise(originalLineText)) return [];

  const candidates: ValueUnitCandidate[] = [];

  for (let i = 0; i < lineTokens.length; i++) {
    const rawTok = lineTokens[i].text;
    const tok = normalizeTokenTextForExtraction(rawTok);
    const compact = tok.replace(/\s+/g, "");

    // Combined: "300mg", "13g", "5%"
    const mCombined = compact.match(/^(\d+(?:\.\d+)?)(mg|g|kg|mcg|µg|ug|kj|kcal|cal|ml|%)$/i);
    if (mCombined) {
      const value = Number(mCombined[1]);
      const unit = normalizeUnit(mCombined[2]);
      if (Number.isFinite(value)) {
        candidates.push({
          raw: tok,
          value,
          unit,
          line: originalLineText,
          lineIndex,
          tokenIndex: i,
        });
      }
      continue;
    }

    // Split: "300" "mg"
    if (isNumberOnly(compact) && i + 1 < lineTokens.length) {
      const nextTokRaw = lineTokens[i + 1].text;
      const nextTok = normalizeTokenTextForExtraction(nextTokRaw);
      const nextCompact = nextTok.replace(/\s+/g, "");

      if (isUnitOnly(nextCompact)) {
        const value = Number(compact);
        const unit = normalizeUnit(nextCompact);
        if (Number.isFinite(value)) {
          candidates.push({
            raw: `${tok} ${nextTok}`,
            value,
            unit,
            line: originalLineText,
            lineIndex,
            tokenIndex: i,
          });
        }
      }
    }
  }

  // Calories heuristic (unitless) — only for "Calories 90 ..." lines, not headers with ":"
  const normalizedLine = normalizeLineForExtraction(originalLineText);
  const hasCalLike = candidates.some((c) => c.unit === "cal" || c.unit === "kcal");
  if (!hasCalLike && /calories/i.test(normalizedLine) && !normalizedLine.includes(":")) {
    const idxCalories = lineTokens.findIndex((t) => /^calories$/i.test(t.text.trim()));
    if (idxCalories >= 0) {
      for (let j = idxCalories + 1; j < lineTokens.length; j++) {
        const tt = normalizeTokenTextForExtraction(lineTokens[j].text).replace(/\s+/g, "");
        if (isNumberOnly(tt)) {
          const v = Number(tt);
          if (Number.isFinite(v)) {
            candidates.push({
              raw: tt,
              value: v,
              unit: "",
              line: originalLineText,
              lineIndex,
              tokenIndex: j,
            });
          }
          break;
        }
      }
    }
  }

  return dropPercentCandidates(candidates);
}

/**
 * Step 3: returns line strings + value/unit candidates.
 */
export function extractValueUnitCandidates(ocr: OcrResultLike): {
  lines: string[];
  candidates: ValueUnitCandidate[];
} {
  const items = Array.isArray(ocr.items) ? ocr.items : [];
  const tokens = items.map(tokenFromItem).filter(Boolean) as Token[];

  const builtLines = buildLinesFromTokens(tokens);

  const rawLines =
    builtLines.length > 0
      ? builtLines.map((l) => l.text)
      : (ocr.fullText || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);

  const lines = rawLines.filter((l) => !isDailyValuesNoise(l));

  if (builtLines.length > 0) {
    const candidates: ValueUnitCandidate[] = [];
    builtLines.forEach((l, i) => {
      if (isDailyValuesNoise(l.text)) return;
      candidates.push(...tokenCandidatesFromLine(l.text, i, l.tokens));
    });
    return { lines, candidates };
  }

  // Fallback path (no boxes): regex
  const re = /(\d+(?:\.\d+)?)\s*(mg|g|kg|mcg|µg|ug|kj|kcal|cal|ml|%)/gi;
  const candidates: ValueUnitCandidate[] = [];

  rawLines.forEach((originalLine, lineIndex) => {
    if (isDailyValuesNoise(originalLine)) return;
    if (isHeaderNoise(originalLine)) return;

    const line = normalizeLineForExtraction(originalLine);

    let hasCalLike = false;
    re.lastIndex = 0;

    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const raw = m[0];
      const value = Number(m[1]);
      const unit = normalizeUnit(m[2]);
      if (!Number.isFinite(value)) continue;
      if (unit === "cal" || unit === "kcal") hasCalLike = true;

      candidates.push({ raw, value, unit, line: originalLine, lineIndex });
    }

    if (!hasCalLike && /calories/i.test(line) && !line.includes(":")) {
      const idx = line.toLowerCase().indexOf("calories");
      const after = idx >= 0 ? line.slice(idx + "calories".length) : line;
      const num = after.match(/(\d+(?:\.\d+)?)/)?.[1];
      if (num) {
        const v = Number(num);
        if (Number.isFinite(v)) {
          candidates.push({ raw: num, value: v, unit: "", line: originalLine, lineIndex });
        }
      }
    }
  });

  return { lines, candidates: dropPercentCandidates(candidates) };
}

/**
 * Step 4: Attach left-hand label phrase to each candidate (same line).
 */
export function extractLabeledValueUnitCandidates(ocr: OcrResultLike): {
  lines: string[];
  candidates: LabeledValueUnitCandidate[];
} {
  const items = Array.isArray(ocr.items) ? ocr.items : [];
  const tokens = items.map(tokenFromItem).filter(Boolean) as Token[];
  const builtLines = buildLinesFromTokens(tokens);

  const rawLines =
    builtLines.length > 0
      ? builtLines.map((l) => l.text)
      : (ocr.fullText || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);

  const lines = rawLines.filter((l) => !isDailyValuesNoise(l));

  if (builtLines.length === 0) {
    const step3 = extractValueUnitCandidates(ocr);
    return {
      lines: step3.lines,
      candidates: step3.candidates.map((c) => ({ ...c, label: "" })),
    };
  }

  const out: LabeledValueUnitCandidate[] = [];

  builtLines.forEach((line, lineIndex) => {
    if (isDailyValuesNoise(line.text)) return;
    if (isHeaderNoise(line.text)) return;

    const cands = tokenCandidatesFromLine(line.text, lineIndex, line.tokens);

    for (const c of cands) {
      const startIdx = typeof c.tokenIndex === "number" ? c.tokenIndex : -1;

      let label = startIdx >= 0 ? extractLabelFromTokens(line.tokens, startIdx) : "";

      // Force Serving Size label if grams appear on a serving size line
      if (c.unit === "g" && /serving\s*size/i.test(line.text)) {
        label = "Serving Size";
      }

      // If label is empty after cleaning, keep it empty (Step 5 will drop it)
      out.push({ ...c, label });
    }
  });

  return { lines, candidates: dropPercentCandidates(out) };
}

/* -----------------------------
   Serving meta extraction (string-based)
------------------------------ */

export function extractServingMeta(lines: string[]): ServingMeta {
  let servingSize: ServingMeta["servingSize"] = null;
  let servingsPerPack: number | null = null;

  for (const rawLine of lines) {
    const line = normalizeLineForExtraction(rawLine);
    const s = line.toLowerCase();

    // Serving size: capture g/ml (prefer g)
    if (!servingSize && s.includes("serving") && s.includes("size")) {
      const m = line.match(/serving\s*size[^0-9]*?(\d+(?:\.\d+)?)\s*(g|ml)\b/i);
      if (m) {
        const v = Number(m[1]);
        const u = (m[2] || "").toLowerCase() as "g" | "ml";
        if (Number.isFinite(v)) servingSize = { value: v, unit: u };
      }
    }

    // Servings per package/container: capture first numeric
    if (servingsPerPack == null && s.includes("servings") && s.includes("per")) {
      const m = line.match(/servings\s*per[^0-9]*?(\d+(?:\.\d+)?)/i);
      if (m) {
        const v = Number(m[1]);
        if (Number.isFinite(v)) servingsPerPack = v;
      }
    }
  }

  return { servingSize, servingsPerPack };
}

/* -----------------------------
   Step 5: group by label + pick primary
------------------------------ */

function normalizeLabelKey(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase();
}

function isNoiseLabel(label: string): boolean {
  const k = normalizeLabelKey(label);
  if (!k) return true;

  // headings / non-data
  if (k === "nutrition facts") return true;
  if (k === "nutrition information") return true;
  if (k === "amount per serving") return true;
  if (k === "servings per container") return true;
  if (k === "servings per package") return true;
  if (k.includes("less than")) return true;

  // header-ish
  if (k.includes("per 100")) return true;
  if (k.includes("per serving")) return true;
  if (k.includes("avg. quantity")) return true;
  if (k.includes("avg quantity")) return true;

  // digits in labels are always junk for grouping
  if (/\d/.test(k)) return true;

  return false;
}

function unitRank(labelKey: string, unit: string): number {
  if (labelKey === "calories") {
    if (unit === "") return 0;
    if (unit === "kcal") return 1;
    if (unit === "cal") return 2;
    return 9;
  }

  if (unit === "mg") return 0;
  if (unit === "g") return 1;
  if (unit === "kJ" || unit === "kj") return 2;
  if (unit === "kcal") return 3;
  if (unit === "cal") return 4;
  if (unit === "ml") return 5;
  if (unit === "") return 8;
  return 9;
}

function candidateScore(c: LabeledValueUnitCandidate): [number, number, number] {
  const labelKey = normalizeLabelKey(c.label);
  return [c.lineIndex, unitRank(labelKey, c.unit), Math.abs(c.value)];
}

export function groupByLabelPickPrimary(labeledCandidates: LabeledValueUnitCandidate[]): LabelRow[] {
  const filtered = labeledCandidates
    .filter((c) => c.unit !== "%")
    .filter((c) => c.label && c.label.trim())
    .filter((c) => !isNoiseLabel(c.label));

  const map = new Map<string, { displayLabel: string; items: LabeledValueUnitCandidate[] }>();

  for (const c of filtered) {
    const key = normalizeLabelKey(c.label);
    const existing = map.get(key);
    if (!existing) map.set(key, { displayLabel: c.label, items: [c] });
    else existing.items.push(c);
  }

  const rows: LabelRow[] = [];

  for (const [, v] of map) {
    const sorted = [...v.items].sort((a, b) => {
      const sa = candidateScore(a);
      const sb = candidateScore(b);
      if (sa[0] !== sb[0]) return sa[0] - sb[0];
      if (sa[1] !== sb[1]) return sa[1] - sb[1];
      return sa[2] - sb[2];
    });

    rows.push({
      label: v.displayLabel,
      primary: sorted[0],
      alternates: sorted.slice(1),
    });
  }

  rows.sort((a, b) => {
    if (a.primary.lineIndex !== b.primary.lineIndex) return a.primary.lineIndex - b.primary.lineIndex;
    return a.label.localeCompare(b.label);
  });

  return rows;
}

export function extractLabelRows(ocr: OcrResultLike): {
  lines: string[];
  rows: LabelRow[];
} {
  const labeled = extractLabeledValueUnitCandidates(ocr);
  const rows = groupByLabelPickPrimary(labeled.candidates);
  return { lines: labeled.lines, rows };
}
