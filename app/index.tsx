// app/index.tsx
import { Link, router } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Text,
  View,
} from "react-native";
import HoverPressable from "../components/HoverPressable";
import {
  clearCurrentLabel,
  getCurrentLabel,
  setCurrentLabel,
} from "../lib/labelStore";
import type { LabelData } from "../lib/mockLabel";

/* -----------------------------
   Web-only helpers
------------------------------ */

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return reject(new Error("Invalid file"));
      resolve(result.split(",")[1]);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function imageLooksLowContrast(base64: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(false);

      ctx.drawImage(img, 0, 0);

      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

      let min = 255;
      let max = 0;

      for (let i = 0; i < data.length; i += 4) {
        const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (v < min) min = v;
        if (v > max) max = v;
      }

      resolve(max - min < 40);
    };

    img.onerror = () => resolve(false);
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}


function linesToLabelData(lines: string[]): LabelData {
  const nutrients: any = {};
  let servingSize: { value: number; unit: "g" | "ml" } | null = null;

  const cleaned = lines.map((l) => l.trim()).filter(Boolean);

  function has(key: string) {
    return nutrients[key] != null;
  }

  function findFirstNearbyValue(
    index: number,
    unitRegex: RegExp,
    maxDistance = 3
  ): number | null {
    for (let offset = 1; offset <= maxDistance; offset++) {
      const candidate = cleaned[index + offset];
      if (!candidate) continue;
      if (/per\s*100|per\s*serve|average|quantity|di\b/i.test(candidate)) continue;
      const m = candidate.match(/(\d+(?:\.\d+)?)/);
      if (m && unitRegex.test(candidate)) return Number(m[1]);
    }
    return null;
  }

  function findFirstUnitValue(
    startIndex: number,
    unitRegex: RegExp,
    maxDistance = 4
  ): number | null {
    for (let offset = 0; offset <= maxDistance; offset++) {
      const candidate = cleaned[startIndex + offset];
      if (!candidate) continue;

      // Skip %DI noise
      if (/%/.test(candidate)) continue;

      const m = candidate.match(/(\d+(?:[.,·]\s*\d+)?)/);
      if (m) {
        const raw = m[1].replace(/[·,]/g, ".").replace(/\s+/g, "");
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;

        const unit = candidate.match(/\b(g|mg|kj|kcal|cal)\b/i)?.[1];
        if (unit && unitRegex.test(unit)) {
          return value;
        }
      }

      if (m && unitRegex.test(m[2])) {
        return Number(m[1]);
      }
    }
    return null;
  }


  for (let i = 0; i < cleaned.length; i++) {
    const line = cleaned[i];

    if (!servingSize && /serving size/i.test(line)) {
      const m = line.match(/(\d+(?:\.\d+)?)\s*(g|ml)\b/i);
      if (m) {
        servingSize = {
          value: Number(m[1]),
          unit: m[2].toLowerCase() as "g" | "ml",
        };
      }
    }

    if (!has("energy_kj") && /^energy\b/i.test(line)) {
      const v = findFirstNearbyValue(i, /(kj|kcal|cal)/i);
      if (v != null) nutrients.energy_kj = { value: v, unit: "kJ", confidence: "Med" };
    }

    if (!has("protein_g") && /^protein\b/i.test(line)) {
      // Case 1: same-line "Protein 5.89 g"
      const sameLine = line.match(/(\d+(?:\.\d+)?)\s*g\b/i);
      if (sameLine) {
        nutrients.protein_g = {
          value: Number(sameLine[1]),
          unit: "g",
          confidence: "High",
        };
      } else {
        // Case 2: numeric-only line (columnar layout)
        const next = cleaned[i + 1];
        const nextNext = cleaned[i + 2];

        if (
          next &&
          /^\d+(?:\.\d+)?$/.test(next) && // pure number
          nextNext &&
          /^(fat|carbohydrate|carbs|sugars|fibre|fiber)\b/i.test(nextNext)
        ) {
          nutrients.protein_g = {
            value: Number(next),
            unit: "g",
            confidence: "Med",
          };
        } else {
          // Case 3: fallback forward scan with unit
          for (let offset = 1; offset <= 3; offset++) {
            const vLine = cleaned[i + offset];
            if (!vLine) continue;

            const num = vLine.match(/(\d+(?:\.\d+)?)/);
            if (!num) continue;

            const unitLine = `${cleaned[i + offset] ?? ""} ${cleaned[i + offset + 1] ?? ""}`;
            if (/\bg\b/i.test(unitLine)) {
              nutrients.protein_g = {
                value: Number(num[1]),
                unit: "g",
                confidence: "Med",
              };
              break;
            }
          }
        }
      }
    }





    if (
      !has("fat_g") &&
      (/^fat\b/i.test(line) || /^fat[-,\s]*total\b/i.test(line)) &&
      !/satur/i.test(line)
    ) {
      const sameLine = line.match(/(\d+(?:\.\d+)?)\s*g\b/i);
      if (sameLine) {
        nutrients.fat_g = {
          value: Number(sameLine[1]),
          unit: "g",
          confidence: "High",
        };
      } else {
        const v = findFirstNearbyValue(i, /\bg\b/i);
        if (v != null)
          nutrients.fat_g = { value: v, unit: "g", confidence: "Med" };
      }
    }


    if (
      !has("carbs_g") &&
      (/^carbohydrate\b/i.test(line) || /^carbs\b/i.test(line))
    ) {
      const sameLine = line.match(/(\d+(?:\.\d+)?)\s*g\b/i);
      if (sameLine) {
        nutrients.carbs_g = {
          value: Number(sameLine[1]),
          unit: "g",
          confidence: "High",
        };
      } else {
        const v = findFirstNearbyValue(i, /\bg\b/i);
        if (v != null)
          nutrients.carbs_g = { value: v, unit: "g", confidence: "Med" };
      }
    }


    if (!has("sugars_g") && /^-?\s*sugars?\b/i.test(line)) {
      const sameLine = line.match(/(\d+(?:\.\d+)?)\s*g\b/i);
      if (sameLine) {
        nutrients.sugars_g = {
          value: Number(sameLine[1]),
          unit: "g",
          confidence: "High",
        };
      } else {
        const v = findFirstNearbyValue(i, /\bg\b/i);
        if (v != null)
          nutrients.sugars_g = { value: v, unit: "g", confidence: "Med" };
      }
    }


    if (!has("sodium_mg") && /^sodium\b/i.test(line)) {
      const sameLine = line.match(/(\d+(?:\.\d+)?)\s*mg\b/i);
      if (sameLine) {
        nutrients.sodium_mg = {
          value: Number(sameLine[1]),
          unit: "mg",
          confidence: "High",
        };
      } else {
        const v = findFirstNearbyValue(i, /\bmg\b/i);
        if (v != null)
          nutrients.sodium_mg = { value: v, unit: "mg", confidence: "Med" };
      }
    }

    if (
      !has("fibre_g") &&
      /\b(dietary\s*)?fib(re|er)\b/i.test(line)
    ) {
      const v = findFirstUnitValue(i, /\bg\b/i);
      if (v != null) {
        nutrients.fibre_g = {
          value: v,
          unit: "g",
          confidence: "High",
        };
      }
    }



  }

  return {
    basis: "per_serve",
    servingSize: servingSize ?? { value: 1, unit: "g" },
    nutrients,
  };
}

