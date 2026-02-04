// lib/nutritionFormat.ts
import type { Confidence, LabelData, NutrientKey } from "./mockLabel";

export type Basis = "per_serve" | "per_100g" | "custom";

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

export function getReviewRows(
  label: LabelData,
  basis: Basis,
  customGrams?: number,
  customServes?: number
): Row[] {
  const nutrients = label.nutrients;

  const canUseCustomServes =
    basis === "custom" &&
    Number.isFinite(customServes) &&
    customServes! > 0 &&
    label.servingSize.value >= 5 &&
    (label.servingSize.unit === "g" || label.servingSize.unit === "ml");

  const rows: Row[] = [];

  /* ---------------- Energy ---------------- */

  const kj = nutrients.energy_kj;
  const kcal = nutrients.energy_kcal;

  if (kj || kcal) {
    const servingSize = label.servingSize.value;

    let kjValue = kj?.value;
    let kcalValue = kcal?.value;

    if (basis === "per_100g") {
      if (kjValue != null) kjValue = toPer100(kjValue, servingSize);
      if (kcalValue != null) kcalValue = toPer100(kcalValue, servingSize);
    }

    if (canUseCustomServes) {
      if (kjValue != null) kjValue *= customServes!;
      if (kcalValue != null) kcalValue *= customServes!;
    } else if (
      basis === "custom" &&
      Number.isFinite(customGrams) &&
      servingSize > 0
    ) {
      if (kjValue != null) kjValue *= customGrams! / servingSize;
      if (kcalValue != null) kcalValue *= customGrams! / servingSize;
    }

    const kjText =
      kjValue != null ? `${formatNumber(kjValue, kj!.unit)} ${kj!.unit}` : "";
    const kcalText =
      kcalValue != null ? `${formatNumber(kcalValue, kcal!.unit)} ${kcal!.unit}` : "";

    const valueText =
      kjText && kcalText ? `${kjText} (${kcalText})` : kjText || kcalText;

    rows.push({
      id: "energy",
      label: "Energy",
      valueText,
      confidence: minConfidence(kj?.confidence, kcal?.confidence),
    });
  }

  /* ---------------- Other nutrients ---------------- */

  const otherKeys = (Object.keys(nutrients) as NutrientKey[])
    .filter((k) => k !== "energy_kj" && k !== "energy_kcal")
    .sort((a, b) => META[a].order - META[b].order);

  for (const key of otherKeys) {
    const n = nutrients[key];
    if (!n) continue;

    let value = n.value;

    if (basis === "per_100g") {
      value = toPer100(value, label.servingSize.value);
    }

    if (canUseCustomServes) {
      value *= customServes!;
    } else if (
      basis === "custom" &&
      Number.isFinite(customGrams) &&
      label.servingSize.value > 0
    ) {
      value *= customGrams! / label.servingSize.value;
    }

    rows.push({
      id: key,
      label: META[key]?.label ?? key,
      valueText: `${formatNumber(value, n.unit)} ${n.unit}`,
      confidence: n.confidence,
    });
  }

  return rows;
}


export function buildPlainText(
  label: LabelData,
  basis: Basis,
  customGrams?: number,
  customServes?: number,
  mode: "label" | "consumption" = "label"
) {
  const lines: string[] = [];

  if (label.name) {
    lines.push(`Food: ${label.name}`);
  }

  lines.push(servingSizeLine(label, basis));

  if (mode === "consumption") {
    lines.push("Mode: Consumption (derived)");

    if (Number.isFinite(customServes)) {
      lines.push(`Serves eaten: ${customServes}`);
    }

    if (Number.isFinite(customGrams)) {
      lines.push(`Grams eaten: ${customGrams}`);
    }

    lines.push(
      "Calculation note: Derived from label serving size and macros."
    );
  }


  const rows = getReviewRows(label, basis, customGrams, customServes);
  for (const r of rows) {
    lines.push(`${r.label}: ${r.valueText}`);
  }

  return lines.join("\n");
}


export function buildMarkdown(
  label: LabelData,
  basis: Basis,
  customGrams?: number,
  customServes?: number,
  mode: "label" | "consumption" = "label"
) {
  const lines: string[] = [];

  if (label.name) {
    lines.push(`Food: ${label.name}`);
  }


  lines.push(servingSizeLine(label, basis));
  lines.push("");

  if (mode === "consumption") {
    lines.push("Mode: Consumption (derived)");

    if (Number.isFinite(customServes)) {
      lines.push(`- Serves eaten: ${customServes}`);
    }

    if (Number.isFinite(customGrams)) {
      lines.push(`- Grams eaten: ${customGrams}`);
    }

    lines.push(
      "- Calculation note: Derived from label serving size and macros."
    );
    lines.push("");
  }


  const rows = getReviewRows(label, basis, customGrams, customServes);
  for (const r of rows) {
    lines.push(`- ${r.label}: ${r.valueText}`);
  }

  return lines.join("\n");
}


