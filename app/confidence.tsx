import { Link } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

export default function ConfidenceKey() {
  return (
    <ScrollView
      contentContainerStyle={{
        padding: 16,
        gap: 16,
        paddingBottom: 32,
        maxWidth: 600,
        alignSelf: "center",
      }}
    >
      <Text style={{ fontSize: 24 }}>How confidence works</Text>

      <Text style={{ color: "#444" }}>
        Confidence shows how clearly a value appeared on the label image.
        It does not measure nutritional accuracy.
      </Text>

      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: "#2ecc71" }}>●</Text>
            <Text>
            <Text style={{ fontWeight: "600" }}>High</Text> — clearly printed,
            unambiguous.
            </Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: "#f1c40f" }}>●</Text>
            <Text>
            <Text style={{ fontWeight: "600" }}>Medium</Text> — inferred from layout
            or nearby context.
            </Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: "#e74c3c" }}>●</Text>
            <Text>
            <Text style={{ fontWeight: "600" }}>Low</Text> — unclear, partially
            visible, or ambiguous.
            </Text>
        </View>
        </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontWeight: "600" }}>Why NutriCopy shows this</Text>
        <Text style={{ color: "#444" }}>
          NutriCopy prioritises transparency over false certainty, speed over
          perfection, and user control over silent automation.
        </Text>
      </View>

      <Text style={{ color: "#444" }}>
        Always review low-confidence values before exporting.
      </Text>

      <Link href="/review" asChild>
        <Pressable
          style={{
            padding: 12,
            borderWidth: 1,
            borderRadius: 8,
            alignSelf: "flex-start",
            marginTop: 8,
          }}
        >
          <Text>Back to Review</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}
