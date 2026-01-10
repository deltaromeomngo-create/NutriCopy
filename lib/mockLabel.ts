export type NutrientKey =
  | "energy_kj"
  | "energy_kcal"
  | "protein_g"
  | "carbs_g"
  | "fat_g"
  | "sugars_g"
  | "fibre_g"
  | "sodium_mg";

export type Confidence = "High" | "Med" | "Low";

export type LabelData = {
  basis: "per_serve" | "per_100g";
  servingSize: { value: number; unit: "g" | "ml" };
  nutrients: Partial<Record<NutrientKey, { value: number; unit: string; confidence: Confidence }>>;
};

export const mockLabel: LabelData = {
  basis: "per_serve",
  servingSize: { value: 60, unit: "g" },
  nutrients: {
    energy_kj: { value: 750, unit: "kJ", confidence: "High" },
    energy_kcal: { value: 180, unit: "kcal", confidence: "Med" },
    protein_g: { value: 12, unit: "g", confidence: "High" },
    carbs_g: { value: 20, unit: "g", confidence: "High" },
    fat_g: { value: 6, unit: "g", confidence: "High" },
    sugars_g: { value: 8, unit: "g", confidence: "Med" },
    fibre_g: { value: 4, unit: "g", confidence: "Low" },
    sodium_mg: { value: 220, unit: "mg", confidence: "High" },
  },
};