import type { Confidence, NutrientKey } from "../lib/mockLabel";

const PARSED_PROMOTION_MAP: Record<
  string,
  { key: NutrientKey; unit: string }
> = {
  protein: { key: "protein_g", unit: "g" },
  fat_total: { key: "fat_g", unit: "g" },
  carbohydrate: { key: "carbs_g", unit: "g" },
  sugars: { key: "sugars_g", unit: "g" },
  fibre: { key: "fibre_g", unit: "g" },
  energy_kj: { key: "energy_kj", unit: "kJ" },
};

const SERVER_KEY_MAP: Record<
  string,
  { key: NutrientKey; unit: string }
> = {
  energy_kj: { key: "energy_kj", unit: "kJ" },
  energy_kcal: { key: "energy_kcal", unit: "kcal" },

  protein_g: { key: "protein_g", unit: "g" },
  fat_g: { key: "fat_g", unit: "g" },
  carbs_g: { key: "carbs_g", unit: "g" },
  sugars_g: { key: "sugars_g", unit: "g" },
  fibre_g: { key: "fibre_g", unit: "g" },
  sodium_mg: { key: "sodium_mg", unit: "mg" },
};


const MIN_SERVING_SIZE_G = 5;

const MAX_PER_SERVE: Partial<Record<NutrientKey, number>> = {
  energy_kj: 8000,
  energy_kcal: 2000,

  protein_g: 100,
  fat_g: 100,
  carbs_g: 150,
  sugars_g: 100,
  fibre_g: 60,
  sodium_mg: 5000,
};



