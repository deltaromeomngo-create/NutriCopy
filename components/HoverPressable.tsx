// components/HoverPressable.tsx
import { useState } from "react";
import { Pressable, PressableProps } from "react-native";

type Props = PressableProps & {
  hoverBg?: string;
  baseBg?: string;
};

export default function HoverPressable({
  hoverBg = "#e9e9e9",
  baseBg = "transparent",
  style,
  ...props
}: Props) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      {...props}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        typeof style === "function" ? style({ pressed: false }) : style,
        {
          backgroundColor: hovered ? hoverBg : baseBg,
        },
      ]}
    />
  );
}
