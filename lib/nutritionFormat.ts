// lib/nutritionFormat.ts
import type { Confidence, LabelData, NutrientKey } from "./mockLabel";

export type Basis = "per_serve" | "per_100g";

type Row = {
  id: string;
  label: string;
  valueText: string; // already formatted + includes units where appropriate
  confidence?: Confidence;
};

const CONF_RANK: Record<Confidence, number> = {
  High: 3,
  Med: 2,
  Low: 1,
};

function minConfidence(a?: Confidence, b?: Confidence): Confidence | undefined {
  if (!a) return b;
  if (!b) return a;
  return CONF_RANK[a] <= CONF_RANK[b] ? a : b;
}

function toPer100(value: number, servingSizeG: number) {
  return (value / servingSizeG) * 100;
}

function formatNumber(value: number, unit: string) {
  // MVP rounding rules (keep consistent everywhere)
  if (unit === "kJ" || unit === "kcal" || unit === "mg") return String(Math.round(value));
  return String(Math.round(value * 10) / 10); // 1 dp for grams etc.
}

const META: Record<
  NutrientKey,
  { label: string; order: number; unitHint?: string }
> = {
  energy_kj: { label: "Energy", order: 1, unitHint: "kJ" },
  energy_kcal: { label: "Energy", order: 2, unitHint: "kcal" },

  protein_g: { label: "Protein", order: 10, unitHint: "g" },
  carbs_g: { label: "Carbohydrate", order: 20, unitHint: "g" },
  fat_g: { label: "Fat", order: 30, unitHint: "g" },
  sugars_g: { label: "Sugars", order: 40, unitHint: "g" },
  fibre_g: { label: "Fibre", order: 50, unitHint: "g" },
  sodium_mg: { label: "Sodium", order: 60, unitHint: "mg" },
};

export function servingSizeText(label: LabelData, basis: Basis) {
  const serving = `${label.servingSize.value}${label.servingSize.unit}`;
  if (basis === "per_100g") return `${serving} → 100g`;
  return serving;
}

export function servingSizeLine(label: LabelData, basis: Basis) {
  const serving = `${label.servingSize.value}${label.servingSize.unit}`;
  if (basis === "per_100g") return `Serving size: ${serving} → 100g (calculated)`;
  return `Serving size: ${serving}`;
}

export function getReviewRows(label: LabelData, basis: Basis): Row[] {
  const nutrients = label.nutrients;

  // Combine Energy into ONE row: "XXXX kJ (YYY kcal)"
  const kj = nutrients.energy_kj;
  const kcal = nutrients.energy_kcal;

  const rows: Row[] = [];

  if (kj || kcal) {
    const servingSize = label.servingSize.value;

    const kjValue =
      kj && basis === "per_100g" ? toPer100(kj.value, servingSize) : kj?.value;
    const kcalValue =
      kcal && basis === "per_100g" ? toPer100(kcal.value, servingSize) : kcal?.value;

    const kjText = kjValue != null ? `${formatNumber(kjValue, kj!.unit)} ${kj!.unit}` : "";
    const kcalText =
      kcalValue != null ? `${formatNumber(kcalValue, kcal!.unit)} ${kcal!.unit}` : "";

    let valueText = "";
    if (kjText && kcalText) valueText = `${kjText} (${kcalText})`;
    else valueText = kjText || kcalText;

    rows.push({
      id: "energy",
      label: "Energy",
      valueText,
      confidence: minConfidence(kj?.confidence, kcal?.confidence),
    });
  }

  // Other nutrients (exclude energy keys)
  const otherKeys = (Object.keys(nutrients) as NutrientKey[])
    .filter((k) => k !== "energy_kj" && k !== "energy_kcal")
    .sort((a, b) => META[a].order - META[b].order);

  for (const key of otherKeys) {
    const n = nutrients[key];
    if (!n) continue;

    const value =
      basis === "per_100g" ? toPer100(n.value, label.servingSize.value) : n.value;

    rows.push({
      id: key,
      label: META[key]?.label ?? key,
      valueText: `${formatNumber(value, n.unit)} ${n.unit}`,
      confidence: n.confidence,
    });
  }

  return rows;
}

export function buildPlainText(label: LabelData, basis: Basis) {
  const lines: string[] = [];

  lines.push(servingSizeLine(label, basis));

  // Plain text export uses the same combined rows
  const rows = getReviewRows(label, basis);
  for (const r of rows) {
    lines.push(`${r.label}: ${r.valueText}`);
  }

  return lines.join("\n");
}

export function buildMarkdown(label: LabelData, basis: Basis) {
  const lines: string[] = [];

  // Serving size line (no bold, no asterisks)
  lines.push(servingSizeLine(label, basis));
  lines.push("");

  const rows = getReviewRows(label, basis);

  for (const r of rows) {
    lines.push(`- ${r.label}: ${r.valueText}`);
  }

  return lines.join("\n");
}

export function buildCSV(label: LabelData, basis: Basis) {
  const lines: string[] = [];

  const servingRaw = `${label.servingSize.value}${label.servingSize.unit}`;
  const servingDisplay = servingSizeText(label, basis); // e.g. "60g" or "60g → 100g"

  // Header
  lines.push("Field,Value,Unit");

  // Metadata rows (so serving size is never lost)
  lines.push(`Basis,${basis === "per_serve" ? "per serve" : "per 100 g"},`);
  lines.push(`Serving size,${servingRaw},`);
  if (basis === "per_100g") {
    lines.push(`Normalised to,100,g`);
    lines.push(`Normalisation note,"${servingDisplay}",`);
  }

  // Blank line separator (optional; harmless in Sheets/Excel)
  lines.push(",,");
  lines.push("Nutrient,Value,Unit");

  const rows = getReviewRows(label, basis);

  for (const r of rows) {
    // Most rows look like: "20 g" or "367 mg"
    const simple = r.valueText.match(/^(-?[\d.]+)\s([a-zA-Z]+)$/);

    if (simple) {
      const [, value, unit] = simple;
      lines.push(`${r.label},${value},${unit}`);
    } else {
      // Energy combined row: "1250 kJ (300 kcal)" or any complex text
      // Quote Value and leave Unit blank.
      const escaped = r.valueText.replace(/"/g, '""');
      lines.push(`${r.label},"${escaped}",`);
    }
  }

  return lines.join("\n");
}