function serverToLabelData(data: any): LabelData | null {
  const flat = data?.nutrients;
  const parsed = data?.debug?.parsedNutrients;


  if (!flat && !parsed) return null;

  let servingValue = Number(data?.servingSize?.value);
  let servingUnit: "g" | "ml" = data?.servingSize?.unit === "ml" ? "ml" : "g";

  // If missing/implausible, keep as sentinel (UI hides <5g)
  if (!Number.isFinite(servingValue) || servingValue < MIN_SERVING_SIZE_G) {
    servingValue = 1;
  }


  const nutrients: LabelData["nutrients"] = {};
  let found = 0;

  // ---------- 1. Flat nutrients (preferred) ----------
  if (flat && typeof flat === "object") {
    for (const [serverKey, meta] of Object.entries(SERVER_KEY_MAP)) {
      const value = flat[serverKey];
      if (!Number.isFinite(value)) continue;

      const max = MAX_PER_SERVE[meta.key];
      if (max != null && value > max) continue;

      nutrients[meta.key] = {
        value,
        unit: meta.unit,
        confidence: "Med",
      };
      found++;
    }
  }

  // ---------- 2. Promote from parsedNutrients (fallback) ----------
  if (parsed && typeof parsed === "object") {
    for (const [parsedKey, meta] of Object.entries(PARSED_PROMOTION_MAP)) {
      if (nutrients[meta.key]) continue; // don’t overwrite better data

      const entry = parsed[parsedKey];
      const value = entry?.perServe;

      if (!Number.isFinite(value)) continue;

      // 🔽 INSERTED SAFEGUARD 🔽
      const per100g = entry?.per100g;

      if (
        Number.isFinite(per100g) &&
        servingValue >= MIN_SERVING_SIZE_G
      ) {
        const expected100 = (value / servingValue) * 100;
        const relDiff =
          Math.abs(expected100 - per100g) / Math.max(1, per100g);

        if (relDiff > 0.8) {
          continue;
        }
      }
      // 🔼 END SAFEGUARD 🔼

      let confidence: Confidence = "Low";

      if (
        Number.isFinite(entry?.perServe) &&
        Number.isFinite(entry?.per100g) &&
        servingValue >= 5
      ) {
        const expected100 = (entry.perServe / servingValue) * 100;
        const diff = Math.abs(expected100 - entry.per100g) / entry.per100g;

        if (diff < 0.3) {
          confidence = "Med"; // internally consistent
        }
      }


      const max = MAX_PER_SERVE[meta.key];
      if (max != null && value > max) continue;


      nutrients[meta.key] = {
        value,
        unit: meta.unit,
        confidence: "Low",
      };
      found++;
    }
  }


  // ---------- Promote serving size from OCR tokens (explicit only) ----------

  const tokens = data?.debug?.tokens;
  if (Array.isArray(tokens)) {
    for (const t of tokens) {
      const m = t?.text?.match(/^(\d+(?:\.\d+)?)\s*(g|ml)$/i);
      if (!m) continue;

      const v = Number(m[1]);
      if (Number.isFinite(v) && v >= MIN_SERVING_SIZE_G) {
        servingValue = v;
        servingUnit = m[2].toLowerCase() as "g" | "ml";
        break;
      }
    }
  }


  if (found === 0) return null;

  // ---------- Serving size (non-fatal) ----------
  if (!Number.isFinite(servingValue as any)) {
    servingValue = Number(data?.servingSize?.value);
  }

  if (!Number.isFinite(servingValue) || servingValue < MIN_SERVING_SIZE_G) {
    servingValue = 1; // sentinel; UI hides
  }

  return {
    basis: "per_serve",
    servingSize: {
      value: servingValue,
      unit: servingUnit,
    },
    nutrients,
  };


}



