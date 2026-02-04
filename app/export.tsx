// app/export.tsx
import { Link, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { copyToClipboard } from "../lib/clipboard";
import { getCurrentLabel, updateCurrentLabel } from "../lib/labelStore";
import type { Basis } from "../lib/nutritionFormat";

import {
  buildCSV,
  buildMarkdown,
  buildPlainText,
} from "../lib/nutritionFormat";

type ExportFormat = "plain" | "markdown" | "csv";

export default function Export() {
  const params = useLocalSearchParams<{ basis?: string }>();

  const initialBasis: Basis =
    params.basis === "per_100g" ? "per_100g" : "per_serve";

  const [basis, setBasis] = useState<Basis>(initialBasis);
  const [format, setFormat] = useState<ExportFormat>("plain");
  const [copied, setCopied] = useState(false);
  

  const label = getCurrentLabel();


  const persistedMode =
  Platform.OS === "web"
    ? (localStorage.getItem("nutricopy.exportMode") as
        | "label"
        | "consumption"
        | null)
    : null;


// --- Export math source ---
const customGrams = label?.consumption?.customGrams;
const customServes = label?.consumption?.customServes;

const [mode, setMode] = useState<"label" | "consumption">(
  persistedMode === "consumption" ? "consumption" : "label"
);
  // NOTE: consumption is only enabled when Review custom math is present

const isConsumption = mode === "consumption";

const effectiveBasis: Basis = isConsumption ? "custom" : basis;

const effectiveCustomGrams =
  isConsumption && Number.isFinite(customGrams) ? customGrams : undefined;

const effectiveCustomServes =
  isConsumption && Number.isFinite(customServes) ? customServes : undefined;

  const canConsume =
    Number.isFinite(customGrams) || Number.isFinite(customServes);

  if (mode === "consumption" && !canConsume) {
  setMode("label");
  if (Platform.OS === "web") {
    localStorage.setItem("nutricopy.exportMode", "label");
  }
}


  
  
  /* ---------- Empty state ---------- */
  if (!label) {
    return (
      <View style={{ flex: 1, padding: 16, gap: 12 }}>
        
        <Text style={{ fontSize: 24 }}>Export</Text>


        <View
          style={{
            padding: 12,
            borderRadius: 8,
            backgroundColor: "#f6f6f6",
            borderWidth: 1,
            borderColor: "#ddd",
          }}
        >
          <Text style={{ fontWeight: "600" }}>
            Nothing to export yet.
          </Text>
          <Text style={{ color: "#666", marginTop: 4 }}>
            Scan a nutrition label or enter values manually first.
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
      </View>
    );
  }

  /* ---------- Normal export ---------- */

  const text = useMemo(() => {
  if (!label) return "";

  if (format === "markdown")
    return buildMarkdown(
      label,
      effectiveBasis,
      effectiveCustomGrams,
      effectiveCustomServes,
      mode
    );

  if (format === "csv")
    return buildCSV(
      label,
      effectiveBasis,
      effectiveCustomGrams,
      effectiveCustomServes,
      mode
    );

  return buildPlainText(
    label,
    effectiveBasis,
    effectiveCustomGrams,
    effectiveCustomServes,
    mode
  );
}, [
  label,
  format,
  effectiveBasis,
  effectiveCustomGrams,
  effectiveCustomServes,
]);





  const copyLabel =
    format === "markdown" ? "List" : format === "csv" ? "CSV" : "Plain Text";

    async function handleCopy() {
      // --- time to export (first click only) ---
      if (
        label &&
        typeof label.labelReadyAtMs === "number" &&
        typeof label.timeToExportMs !== "number"
      ) {
        updateCurrentLabel({
          timeToExportMs: Date.now() - label.labelReadyAtMs,
        });
      }

      await copyToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }



  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 24 }}>Export</Text>

      {/* Export mode toggle */}
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 12, color: "#666" }}>
            Export mode
          </Text>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={() => {
                setMode("label");
                if (Platform.OS === "web") {
                  localStorage.setItem("nutricopy.exportMode", "label");
                }
              }}

              style={{
                padding: 10,
                borderWidth: 1,
                borderRadius: 8,
                backgroundColor: mode === "label" ? "#eee" : "transparent",
              }}
            >
              <Text>Label data</Text>
              <Text style={{ fontSize: 11, color: "#666" }}>
                (as printed)
              </Text>

            </Pressable>

            <Pressable
              disabled={!canConsume}
              onPress={() => {
                if (!canConsume) return;
                setMode("consumption");
                if (Platform.OS === "web") {
                  localStorage.setItem("nutricopy.exportMode", "consumption");
                }
              }}

              style={{
                padding: 10,
                borderWidth: 1,
                borderRadius: 8,
                backgroundColor: mode === "consumption" ? "#eee" : "transparent",
                opacity: canConsume ? 1 : 0.4,
              }}
            >
              <Text>Consumption</Text>
              <Text style={{ fontSize: 11, color: "#666" }}>
                (what you ate)
              </Text>

            </Pressable>
          </View>

          {!canConsume && (
            <Text style={{ fontSize: 12, color: "#999" }}>
              Enter serves eaten or grams eaten in Review to enable consumption export.
            </Text>
          )}
        </View>


      {/* Basis toggle */}
      <Pressable
        onPress={() =>
          setBasis(basis === "per_serve" ? "per_100g" : "per_serve")
        }
        style={{ padding: 10, borderWidth: 1, borderRadius: 8 }}
      >
        <Text>
          {basis === "per_serve" ? "View per 100 g" : "View per serve"}
        </Text>
        <Text style={{ fontSize: 12, color: "#666" }}>
          Tap to switch units
        </Text>
      </Pressable>

      {/* Format toggle */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["plain", "markdown", "csv"] as ExportFormat[]).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFormat(f)}
            style={{
              padding: 10,
              borderWidth: 1,
              borderRadius: 8,
              backgroundColor: format === f ? "#eee" : "transparent",
            }}
          >
            <Text>
              {f === "plain" ? "Plain Text" : f === "markdown" ? "List" : "CSV"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Preview */}
      <Text selectable style={{ fontFamily: "monospace" }}>
        {text}
      </Text>

      {/* Copy */}
      <Pressable
        onPress={handleCopy}
        style={{
          padding: 12,
          borderWidth: 1,
          borderRadius: 8,
          backgroundColor: copied ? "#e8f5e9" : "transparent",
        }}
      >
        <Text>
          {copied ? "Copied ✓" : `Copy (${copyLabel})`}
        </Text>
      </Pressable>

      <Link href="/review" asChild>
        <Pressable style={{ padding: 12, borderWidth: 1, borderRadius: 8 }}>
          <Text>Back to Review</Text>
        </Pressable>
      </Link>

      <Link href="/" asChild>
        <Pressable style={{ padding: 12, borderWidth: 1, borderRadius: 8 }}>
          <Text>Back to Scan</Text>
        </Pressable>
      </Link>
    </View>
  );
}
