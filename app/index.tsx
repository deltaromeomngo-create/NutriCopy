// app/index.tsx
import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { clearCurrentLabel } from "../lib/labelStore";

export default function Index() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 16,
      }}
    >
      <Text style={{ fontSize: 24 }}>Scan</Text>

      <Text style={{ fontSize: 14, color: "#666", textAlign: "center" }}>
        Turn nutrition labels into clean, copyable data.
      </Text>


      <Text style={{ fontSize: 14, color: "#666", textAlign: "center" }}>
        MVP input is manual. Camera/OCR comes later.
      </Text>

      <Link href="/input" asChild>
        <Pressable
          onPress={() => clearCurrentLabel()}
          style={{
            padding: 12,
            borderWidth: 1,
            borderRadius: 8,
            minWidth: 220,
            alignItems: "center",
          }}
        >
          <Text>Enter Nutrition Manually</Text>
        </Pressable>
      </Link>

      <Link href="/review" asChild>
        <Pressable
          style={{
            padding: 12,
            borderWidth: 1,
            borderRadius: 8,
            minWidth: 220,
            alignItems: "center",
          }}
        >
          <Text>Review Last Input</Text>
        </Pressable>
      </Link>

      <Link href="/export" asChild>
        <Pressable
          style={{
            padding: 12,
            borderWidth: 1,
            borderRadius: 8,
            minWidth: 220,
            alignItems: "center",
          }}
        >
          <Text>Export Last Input</Text>
        </Pressable>
      </Link>
    </View>
  );
}