export function buildCSV(
  label: LabelData,
  basis: Basis,
  customGrams?: number,
  customServes?: number,
  mode: "label" | "consumption" = "label"
) {
  const lines: string[] = [];

  const servingRaw = `${label.servingSize.value}${label.servingSize.unit}`;
  const servingDisplay = servingSizeText(label, basis);

  lines.push("Field,Value,Unit");

  // ---- Metadata (corpus / analytics safe) ----
if (label.name) {
  lines.push(`Food,"${label.name.replace(/"/g, '""')}",`);
}

lines.push(`Export mode,${mode},`);
lines.push(
  `Basis,${
    basis === "per_serve"
      ? "per serve"
      : basis === "per_100g"
      ? "per 100 g"
      : "custom"
  },`
);

lines.push(
  `Serving size,${label.servingSize.value},${label.servingSize.unit}`
);

if (Number.isFinite(customServes)) {
  lines.push(`Serves eaten,${customServes},`);
}

if (Number.isFinite(customGrams)) {
  lines.push(`Grams eaten,${customGrams},`);
}

if (mode === "consumption") {
  lines.push(
    `Calculation note,"Derived from label serving size and macros.",`
  );
}

// Separator
lines.push(",,");


  lines.push("Nutrient,Value,Unit");

  const rows = getReviewRows(label, basis, customGrams, customServes);
  for (const r of rows) {
    const simple = r.valueText.match(/^(-?[\d.]+)\s([a-zA-Z]+)$/);

    if (simple) {
      const [, value, unit] = simple;
      lines.push(`${r.label},${value},${unit}`);
    } else {
      const escaped = r.valueText.replace(/"/g, '""');
      lines.push(`${r.label},"${escaped}",`);
    }
  }

  return lines.join("\n");
}


// ---------- Consumption exports (derived) ----------

export function buildConsumptionPlainText(
  label: LabelData,
  basis: Basis,
  customGrams?: number,
  customServes?: number
) {
  const lines: string[] = [];

  if (label.name) lines.push(`Food: ${label.name}`);
  lines.push("Mode: Consumption (derived)");
  lines.push(servingSizeLine(label, basis));

  if (Number.isFinite(customServes)) lines.push(`Serves eaten: ${customServes}`);
  if (Number.isFinite(customGrams)) lines.push(`Grams eaten: ${customGrams}`);

  lines.push(
    'Calculation note: Derived from label serving size and macros.'
  );
  lines.push("");

  const rows = getReviewRows(label, "custom", customGrams, customServes);
  for (const r of rows) {
    lines.push(`${r.label}: ${r.valueText}`);
  }

  return lines.join("\n");
}

export function buildConsumptionMarkdown(
  label: LabelData,
  basis: Basis,
  customGrams?: number,
  customServes?: number
) {
  const lines: string[] = [];

  if (label.name) lines.push(`Food: ${label.name}`);
  lines.push("Mode: Consumption (derived)");
  lines.push(servingSizeLine(label, basis));
  lines.push("");

  if (Number.isFinite(customServes)) lines.push(`- Serves eaten: ${customServes}`);
  if (Number.isFinite(customGrams)) lines.push(`- Grams eaten: ${customGrams}`);
  lines.push(`- Calculation note: Derived from label serving size and macros.`);
  lines.push("");

  const rows = getReviewRows(label, "custom", customGrams, customServes);
  for (const r of rows) {
    lines.push(`- ${r.label}: ${r.valueText}`);
  }

  return lines.join("\n");
}

export function buildConsumptionCSV(
  label: LabelData,
  basis: Basis,
  customGrams?: number,
  customServes?: number
) {
  const lines: string[] = [];

  lines.push("Field,Value,Unit");
  if (label.name) lines.push(`Food,"${label.name.replace(/"/g, '""')}",`);
  lines.push(`Mode,Consumption,`);
  lines.push(`Serving size,${label.servingSize.value},${label.servingSize.unit}`);

  if (Number.isFinite(customServes)) lines.push(`Serves eaten,${customServes},`);
  if (Number.isFinite(customGrams)) lines.push(`Grams eaten,${customGrams},`);

  lines.push(`Calculation note,"Derived from label serving size and macros.",`);
  lines.push(",,");

  lines.push("Nutrient,Value,Unit");

  const rows = getReviewRows(label, "custom", customGrams, customServes);
  for (const r of rows) {
    const simple = r.valueText.match(/^(-?[\d.]+)\s([a-zA-Z]+)$/);
    if (simple) {
      const [, value, unit] = simple;
      lines.push(`${r.label},${value},${unit}`);
    } else {
      const escaped = r.valueText.replace(/"/g, '""');
      lines.push(`${r.label},"${escaped}",`);
    }
  }

  return lines.join("\n");
}

