// lib/ocrPost.ts
// Step 3: Extract value+unit candidates (input-assist only).
// Scope: NO nutrient mapping, NO per-serve/per-100g logic, NO UI wiring.

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

type BuiltLine = { text: string };

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
      line.tokens.sort((a, b) => a.xMin - b.xMin);
      const text = line.tokens
        .map((t) => t.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return { text };
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
  // 1) Remove thousands separators: 2,000 -> 2000
  let s = line.replace(/(\d),(?=\d{3}\b)/g, "$1");

  // 2) Fix common OCR: "Omg" -> "0mg" (O mistaken for zero)
  // Keep this narrow: only for exact "Omg"/"O mg" patterns.
  s = s.replace(/\bO\s*mg\b/gi, "0mg");

  return s;
}

export function extractValueUnitCandidates(ocr: OcrResultLike): {
  lines: string[];
  candidates: ValueUnitCandidate[];
} {
  const items = Array.isArray(ocr.items) ? ocr.items : [];
  const tokens = items.map(tokenFromItem).filter(Boolean) as Token[];

  const builtLines = buildLinesFromTokens(tokens);

  const lines =
    builtLines.length > 0
      ? builtLines.map((l) => l.text)
      : (ocr.fullText || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);

  const re = /(\d+(?:\.\d+)?)\s*(mg|g|kg|mcg|µg|ug|kj|kcal|cal|%)/gi;

  const candidates: ValueUnitCandidate[] = [];

  lines.forEach((originalLine, lineIndex) => {
    const line = normalizeLineForExtraction(originalLine);

    // Track whether the line already contains cal/kcal extracted via regex
    let hasCalLike = false;

    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const raw = m[0];
      const value = Number(m[1]);
      const unit = normalizeUnit(m[2]);

      if (!Number.isFinite(value)) continue;

      if (unit === "cal" || unit === "kcal") hasCalLike = true;

      candidates.push({
        raw,
        value,
        unit,
        line: originalLine,
        lineIndex,
      });
    }

    // Unitless calories: only add if we did NOT already extract cal/kcal on this line
    if (!hasCalLike && /calories/i.test(line) && !line.includes(":")) {
      const num = line.match(/(\d+(?:\.\d+)?)/)?.[1];
      if (num) {
        const v = Number(num);
        if (Number.isFinite(v)) {
          candidates.push({
            raw: num,
            value: v,
            unit: "",
            line: originalLine,
            lineIndex,
          });
        }
      }
    }
  });

  return { lines, candidates };
}
