// app/export.tsx
import { Link, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { copyToClipboard } from "../lib/clipboard";
import { getCurrentLabel } from "../lib/labelStore";
import { mockLabel } from "../lib/mockLabel";
import type { Basis } from "../lib/nutritionFormat";
import { buildCSV, buildMarkdown, buildPlainText } from "../lib/nutritionFormat";

type ExportFormat = "plain" | "markdown" | "csv";

export default function Export() {
  const params = useLocalSearchParams<{ basis?: string }>();

  const initialBasis: Basis =
    params.basis === "per_100g" ? "per_100g" : "per_serve";

  const [basis, setBasis] = useState<Basis>(initialBasis);
  const [format, setFormat] = useState<ExportFormat>("plain");

  const text = useMemo(() => {
    const label = getCurrentLabel() ?? mockLabel;

    if (format === "markdown") return buildMarkdown(label, basis);
    if (format === "csv") return buildCSV(label, basis);
    return buildPlainText(label, basis);
  }, [basis, format]);

  const copyLabel =
    format === "markdown" ? "List" : format === "csv" ? "CSV" : "Plain Text";

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 24 }}>Export</Text>

      {/* Basis toggle */}
      <Pressable
        onPress={() =>
          setBasis(basis === "per_serve" ? "per_100g" : "per_serve")
        }
        style={{ padding: 10, borderWidth: 1, borderRadius: 8 }}
      >
        <Text>Basis: {basis === "per_serve" ? "Per Serve" : "Per 100 g"}</Text>
      </Pressable>

      {/* Format toggle */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={() => setFormat("plain")}
          style={{
            padding: 10,
            borderWidth: 1,
            borderRadius: 8,
            backgroundColor: format === "plain" ? "#eee" : "transparent",
          }}
        >
          <Text>Plain Text</Text>
        </Pressable>

        <Pressable
          onPress={() => setFormat("markdown")}
          style={{
            padding: 10,
            borderWidth: 1,
            borderRadius: 8,
            backgroundColor: format === "markdown" ? "#eee" : "transparent",
          }}
        >
          <Text>List</Text>
        </Pressable>

        <Pressable
          onPress={() => setFormat("csv")}
          style={{
            padding: 10,
            borderWidth: 1,
            borderRadius: 8,
            backgroundColor: format === "csv" ? "#eee" : "transparent",
          }}
        >
          <Text>CSV</Text>
        </Pressable>
      </View>

      {/* Export preview */}
      <Text selectable style={{ fontFamily: "monospace" }}>
        {text}
      </Text>

      {/* Copy */}
      <Pressable
        onPress={async () => {
          await copyToClipboard(text);
        }}
        style={{ padding: 12, borderWidth: 1, borderRadius: 8 }}
      >
        <Text>Copy ({copyLabel})</Text>
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