function isConfidence(x: any): x is Confidence {
  return x === "High" || x === "Med" || x === "Low";
}

function isServingUnit(x: any): x is "g" | "ml" {
  return x === "g" || x === "ml";
}


type ErrorState =
  | "OCR_FAILED"
  | "SUBSCRIPTION_REQUIRED"
  | "SUBSCRIPTION_CHECK_FAILED"
  | null;


export default function Index() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorState>(null);
  const [fileName, setFileName] = useState<string>("No file chosen");
  const [isDragging, setIsDragging] = useState(false);

  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasLabel = !!getCurrentLabel();

  const apiUrl = "/api/ocr";

  async function runOCRFromFile(file: File) {
    setLoading(true);
    setError(null);

    try {
      if (!file.type?.startsWith("image/")) {
        throw new Error("OCR_FAILED");
      }

      const imageBase64 = await fileToBase64(file);

      const res = await fetch(apiUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, debug: true }),
      });


      if (!res.ok) {
        let payload: any;
        try {
          payload = await res.json();
        } catch {
          throw new Error("OCR_FAILED");
        }

        if (
          payload?.code === "NOT_SUBSCRIBED" ||
          payload?.error === "NOT_SUBSCRIBED"
        ) {
          throw new Error("NOT_SUBSCRIBED");
        }

        if (
          payload?.code === "SUBSCRIPTION_CHECK_FAILED" ||
          payload?.error === "SUBSCRIPTION_CHECK_FAILED"
        ) {
          throw new Error("SUBSCRIPTION_CHECK_FAILED");
        }

        throw new Error("OCR_FAILED");

      }

      const data = await res.json();
      const label = serverToLabelData(data) ?? linesToLabelData(data.lines);
      setCurrentLabel(label, {
        rawLines: data.lines,
        debug: data.debug,
        imageBase64, // DEV ONLY
        fileName: file.name,
      });


      router.push("/review");
    } catch (err: any) {
  if (err?.message === "NOT_SUBSCRIBED") {
    setError("SUBSCRIPTION_REQUIRED");
  } else if (err?.message === "SUBSCRIPTION_CHECK_FAILED") {
    setError("SUBSCRIPTION_CHECK_FAILED");
  } else {
    setError("OCR_FAILED");
  }

    } finally {
      setLoading(false);
      setIsDragging(false);
      dragDepth.current = 0;
    }
  }

  async function onFileChosen(e: any) {
    const file: File | undefined = e?.target?.files?.[0];
    if (!file) return;
    setFileName(file.name || "Selected file");
    await runOCRFromFile(file);
  }

  function openPicker() {
    if (!loading) fileInputRef.current?.click();
  }

  function onDragEnter(e: any) {
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }

  function onDragOver(e: any) {
    e.preventDefault();
  }

  function onDragLeave(e: any) {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragging(false);
    }
  }

  async function onDrop(e: any) {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);

    const file: File | undefined = e.dataTransfer?.files?.[0];
    if (file) {
      setFileName(file.name);
      await runOCRFromFile(file);
    }
  }

  const buttonStyle = {
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    minWidth: 220,
    alignItems: "center" as const,
  };

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 16,
      }}
    >
      <Text style={{ fontSize: 24 }}>Scan</Text>

      <Text style={{ fontSize: 14, color: "#666", textAlign: "center" }}>
        Turn nutrition labels into clean, copyable data.
      </Text>

      <Text
        style={{
          fontSize: 15,
          color: "#777",
          textAlign: "center",
          marginTop: 6,
          maxWidth: 520,
          lineHeight: 18,
        }}
      >
        Scan nutrition labels → clean data you control.{"\n"}
        Use it anywhere — sheets, notes, trackers, your own system. Built for how you actually eat.{"\n"}
        Adapts math to realistic sizes — not what the label assumes.
      </Text>



      {Platform.OS === "web" && (
        <div
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          style={{
            width: "min(640px, 92vw)",
            minHeight: "220px",
            padding: "24px",
            border: isDragging ? "2px dashed #888" : "2px solid transparent",
            borderRadius: "14px",
            background: isDragging ? "#e9e9e9" : "transparent",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            disabled={loading}
            onChange={onFileChosen}
            style={{ display: "none" }}
          />

          <HoverPressable
            onPress={openPicker}
            disabled={loading}
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              alignItems: "center",
              justifyContent: "center",
              opacity: loading ? 0.6 : 1,
            }}
          >
            <Text style={{ fontSize: 52, lineHeight: 52, color: "#666", marginTop: -10 }}>
              +
            </Text>
          </HoverPressable>

          <Text style={{ fontSize: 14, color: "#666", textAlign: "center" }}>
            {isDragging ? "Drop to scan" : "Drag an image here, or click + to choose"}
          </Text>

          <Text style={{ fontSize: 12, color: "#666" }}>{fileName}</Text>

          {loading && <ActivityIndicator />}

                    {error === "OCR_FAILED" && (
                      <View
                      style={{
                        marginTop: 8,
                        padding: 12,
                        borderRadius: 8,
                        backgroundColor: "#fdecea",
                        maxWidth: 520,
                      }}
                    >
                      <Text style={{ color: "#b00020", fontWeight: "600" }}>
                        We couldn’t read this image.
                      </Text>
                      <Text style={{ color: "#b00020", marginTop: 4 }}>
                        Try a clearer photo with the full nutrition table visible.
                      </Text>
                    </View>
                  )}

                  {error === "SUBSCRIPTION_CHECK_FAILED" && (
                    <View
                      style={{
                        marginTop: 8,
                        padding: 12,
                        borderRadius: 8,
                        backgroundColor: "#fff4e5",
                        maxWidth: 520,
                        gap: 6,
                      }}
                    >
                      <Text style={{ color: "#8a4b00", fontWeight: "600" }}>
                        Couldn’t verify subscription
                      </Text>
                      <Text style={{ color: "#8a4b00" }}>
                        We couldn’t verify your subscription right now. Please try again.
                      </Text>
                    </View>
                  )}

                  {error === "SUBSCRIPTION_REQUIRED" && (
                    <View
                      style={{
                        marginTop: 8,
                        padding: 12,
                        borderRadius: 8,
                        backgroundColor: "#eef3ff",
                        maxWidth: 520,
                        gap: 8,
                      }}
                    >
                      <Text style={{ color: "#243a8f", fontWeight: "600" }}>
                        Subscription required
                      </Text>
                      <Text style={{ color: "#243a8f" }}>
                        Scanning labels requires an active subscription.
                      </Text>

                      <HoverPressable
                        onPress={async () => {
                          const r = await fetch("/api/checkout", { method: "POST" });
                          const { checkoutUrl } = await r.json();
                          window.location.href = checkoutUrl;
                        }}
                        style={{
                          marginTop: 6,
                          padding: 10,
                          borderWidth: 1,
                          borderRadius: 8,
                          alignItems: "center",
                        }}
                      >
                        <Text>Subscribe to continue</Text>
                      </HoverPressable>
                    </View>
                  )}

        </div>
      )}

      <Link href="/input" asChild>
        <HoverPressable
          onPress={() => clearCurrentLabel()}
          style={buttonStyle}
        >
          <Text>Enter Nutrition Manually</Text>
        </HoverPressable>
      </Link>

      {hasLabel ? (
        <Link href="/review" asChild>
          <HoverPressable style={buttonStyle}>
            <Text>Review Last Input</Text>
          </HoverPressable>
        </Link>
      ) : (
        <HoverPressable disabled style={{ ...buttonStyle, opacity: 0.4 }}>
          <Text>Review Last Input</Text>
        </HoverPressable>
      )}

      {hasLabel ? (
        <Link href="/export" asChild>
          <HoverPressable style={buttonStyle}>
            <Text>Export Last Input</Text>
          </HoverPressable>
        </Link>
      ) : (
        <HoverPressable disabled style={{ ...buttonStyle, opacity: 0.4 }}>
          <Text>Export Last Input</Text>
        </HoverPressable>
      )}
    </View>
  );
}
