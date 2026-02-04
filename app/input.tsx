// app/input.tsx
import { router } from "expo-router";
import { useMemo, useState } from "react";
import {
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import HoverPressable from "../components/HoverPressable";
import { getCurrentLabel, setCurrentLabel } from "../lib/labelStore";
import type { Confidence, LabelData, NutrientKey } from "../lib/mockLabel";

type Unit = "g" | "ml";

const NUTRIENTS: Array<{ key: NutrientKey; label: string; unit: string }> = [
  { key: "energy_kj", label: "Energy", unit: "kJ" },
  { key: "energy_kcal", label: "Energy", unit: "kcal" },
  { key: "protein_g", label: "Protein", unit: "g" },
  { key: "carbs_g", label: "Carbohydrate", unit: "g" },
  { key: "fat_g", label: "Fat", unit: "g" },
  { key: "sugars_g", label: "Sugars", unit: "g" },
  { key: "fibre_g", label: "Fibre", unit: "g" },
  { key: "sodium_mg", label: "Sodium", unit: "mg" },
];

function toNumberOrNull(s: string) {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function Input() {
  const existing = getCurrentLabel();

  const [servingValue, setServingValue] = useState<string>(
    existing ? String(existing.servingSize.value) : ""
  );
  const [servingUnit, setServingUnit] = useState<Unit>(
    existing?.servingSize.unit ?? "g"
  );

  const [values, setValues] = useState<Record<NutrientKey, string>>(() => {
    const empty: Record<NutrientKey, string> = {
      energy_kj: "",
      energy_kcal: "",
      protein_g: "",
      carbs_g: "",
      fat_g: "",
      sugars_g: "",
      fibre_g: "",
      sodium_mg: "",
    };

    if (!existing) return empty;

    for (const key in existing.nutrients) {
      const k = key as NutrientKey;
      empty[k] = String(existing.nutrients[k]?.value ?? "");
    }

    return empty;
  });

  const defaultConfidence: Confidence = "High";

  const servingNum = useMemo(() => toNumberOrNull(servingValue), [servingValue]);
  const canProceed = servingNum != null && servingNum > 0;

  function onChange(key: NutrientKey, next: string) {
    setValues((prev) => ({ ...prev, [key]: next }));
  }

  function buildLabel(): LabelData | null {
    const serving = toNumberOrNull(servingValue);
    if (serving == null || serving <= 0) return null;

    const nutrients: LabelData["nutrients"] = {};

    for (const n of NUTRIENTS) {
      const v = toNumberOrNull(values[n.key]);
      if (v == null) continue;

      nutrients[n.key] = {
        value: v,
        unit: n.unit,
        confidence: defaultConfidence,
      };
    }

    return {
      basis: "per_serve",
      servingSize: { value: serving, unit: servingUnit },
      nutrients,
    };
  }

  function saveAndNavigate(path: "/" | "/review" | "/export") {
  if (path === "/") {
    router.push(path);
    return;
  }

  const label = buildLabel();
  if (!label) return;

  // Preserve existing user-provided label name (entered on Review screen)
  const existing = getCurrentLabel();
  const name =
    typeof (existing as any)?.name === "string" ? (existing as any).name : undefined;

  setCurrentLabel({
    ...label,
    ...(name ? { name } : {}),
  });

  router.push(path);
}


  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 24,
          alignItems: "center",
        }}
      >
        <View style={{ width: "100%", maxWidth: 520, gap: 12 }}>
          <Text style={{ fontSize: 24 }}>Manual Input</Text>

          <Text style={{ fontSize: 14, color: "#666" }}>
            Enter nutrition per serving. Review/Export can switch to per 100 g.
          </Text>

          {/* Serving size */}
          <View style={{ gap: 6 }}>
            <Text>Serving size</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                value={servingValue}
                onChangeText={setServingValue}
                keyboardType="numeric"
                placeholder="e.g. 60"
                style={{
                  borderWidth: 1,
                  borderRadius: 8,
                  padding: 10,
                  flex: 1,
                }}
              />
              <HoverPressable
                onPress={() => setServingUnit(servingUnit === "g" ? "ml" : "g")}
                style={{
                  borderWidth: 1,
                  borderRadius: 8,
                  padding: 10,
                  minWidth: 64,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text>{servingUnit}</Text>
              </HoverPressable>
            </View>

            {!canProceed && (
              <Text style={{ color: "#c00", fontSize: 12 }}>
                Serving size must be a number greater than 0.
              </Text>
            )}
          </View>

          {/* Nutrients */}
          <View style={{ gap: 10 }}>
            {NUTRIENTS.map((n) => (
              <View key={n.key} style={{ gap: 6 }}>
                <Text>
                  {n.label} ({n.unit})
                </Text>
                <TextInput
                  value={values[n.key]}
                  onChangeText={(t) => onChange(n.key, t)}
                  keyboardType="numeric"
                  placeholder="leave blank to omit"
                  style={{
                    borderWidth: 1,
                    borderRadius: 8,
                    padding: 10,
                  }}
                />
              </View>
            ))}
          </View>

          {/* Actions */}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <HoverPressable
              disabled={!canProceed}
              onPress={() => saveAndNavigate("/review")}
              style={{
                padding: 12,
                borderWidth: 1,
                borderRadius: 8,
                opacity: canProceed ? 1 : 0.4,
                minWidth: 160,
                alignItems: "center",
              }}
            >
              <Text>Review</Text>
            </HoverPressable>

            <HoverPressable
              disabled={!canProceed}
              onPress={() => saveAndNavigate("/export")}
              style={{
                padding: 12,
                borderWidth: 1,
                borderRadius: 8,
                opacity: canProceed ? 1 : 0.4,
                minWidth: 160,
                alignItems: "center",
              }}
            >
              <Text>Export</Text>
            </HoverPressable>

            <HoverPressable
              onPress={() => saveAndNavigate("/")}
              style={{
                padding: 12,
                borderWidth: 1,
                borderRadius: 8,
                minWidth: 160,
                alignItems: "center",
              }}
            >
              <Text>Back to Scan</Text>
            </HoverPressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
