// lib/ocrPost.ts
// Step 3/4: OCR post-processing (input-assist only).
// Step 3: value+unit candidates
// Step 4: attach left-hand label phrase per candidate
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
  raw: string;       // e.g. "300mg", "13 g", "5%"
  value: number;     // e.g. 300
  unit: string;      // "mg" | "g" | "kJ" | "kcal" | "%" | "" (unitless)
  line: string;      // reconstructed line text (original)
  lineIndex: number;
};

export type LabelRow = {
  label: string;
  primary: LabeledValueUnitCandidate;
  alternates: LabeledValueUnitCandidate[];
};


export type LabeledValueUnitCandidate = ValueUnitCandidate & {
  label: string;     // e.g. "Sodium", "Total Fat", "Vitamin C"
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
  text: string;      // joined token text
  tokens: Token[];   // x-sorted tokens for label attachment
};

function buildLinesFromTokens(tokens: Token[]): BuiltLine[] {
  if (tokens.length === 0) return [];

  const medH = median(tokens.map((t) => t.h).filter((h) => h > 0)) || 10;
  const yTol = Math.max(6, medH * 0.6);

  const sorted = [...tokens].sort(
    (a, b) => (a.yMid - b.yMid) || (a.xMin - b.xMin)
  );

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
      line.yRef =
        (line.yRef * (line.tokens.length - 1) + t.yMid) / line.tokens.length;
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
  // Remove thousands separators inside tokens
  s = s.replace(/(\d),(?=\d{3}\b)/g, "$1");
  // Omg -> 0mg
  s = s.replace(/\bO\s*mg\b/gi, "0mg");
  return s;
}

function isNumberOnly(s: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(s);
}

function isUnitOnly(s: string): boolean {
  // Keep % here as a boundary token for label extraction,
  // even though we will DROP % candidates from output.
  return /^(mg|g|kg|mcg|µg|ug|kj|kcal|cal|%)$/i.test(s.trim());
}

function isWordLike(s: string): boolean {
  // allow letters and common connectors
  return /[A-Za-z]/.test(s) && !isUnitOnly(s);
}

/**
 * Daily Values boilerplate/table lines are high-noise and not shipped in MVP.
 * This also kills the "Sad Fat / Less than ..." DV table artifacts.
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
  if (s.includes("less than")) return true;
  if (s.includes("calories per gram")) return true;

  return false;
}

function dropPercentCandidates<T extends ValueUnitCandidate>(arr: T[]): T[] {
  // Remove all % candidates to ship without Daily Values
  return arr.filter((c) => c.unit !== "%");
}

function extractLabelFromTokens(lineTokens: Token[], startIdx: number): string {
  // Scan left from startIdx-1:
  // - before we start collecting: skip numbers/units/punctuation
  // - once collecting: collect word-like tokens; stop at first non-word boundary
  const collected: string[] = [];
  let collecting = false;

  for (let i = startIdx - 1; i >= 0; i--) {
    const t = normalizeTokenTextForExtraction(lineTokens[i].text);
    const tNoSpace = t.replace(/\s+/g, "");

    const isNum =
      isNumberOnly(tNoSpace) ||
      /^(\d+(?:\.\d+)?)(mg|g|kg|mcg|µg|ug|kj|kcal|cal|%)$/i.test(tNoSpace);
    const isUnit = isUnitOnly(tNoSpace);
    const word = isWordLike(t);

    if (!collecting) {
      if (word) {
        collecting = true;
        collected.push(t);
      } else {
        // skip until we hit words
        continue;
      }
    } else {
      if (word) {
        collected.push(t);
      } else {
        // boundary hit (number/unit/punct/etc.) once collecting started
        break;
      }
    }
  }

  return collected.reverse().join(" ").replace(/\s+/g, " ").trim();
}

function tokenCandidatesFromLine(
  originalLineText: string,
  lineIndex: number,
  lineTokens: Token[]
): ValueUnitCandidate[] {
  // Skip DV noise entirely
  if (isDailyValuesNoise(originalLineText)) return [];

  const candidates: ValueUnitCandidate[] = [];

  // Per-token extraction (lets us attach labels deterministically)
  for (let i = 0; i < lineTokens.length; i++) {
    const rawTok = lineTokens[i].text;
    const tok = normalizeTokenTextForExtraction(rawTok);
    const compact = tok.replace(/\s+/g, "");

    // Combined: "300mg", "13g", "5%"
    const mCombined = compact.match(
      /^(\d+(?:\.\d+)?)(mg|g|kg|mcg|µg|ug|kj|kcal|cal|%)$/i
    );
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
        });
      }
      continue;
    }

    // Split: "5" "%"  OR "300" "mg"
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
          });
        }
      }
    }
  }

  // Calories heuristic (unitless) — only for "Calories 90 ..." lines, not table headers with ":"
  // If we already extracted cal/kcal on this line, do nothing.
  const normalizedLine = normalizeLineForExtraction(originalLineText);
  const hasCalLike = candidates.some((c) => c.unit === "cal" || c.unit === "kcal");
  if (!hasCalLike && /calories/i.test(normalizedLine) && !normalizedLine.includes(":")) {
    // Find first number token after the word "Calories"
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
            });
          }
          break;
        }
      }
    }
  }

  // Drop % candidates at the end (MVP policy)
  return dropPercentCandidates(candidates);
}

/**
 * Step 3 (existing): returns line strings + value/unit candidates (regex/tokens).
 * Kept for compatibility with your runner.
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

  // Filter out DV noise lines from lines output (MVP policy)
  const lines = rawLines.filter((l) => !isDailyValuesNoise(l));

  // Use the token-based candidates when boxes exist; fallback to regex on fullText lines.
  if (builtLines.length > 0) {
    const candidates: ValueUnitCandidate[] = [];
    builtLines.forEach((l, i) => {
      if (isDailyValuesNoise(l.text)) return;
      candidates.push(...tokenCandidatesFromLine(l.text, i, l.tokens));
    });
    return { lines, candidates };
  }

  const re = /(\d+(?:\.\d+)?)\s*(mg|g|kg|mcg|µg|ug|kj|kcal|cal|%)/gi;
  const candidates: ValueUnitCandidate[] = [];

  rawLines.forEach((originalLine, lineIndex) => {
    if (isDailyValuesNoise(originalLine)) return;

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
      const num = line.match(/(\d+(?:\.\d+)?)/)?.[1];
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
 * Deterministic: derives label from tokens immediately to the left of the value.
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

  // Filter out DV noise lines from lines output (MVP policy)
  const lines = rawLines.filter((l) => !isDailyValuesNoise(l));

  // If we have boxes, do Step 4 properly; otherwise fall back to Step 3 candidates with empty labels.
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

    const cands = tokenCandidatesFromLine(line.text, lineIndex, line.tokens);

    // Attach label per candidate by locating the token index where the value begins.
    // Heuristic: find first token that contains the candidate's numeric prefix.
    for (const c of cands) {
      const valueStr = String(c.value);
      let startIdx = -1;

      for (let i = 0; i < line.tokens.length; i++) {
        const tt = normalizeTokenTextForExtraction(line.tokens[i].text).replace(/\s+/g, "");
        if (tt === valueStr || tt.startsWith(valueStr)) {
          startIdx = i;
          break;
        }
      }

        let label = startIdx >= 0 ? extractLabelFromTokens(line.tokens, startIdx) : "";

        // Patch: serving size gram weight inside parentheses often labels as "cup".
        if (
            c.unit === "g" &&
            /serving size/i.test(line.text) &&
            /\(\s*.*\b\d+(?:\.\d+)?\s*g\b.*\s*\)/i.test(line.text)
        ) {
        label = "Serving Size";
    }

        // If this grams value is on a Serving Size line, force label.
        // Handles "Serving Size approx 30g", "Serving Size ~30g", etc.
        if (c.unit === "g" && /serving\s*size/i.test(line.text)) {
            label = "Serving Size";
        }

    // Canonicalize common labels to consistent casing
    if (/^serving\s*size$/i.test(label)) {
        label = "Serving Size";
    }

    out.push({ ...c, label });


    }
  });

  // cands already had % removed, but keep this as a final safety net
  return { lines, candidates: dropPercentCandidates(out) };
}

/* -----------------------------
   Step 5: group by label + pick primary
   (no nutrient mapping; still input-assist only)
------------------------------ */

