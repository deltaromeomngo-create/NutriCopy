// app/review.tsx
import { Link } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { getCurrentLabel, setCurrentLabel } from "../lib/labelStore";
import type { NutrientKey } from "../lib/mockLabel";
import type { Basis } from "../lib/nutritionFormat";
import { getReviewRows, servingSizeText } from "../lib/nutritionFormat";


const SHOW_OCR_OVERLAY = true; // dev-only, set false before commit


/* -----------------------------
   Constants
------------------------------ */

const EXPECTED_NUTRIENTS: Array<{ key: NutrientKey; label: string }> = [
  { key: "energy_kj", label: "Energy (kJ)" },
  { key: "energy_kcal", label: "Energy (kcal)" },
  { key: "protein_g", label: "Protein" },
  { key: "fat_g", label: "Fat" },
  { key: "carbs_g", label: "Carbohydrate" },
  { key: "sugars_g", label: "Sugars" },
  { key: "fibre_g", label: "Fibre" },
  { key: "sodium_mg", label: "Sodium" },
];

// Expo sets __DEV__ in dev builds
const DEV =
  typeof __DEV__ !== "undefined"
    ? __DEV__
    : process.env.NODE_ENV !== "production";

/* -----------------------------
   Helpers
------------------------------ */

function confidenceDot(confidence?: "High" | "Med" | "Low") {
  return confidence ? "●" : "";
}

function confidenceColor(confidence?: "High" | "Med" | "Low") {
  if (confidence === "High") return "#2ecc71";
  if (confidence === "Med") return "#f1c40f";
  if (confidence === "Low") return "#e74c3c";
  return "#999";
}

/**
 * Display-only heuristic filter for OCR raw text.
 * Conservative by design.
 */
function filterRawLines(lines: string[]) {
  return lines.filter((l) => {
    const s = l.trim();
    if (!s) return false;

    if (/nutrition information|average qty|avg qty|daily intake/i.test(s))
      return false;
    if (/ingredients?|may contain|contains:/i.test(s)) return false;
    if (/manufactured by|made in|packed in/i.test(s)) return false;
    if (/store|refrigerate|instructions|enjoy|serve/i.test(s)) return false;
    if (/https?:\/\/|www\./i.test(s)) return false;
    if (/^\d{8,}$/.test(s.replace(/\s/g, ""))) return false;
    if (s.length <= 2) return false;

    return true;
  });
}

/**
 * Dev-only candidate extraction (line-based, no bounding boxes).
 * Goal: help you SEE whether values/units exist in raw text at all.
 * This is not “final parsing logic” — it’s instrumentation.
 */
type DebugCandidate = {
  lineIndex: number;
  line: string;
  raw: string;
  value: number;
  unit: string;
};

function normalizeUnit(u: string) {
  const s = (u || "").trim();
  if (!s) return "";
  if (/^kj$/i.test(s)) return "kJ";
  if (/^kcal$/i.test(s)) return "kcal";
  if (/^cal$/i.test(s)) return "cal";
  if (s === "µg") return "mcg";
  return s.toLowerCase();
}

