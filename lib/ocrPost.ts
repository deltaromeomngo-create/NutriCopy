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
  boundingBox: Vertex[];
};

type OcrResultLike = {
  fullText: string;
  items: OcrItem[];
};

export type ValueUnitCandidate = {
  raw: string;
  value: number;
  unit: string;
  line: string;
  lineIndex: number;
  tokenIndex?: number;
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

/* -----------------------------
   Helpers
------------------------------ */

function finite(n: unknown, fallback = 0): number {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function normalizeLineForExtraction(line: string): string {
  let s = line.replace(/(\d),(?=\d{3}\b)/g, "$1");
  s = s.replace(/\bO\s*mg\b/gi, "0mg");
  return s;
}

function normalizeUnit(u: string): string {
  const s = (u || "").trim();
  if (!s) return "";
  if (/^kj$/i.test(s)) return "kJ";
  if (/^kcal$/i.test(s)) return "kcal";
  if (s === "µg") return "mcg";
  return s.toLowerCase();
}

/* -----------------------------
   Tokenisation + line building
------------------------------ */

function tokenFromItem(it: OcrItem): Token | null {
  const text = (it.text ?? "").trim();
  if (!text) return null;

  const verts = Array.isArray(it.boundingBox) ? it.boundingBox : [];
  if (!verts.length) return null;

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
  if (!nums.length) return 0;
  const a = [...nums].sort((p, q) => p - q);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

type BuiltLine = { text: string; tokens: Token[] };

function buildLinesFromTokens(tokens: Token[]): BuiltLine[] {
  if (!tokens.length) return [];

  const medH = median(tokens.map((t) => t.h).filter((h) => h > 0)) || 10;
  const yTol = Math.max(6, medH * 0.6);

  const sorted = [...tokens].sort(
    (a, b) => a.yMid - b.yMid || a.xMin - b.xMin
  );

  const lines: { yRef: number; tokens: Token[] }[] = [];

  for (const t of sorted) {
    let best = -1;
    let bestDy = Infinity;

    for (let i = 0; i < lines.length; i++) {
      const dy = Math.abs(t.yMid - lines[i].yRef);
      if (dy < bestDy) {
        bestDy = dy;
        best = i;
      }
    }

    if (best !== -1 && bestDy <= yTol) {
      const line = lines[best];
      line.tokens.push(t);
      line.yRef =
        (line.yRef * (line.tokens.length - 1) + t.yMid) /
        line.tokens.length;
    } else {
      lines.push({ yRef: t.yMid, tokens: [t] });
    }
  }

  return lines
    .sort((a, b) => a.yRef - b.yRef)
    .map((l) => {
      const tokens = [...l.tokens].sort((a, b) => a.xMin - b.xMin);
      return {
        tokens,
        text: tokens.map((t) => t.text).join(" ").replace(/\s+/g, " ").trim(),
      };
    })
    .filter((l) => l.text);
}

/* -----------------------------
   Noise detection
------------------------------ */

function isDailyValuesNoise(line: string): boolean {
  const s = normalizeLineForExtraction(line).toLowerCase();
  return (
    s.includes("daily value") ||
    s.includes("daily values") ||
    s.includes("caloric needs") ||
    s.includes("calories per gram") ||
    s.startsWith("calories :")
  );
}

function isHeaderNoise(line: string): boolean {
  const s = normalizeLineForExtraction(line).toLowerCase();
  return (
    s.includes("avg") && s.includes("quantity") ||
    s.includes("per 100") ||
    s === "nutrition facts" ||
    s === "nutrition information"
  );
}

/* -----------------------------
   Step 5 grouping
------------------------------ */

function normalizeLabelKey(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase();
}

function isNoiseLabel(label: string): boolean {
  const k = normalizeLabelKey(label);
  if (!k) return true;
  if (/\d/.test(k)) return true;
  if (
    k.includes("nutrition") ||
    k.includes("per 100") ||
    k.includes("avg")
  )
    return true;
  return false;
}

export function groupByLabelPickPrimary(
  labeled: LabeledValueUnitCandidate[]
): LabelRow[] {
  const map = new Map<
    string,
    { displayLabel: string; items: LabeledValueUnitCandidate[] }
  >();

  for (const c of labeled) {
    if (!c.label || isNoiseLabel(c.label)) continue;
    const key = normalizeLabelKey(c.label);
    const bucket = map.get(key);
    if (!bucket) map.set(key, { displayLabel: c.label, items: [c] });
    else bucket.items.push(c);
  }

  const rows: LabelRow[] = [];

  Array.from(map.values()).forEach((v) => {
    const sorted = [...v.items].sort(
      (a, b) => a.lineIndex - b.lineIndex
    );
    rows.push({
      label: v.displayLabel,
      primary: sorted[0],
      alternates: sorted.slice(1),
    });
  });

  return rows;
}

/* -----------------------------
   Public OCR post function
------------------------------ */

export function ocrPost(r0: any) {
  const fullText =
    r0?.fullTextAnnotation?.text ||
    r0?.textAnnotations?.[0]?.description ||
    "";

  const items: OcrItem[] = (r0?.textAnnotations || [])
    .slice(1)
    .map((a: any) => ({
      text: a?.description ?? "",
      boundingBox: a?.boundingPoly?.vertices || [],
    }));

  const ocr: OcrResultLike = { fullText, items };

  const tokens = items.map(tokenFromItem).filter(Boolean) as Token[];
  const builtLines = buildLinesFromTokens(tokens);

  const rawLines =
    builtLines.length > 0
      ? builtLines.map((l) => l.text)
      : fullText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  const lines = rawLines.filter(
    (l) => !isDailyValuesNoise(l) && !isHeaderNoise(l)
  );

  // Placeholder until nutrient mapping (Checkpoint E)
  const rows: LabelRow[] = [];

  return {
    lines,       // ✅ REQUIRED by frontend
    rows,        // ✅ Future-proof
  };
}