function normalizeLabelKey(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase();
}

function isNoiseLabel(label: string): boolean {
  const k = normalizeLabelKey(label);

  if (!k) return true;

  // obvious headings / non-data lines
  if (k === "nutrition facts") return true;
  if (k === "amount per serving") return true;
  if (k === "servings per container") return true;
  if (k === "per container") return true;
  if (k === "daily value") return true;

  // OCR oddities
  if (k === "(" || k === ")" || k === "*" || k === "-") return true;

  return false;
}

function unitRank(labelKey: string, unit: string): number {
  // Lower is better
  // Calories: prefer unitless if present
  if (labelKey === "calories") {
    if (unit === "") return 0;
    if (unit === "kcal") return 1;
    if (unit === "cal") return 2;
    return 9;
  }

  // Default preference: absolute units > unitless
  if (unit === "mg") return 0;
  if (unit === "g") return 1;
  if (unit === "kJ" || unit === "kj") return 2;
  if (unit === "kcal") return 3;
  if (unit === "cal") return 4;
  if (unit === "") return 8;
  return 9;
}

function candidateScore(c: LabeledValueUnitCandidate): [number, number, number] {
  // Lower tuple is better
  const labelKey = normalizeLabelKey(c.label);
  return [
    c.lineIndex,                // earlier lines win (DV table is later)
    unitRank(labelKey, c.unit), // prefer absolute units
    Math.abs(c.value),          // stable tie-breaker
  ];
}

/**
 * Step 5 core: group by label and pick 1 primary candidate per label.
 * Keeps alternates for debugging.
 */
export function groupByLabelPickPrimary(
  labeledCandidates: LabeledValueUnitCandidate[]
): LabelRow[] {
  const filtered = labeledCandidates
    .filter((c) => c.unit !== "%")                 // safety net
    .filter((c) => c.label && c.label.trim())      // must have label
    .filter((c) => !isNoiseLabel(c.label));        // drop junk labels

  const map = new Map<string, { displayLabel: string; items: LabeledValueUnitCandidate[] }>();

  for (const c of filtered) {
    const key = normalizeLabelKey(c.label);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { displayLabel: c.label, items: [c] });
    } else {
      existing.items.push(c);
    }
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

  // deterministic ordering for printing / UI later
  rows.sort((a, b) => {
    if (a.primary.lineIndex !== b.primary.lineIndex) return a.primary.lineIndex - b.primary.lineIndex;
    return a.label.localeCompare(b.label);
  });

  return rows;
}

/**
 * Convenience: end-to-end Step 4 -> Step 5.
 * Use this for UI later.
 */
export function extractLabelRows(ocr: OcrResultLike): {
  lines: string[];
  rows: LabelRow[];
} {
  const labeled = extractLabeledValueUnitCandidates(ocr);
  const rows = groupByLabelPickPrimary(labeled.candidates);
  return { lines: labeled.lines, rows };
}