function extractCandidatesFromLines(lines: string[]): DebugCandidate[] {
  const out: DebugCandidate[] = [];
  const reCombined =
    /(\d+(?:\.\d+)?)\s*(mg|g|kg|mcg|µg|ug|kj|kcal|cal|ml)\b/gi;

  lines.forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (!line) return;

    reCombined.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = reCombined.exec(line)) !== null) {
      const value = Number(m[1]);
      if (!Number.isFinite(value)) continue;

      out.push({
        lineIndex,
        line,
        raw: m[0],
        value,
        unit: normalizeUnit(m[2]),
      });
    }

    if (/calories/i.test(line) && !/kcal|cal\b/i.test(line)) {
      const after = line.replace(/.*calories/i, "");
      const num = after.match(/(\d+(?:\.\d+)?)/)?.[1];
      if (num) {
        const v = Number(num);
        if (Number.isFinite(v)) {
          out.push({
            lineIndex,
            line,
            raw: num,
            value: v,
            unit: "",
          });
        }
      }
    }
  });

  const seen = new Set<string>();
  return out.filter((c) => {
    const key = `${c.lineIndex}::${c.raw}::${c.unit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* -----------------------------
   Component
------------------------------ */

export default function Review() {
const [viewBasis, setViewBasis] =
  useState<"per_serve" | "per_100g">("per_serve");

const [customGrams, setCustomGrams] = useState<number | null>(null);
const [customServes, setCustomServes] = useState<number | null>(null);


const saveFade = useRef(new Animated.Value(0)).current;

const [isEditingName, setIsEditingName] = useState(false);

const [showRaw, setShowRaw] = useState(false);
const [showDebug, setShowDebug] = useState(false);

// derived helpers (MUST come before use)
const wantsServes = viewBasis === "per_serve";

const displayBasis: Basis =
  customGrams != null || customServes != null ? "custom" : viewBasis;

// alias for existing code paths
const basis = displayBasis;

// optional helper if you still want it
const isPerServe = wantsServes;


  const label = getCurrentLabel();

  useEffect(() => {
    if (!label) return;

    const storedGrams = label.consumption?.customGrams;
    const storedServes = label.consumption?.customServes;

    // Reset first
    setCustomGrams(null);
    setCustomServes(null);

    // Prefer grams when present (and show grams UI)
    if (Number.isFinite(storedGrams)) {
      setViewBasis("per_100g");
      setCustomGrams(storedGrams as number);
      return;
    }

    // Otherwise fall back to serves (and show serves UI)
    if (Number.isFinite(storedServes)) {
      setViewBasis("per_serve");
      setCustomServes(storedServes as number);
    }
  }, [label]);

  useEffect(() => {
  const hasConsumption =
    customGrams != null || customServes != null;

  if (!hasConsumption) {
    saveFade.setValue(0);
    return;
  }

  const t = setTimeout(() => {
    Animated.timing(saveFade, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, 500); // ← deliberate delay

  return () => clearTimeout(t);
}, [customGrams, customServes]);





    const fileName =
    typeof (label as any)?.fileName === "string" ? (label as any).fileName : "";

  const storedName =
    typeof (label as any)?.name === "string" ? ((label as any).name as string) : "";

  const [nameDraft, setNameDraft] = useState<string>(storedName);

  // If label changes (new scan / navigation), sync the draft
  useEffect(() => {
    setNameDraft(storedName);
  }, [storedName]);

  function commitConsumption(nextGrams: number | null, nextServes: number | null) {
    if (!label) return;

    const hasGrams = Number.isFinite(nextGrams);
    const hasServes = Number.isFinite(nextServes);

    // Preserve stored-only fields
    const rawLines = Array.isArray((label as any)?.rawLines)
      ? ((label as any).rawLines as string[])
      : undefined;

    const debug = (label as any).debug;
    const imageBase64 = (label as any).imageBase64;
    const fileNameOpt =
      typeof (label as any)?.fileName === "string" ? (label as any).fileName : undefined;

    setCurrentLabel(
      {
        basis: label.basis,
        servingSize: label.servingSize,
        nutrients: label.nutrients,
        ...(label.name ? { name: label.name } : {}),
        ...(hasGrams || hasServes
          ? {
              consumption: {
                ...(hasGrams ? { customGrams: nextGrams! } : {}),
                ...(hasServes ? { customServes: nextServes! } : {}),
              },
            }
          : {}),
      } as any,
      {
        rawLines,
        debug,
        imageBase64,
        fileName: fileNameOpt,
      }
    );
  }


  function commitName(next: string) {
    if (!label) return;

    const trimmed = next.trim();
    const name = trimmed.length ? trimmed : undefined;

    // Preserve stored-only fields while updating LabelData
    const rawLines = Array.isArray((label as any).rawLines)
      ? ((label as any).rawLines as string[])
      : undefined;

    const debug = (label as any).debug;
    const imageBase64 = (label as any).imageBase64;
    const fileNameOpt =
      typeof (label as any)?.fileName === "string" ? (label as any).fileName : undefined;

    setCurrentLabel(
      {
        basis: label.basis,
        servingSize: label.servingSize,
        nutrients: label.nutrients,
        ...(name ? { name } : {}),
      } as any,
      {
        rawLines,
        debug,
        imageBase64,
        fileName: fileNameOpt,
      }
    );
  }

  const tokens = label?.debug?.tokens ?? [];
  const debug = (label as any)?.debug?.server;
  const clientParse = (label as any)?.debug?.clientParse;


  // ---- SAFE DEFAULTS (must exist even when label is null) ----
  const rawLines = Array.isArray((label as any)?.rawLines)
    ? ((label as any).rawLines as string[])
    : [];

  const filteredRaw = useMemo(() => filterRawLines(rawLines), [rawLines]);

  const debugCandidates = useMemo(
    () => extractCandidatesFromLines(filteredRaw),
    [filteredRaw]
  );


  if (!label) {
    return (
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 12,
          paddingBottom: 32,
        }}
      >
        <Text style={{ fontSize: 24 }}>Review</Text>

    
        
        {DEV && (label as any)?.imageBase64 && (
          <View
            style={{
              marginVertical: 12,
              borderWidth: 1,
              borderColor: "#ddd",
              position: "relative",
            }}
          >
            <img
              src={`data:image/jpeg;base64,${(label as any).imageBase64}`}
              style={{ width: "100%", display: "block" }}
            />

            {SHOW_OCR_OVERLAY && tokens.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                }}
              >
                {tokens.map((t: any, i: number) => {
                  const isNumber = /^\d+([.,]\d+)?$/.test(t.text);
                  const isPercent = t.text.includes("%");

                  const color = isPercent
                    ? "rgba(255,0,0,0.35)"
                    : isNumber
                    ? "rgba(0,180,0,0.35)"
                    : "rgba(0,120,255,0.25)";

                  return (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: `${t.bbox.x0 * 100}%`,
                        top: `${t.bbox.y0 * 100}%`,
                        width: `${(t.bbox.x1 - t.bbox.x0) * 100}%`,
                        height: `${(t.bbox.y1 - t.bbox.y0) * 100}%`,
                        backgroundColor: color,
                        border: `1px solid ${color}`,
                      }}
                    />
                  );
                })}
              </div>
            )}
          </View>
        )}


        <View
          style={{
            padding: 12,
            borderRadius: 8,
            backgroundColor: "#f6f6f6",
            borderWidth: 1,
            borderColor: "#ddd",
          }}
        >
          <Text style={{ fontWeight: "600" }}>No scan yet.</Text>
          <Text style={{ color: "#666", marginTop: 4 }}>
            Upload a label or enter nutrition manually to get started.
          </Text>
        </View>

        <Link href="/" asChild>
          <Pressable style={{ padding: 12, borderWidth: 1, borderRadius: 8 }}>
            <Text>Back to Scan</Text>
          </Pressable>
        </Link>

        <Link href="/input" asChild>
          <Pressable style={{ padding: 12, borderWidth: 1, borderRadius: 8 }}>
            <Text>Enter Manually</Text>
          </Pressable>
        </Link>
      </ScrollView>
    );
  }

  // --- confidence heuristic (label is guaranteed to exist here) ---
const nutrientEntries = Object.values(label.nutrients ?? {}).filter(
  (n): n is { value: number; unit: string; confidence: "High" | "Med" | "Low" } =>
    !!n && typeof (n as any).value === "number"
);

const lowConfCount = nutrientEntries.filter(
  (n) => n.confidence === "Low"
).length;

const mostlyLowConfidence =
  nutrientEntries.length > 0 && lowConfCount / nutrientEntries.length > 0.4;


  const rows = getReviewRows(
  label,
  displayBasis,
  wantsServes ? undefined : customGrams ?? undefined,
  wantsServes ? customServes ?? undefined : undefined
);



  const detectedCount = EXPECTED_NUTRIENTS.filter(
    (n) => typeof label.nutrients?.[n.key]?.value === "number"
  ).length;

  const hasZeroDetected = detectedCount === 0;
  const hasSomeMissing =
    detectedCount > 0 && detectedCount < EXPECTED_NUTRIENTS.length;


  const nextBasis = viewBasis === "per_serve" ? "per_100g" : "per_serve";
  const toggleLabel = viewBasis === "per_serve" ? "View per 100 g" : "View per serve";


  return (
    <ScrollView
      contentContainerStyle={{
        padding: 16,
        gap: 12,
        paddingBottom: 32,
      }}
    >
      <Text style={{ fontSize: 24 }}>Review</Text>
      {/* Label name (manual, optional) */}
      <View style={{ gap: 6, marginTop: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 12, color: "#666" }}>Label name (optional)</Text>
          <Text style={{ fontSize: 12, color: "#666", }}>
            Edit
          </Text>
        </View>

        <TextInput
          value={nameDraft}
          onChangeText={setNameDraft}
          placeholder={
            (fileName ? `${fileName} (Edit)` : "e.g. Chicken nuggets (Edit)")
          }
          onFocus={() => setIsEditingName(true)}
          onBlur={() => {
            setIsEditingName(false);
            commitName(nameDraft);
          }}
          style={{
            borderWidth: 1,
            borderRadius: 8,
            padding: 10,
            borderColor: isEditingName ? "#4c6ef5" : "#ccc",
          }}
        />

        <Text style={{ fontSize: 11, color: "#888" }}>
          Click and type to rename this label
        </Text>

        <Text style={{ fontSize: 11, color: "#888" }}>
          This is saved with the label and included in exports.
        </Text>
      </View>

      {mostlyLowConfidence && (
                <View
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    backgroundColor: "#fffbe6",
                    borderWidth: 1,
                    borderColor: "#f1e3a3",
                    gap: 6,
                  }}
                >
                  <Text style={{ fontWeight: "600" }}>
                    This scan may need a quick check
                  </Text>
                  <Text style={{ color: "#666" }}>
                    Some values were hard to read — please review before exporting.
                  </Text>
                </View>
              )}


      {/* Messaging */}
      {hasZeroDetected && (
        <View
          style={{
            padding: 12,
            borderRadius: 8,
            backgroundColor: "#fff3f3",
            borderWidth: 1,
            borderColor: "#e0b4b4",
            gap: 8,
          }}
        >
          <Text style={{ fontWeight: "600" }}>
            We couldn’t find nutrition values in this image.
          </Text>
          <Text style={{ color: "#666" }}>
            You can try a clearer photo or enter the values manually.
          </Text>

          <Link href="/input" asChild>
            <Pressable
              style={{
                alignSelf: "flex-start",
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderWidth: 1,
                borderRadius: 8,
                backgroundColor: "#fff",
              }}
            >
              <Text>Fix manually</Text>
            </Pressable>
          </Link>
        </View>
      )}

      {hasSomeMissing && !hasZeroDetected && (
        <View
          style={{
            padding: 12,
            borderRadius: 8,
            backgroundColor: "#f6f6f6",
            borderWidth: 1,
            borderColor: "#ddd",
            gap: 8,
          }}
        >
          <Text style={{ fontWeight: "600" }}>
            Review and adjust if needed
          </Text>
          <Text style={{ color: "#666" }}>
            Most labels need a quick check — you can edit any values below.
          </Text>

          <Link href="/input" asChild>
            <Pressable
              style={{
                alignSelf: "flex-start",
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderWidth: 1,
                borderRadius: 8,
                backgroundColor: "#fff",
              }}
            >
              <Text>Fix manually</Text>
            </Pressable>
          </Link>
        </View>
      )}

      {/* Basis toggle */}
      <Pressable
        onPress={() => {
          setViewBasis(nextBasis);
          // clear the other input so UI stays consistent
          setCustomGrams(null);
          setCustomServes(null);
        }}

        style={{
          padding: 12,
          borderWidth: 1,
          borderRadius: 8,
          alignSelf: "flex-start",
        }}
      >
        <Text>{toggleLabel}</Text>
        <Text style={{ fontSize: 12, color: "#666" }}>
          Tap to switch units
        </Text>
      </Pressable>

      {label.servingSize.value >= 5 ? (
        <Text>Serving size: {servingSizeText(label, viewBasis)}</Text>
      ) : (
        <View style={{ marginBottom: 4 }}>
          <Text style={{ color: "#999" }}>Serving size: —</Text>
          <Text style={{ fontSize: 12, color: "#999" }}>
            Not detected
          </Text>
        </View>
      )}

      {Platform.OS === "web" && (
        <View style={{ gap: 6, maxWidth: 260, marginTop: 8 }}>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ fontSize: 12, color: "#666" }}>
              {wantsServes ? "Serves eaten" : "Grams eaten"} (optional)
            </Text>

            {(customGrams != null || customServes != null) && (
              <Animated.Text
                style={{
                  fontSize: 11,
                  color: "#2e7d32",
                  textAlign: "center",
                  opacity: saveFade,
                }}
              >
                ✓ Saved for export in Consumption
              </Animated.Text>
            )}

            </View>



        <View
  style={{
    padding: 8,
    borderWidth: 1,
    borderRadius: 6,
    borderColor: "#ccc",
  }}
>
  <input
    type="number"
    min={1}
    step={1}
    inputMode="numeric"
    placeholder={wantsServes ? "e.g. 2" : "e.g. 150"}
    value={wantsServes ? customServes ?? "" : customGrams ?? ""}
    onChange={(e) => {
      const raw = (e.target as HTMLInputElement).value;

      if (raw === "") {
        setCustomGrams(null);
        setCustomServes(null);
        commitConsumption(null, null);
        return;
      }

      const v = Number(raw);

      if (Number.isFinite(v) && v > 0) {
        if (wantsServes) {
          setCustomServes(v);
          setCustomGrams(null);
          commitConsumption(null, v);
        } else {
          setCustomGrams(v);
          setCustomServes(null);
          commitConsumption(v, null);
        }
      }
    }}
    style={{
      width: "100%",
      border: "none",
      outline: "none",
      fontSize: 14,
      background: "transparent",
    }}
  />
</View>

{(customGrams != null || customServes != null) && (
  <View style={{ gap: 4, marginTop: 6 }}>
    <Text style={{ fontSize: 12, color: "#666" }}>
      Adapts math to realistic sizes — not what the label assumes.
    </Text>
    <Text style={{ fontSize: 11, color: "#888" }}>
      Conversions are calculated from the label’s serving size and macros. Please
      double-check values before exporting.
    </Text>
  </View>
)}
</View>
)}



<View
  style={
    Platform.OS === "web"
      ? {
          flexDirection: "row",
          alignItems: "flex-start",
          width: "100%",
           maxWidth: 1000,
          marginTop: 12,
          gap: 64,
        }
      : { marginTop: 12 }
  }
>
  {/* Left: nutrients */}
  <View
  style={
    Platform.OS === "web"
      ? { width: 520, maxWidth: 520, flexShrink: 0 }
      : undefined
  }
>

    {EXPECTED_NUTRIENTS.map((n) => {
      // prevent duplicate Energy rows
      if (n.key === "energy_kcal" && rows.some((r) => r.id === "energy")) {
        return null;
      }

      const row =
        n.key === "energy_kj" || n.key === "energy_kcal"
          ? rows.find((r) => r.id === "energy")
          : rows.find((r) => r.id === n.key);

      if (row) {
        return (
          <View key={n.key} style={{ marginBottom: 12 }}>
            <Text style={{ lineHeight: 24 }}>
              {row.label}: {row.valueText}{" "}
              <Text style={{ color: confidenceColor(row.confidence) }}>
                {confidenceDot(row.confidence)}
              </Text>
            </Text>
          </View>
        );
      } 


      return (
        <View key={n.key} style={{ marginBottom: 12 }}>
          <Text style={{ color: "#999", lineHeight: 24 }}>{n.label}: —</Text>
          <Text style={{ fontSize: 12, color: "#999" }}>Not detected</Text>
        </View>
      );

    })}

    <Text style={{ color: "#666", fontSize: 12, marginTop: 10 }}>
      ● Confidence shows how clearly the value appeared on the label
    </Text>

    <Link href="/confidence" asChild>
      <Pressable>
        <Text
          style={{
            fontSize: 12,
            color: "#4c6ef5",
            textDecorationLine: "underline",
            marginTop: 2,
          }}
        >
          Confidence explained
        </Text>
      </Pressable>
    </Link>
  </View>

  {/* Right: image (web only, spacing preserved) */}
  {Platform.OS === "web" ? (
    (label as any)?.imageBase64 ? (
      <View
        style={{
          width: 360,
          flexShrink: 0,
          borderWidth: 1,
          borderColor: "#ddd",
          borderRadius: 10,
          padding: 10,
          backgroundColor: "#fafafa",
        }}
      >
        <img
          src={`data:image/jpeg;base64,${(label as any).imageBase64}`}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
            borderRadius: 6,
          }}
        />
        <Text
          style={{
            fontSize: 12,
            color: "#666",
            marginTop: 8,
            textAlign: "center",
          }}
        >
          Original label
        </Text>
      </View>
    ) : (
      <View style={{ width: 360, flexShrink: 0 }} />
    )
  ) : null}
</View>

      
       

      {/* Dev Debug Toggle */}
      {DEV && (
        <View style={{ marginTop: 16 }}>
          <Pressable
            onPress={() => setShowDebug((v) => !v)}
            style={{
              padding: 12,
              borderWidth: 1,
              borderRadius: 8,
              backgroundColor: showDebug ? "#eef3ff" : "#fff",
              borderColor: "#c9d6ff",
              alignSelf: "flex-start",
            }}
          >
            <Text style={{ fontWeight: "600", color: "#243a8f" }}>
              {showDebug ? "Hide Debug" : "Show Debug"}
            </Text>
            <Text style={{ fontSize: 12, color: "#243a8f" }}>
              Dev-only: OCR + parsing instrumentation
            </Text>
          </Pressable>

          {showDebug && (
            <View
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 8,
                backgroundColor: "#eef3ff",
                borderWidth: 1,
                borderColor: "#c9d6ff",
                gap: 6,
              }}
            >
              <Text style={{ fontSize: 12 }}>
                Tokens: {tokens.length}
              </Text>
              <Text style={{ fontSize: 12 }}>
                Raw lines: {rawLines.length}
              </Text>
              <Text style={{ fontSize: 12 }}>
                Filtered lines: {filteredRaw.length}
              </Text>
              <Text style={{ fontSize: 12 }}>
                Candidates: {debugCandidates.length}
              </Text>
            </View>
          )}
        </View>
      )}

      {fileName ? (
        <Text style={{ fontSize: 12, color: "#666", marginTop: 10 }}>
          File: {fileName}
        </Text>
      ) : null}



            {/* Raw text */}
      {rawLines.length > 0 && (
        <View style={{ marginTop: 16 }}>
          <Pressable
            onPress={() => setShowRaw((v) => !v)}
            style={{ padding: 12, borderWidth: 1, borderRadius: 8 }}
          >
            <Text>{showRaw ? "Hide scanned text" : "Show scanned text"}</Text>
          </Pressable>

          {showRaw && (
            <View
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 8,
                backgroundColor: "#f6f6f6",
                borderWidth: 1,
                borderColor: "#ddd",
              }}
            >
              {filteredRaw.map((line, i) => (
                <Text
                  key={i}
                  style={{
                    fontSize: 12,
                    color: "#444",
                    fontFamily: "monospace",
                  }}
                >
                  {line}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      <View style={{ marginTop: 16 }} />

      {/* Navigation */}
      <Link href="/export" asChild>
        <Pressable style={{ padding: 12, borderWidth: 1, borderRadius: 8 }}>
          <Text>Export</Text>
        </Pressable>
      </Link>

      <Link href="/input" asChild>
        <Pressable style={{ padding: 12, borderWidth: 1, borderRadius: 8 }}>
          <Text>Edit Manually</Text>
        </Pressable>
      </Link>

      <Link href="/" asChild>
        <Pressable style={{ padding: 12, borderWidth: 1, borderRadius: 8 }}>
          <Text>Back to Scan</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}