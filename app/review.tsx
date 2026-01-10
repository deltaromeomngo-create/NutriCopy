// app/review.tsx
import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { getCurrentLabel } from "../lib/labelStore";
import { mockLabel } from "../lib/mockLabel";
import type { Basis } from "../lib/nutritionFormat";
import { getReviewRows, servingSizeText } from "../lib/nutritionFormat";

function confidenceDot(confidence?: "High" | "Med" | "Low") {
  if (!confidence) return "";
  return "●";
}

function confidenceColor(confidence?: "High" | "Med" | "Low") {
  if (confidence === "High") return "#2ecc71";
  if (confidence === "Med") return "#f1c40f";
  if (confidence === "Low") return "#e74c3c";
  return "#999";
}

export default function Review() {
  const [basis, setBasis] = useState<Basis>("per_serve");

  const label = getCurrentLabel() ?? mockLabel;
  const rows = getReviewRows(label, basis);

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 24 }}>Review</Text>

      <Pressable
        onPress={() => setBasis(basis === "per_serve" ? "per_100g" : "per_serve")}
        style={{ padding: 10, borderWidth: 1, borderRadius: 8 }}
      >
        <Text>Basis: {basis === "per_serve" ? "Per Serve" : "Per 100 g"}</Text>
      </Pressable>

      <Text>Serving size: {servingSizeText(label, basis)}</Text>

      {rows.map((r) => (
        <Text key={r.id}>
          {r.label}: {r.valueText}{" "}
          <Text style={{ color: confidenceColor(r.confidence) }}>
            {confidenceDot(r.confidence)}
          </Text>
        </Text>
      ))}

      <Text style={{ color: "#666", fontSize: 12 }}>
        ● indicates scan confidence (not nutritional quality)
      </Text>

      <Link href={{ pathname: "/export", params: { basis } }} asChild>
        <Pressable style={{ padding: 12, borderWidth: 1, borderRadius: 8 }}>
          <Text>Go to Export</Text>
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
    </View>
  );
}
