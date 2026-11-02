import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "@/theme";
import type { WrappedCardKind } from "./cards";

const VIEW_BOX = "0 0 100 100";
const STROKE = 3.5;

const FIT: Record<WrappedCardKind, string> = {
  week: "xMidYMid meet",
  avgKcal: "xMaxYMin meet",
  topDish: "xMidYMid meet",
  insights: "xMinYMax meet",
};

function Art({ kind, filled }: { kind: WrappedCardKind; filled: number }) {
  const sage = colors.sage;
  switch (kind) {
    case "avgKcal":
      // Un sol que asoma por la esquina.
      return (
        <>
          <Circle cx={76} cy={24} r={30} fill={sage} />
          <Circle cx={76} cy={24} r={43} fill="none" stroke={sage} strokeWidth={STROKE} />
          <Circle cx={76} cy={24} r={56} fill="none" stroke={sage} strokeWidth={STROKE / 2} />
        </>
      );
    case "week":
      // Siete puntos, uno por día: llenos los registrados. El número exacto lo dice el texto.
      return (
        <>
          {Array.from({ length: 7 }, (_, index) => (
            <Circle
              key={index}
              cx={11 + index * 13}
              cy={50}
              r={5.5}
              fill={index < filled ? sage : "none"}
              stroke={sage}
              strokeWidth={STROKE / 2}
            />
          ))}
        </>
      );
    case "topDish":
      // Un plato visto desde arriba.
      return (
        <>
          <Circle cx={50} cy={52} r={36} fill="none" stroke={sage} strokeWidth={STROKE} />
          <Circle cx={50} cy={52} r={23} fill={sage} />
        </>
      );
    case "insights":
      // Dos medialunas que se abren, como una idea que aparece.
      return (
        <>
          <Path d="M 0 100 A 38 38 0 0 1 76 100 Z" fill={sage} />
          <Path
            d="M 30 100 A 46 46 0 0 1 122 100"
            fill="none"
            stroke={sage}
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
        </>
      );
  }
}

export function CardArt({ kind, filled = 0 }: { kind: WrappedCardKind; filled?: number }) {
  return (
    <View
      style={styles.root}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Svg width="100%" height="100%" viewBox={VIEW_BOX} preserveAspectRatio={FIT[kind]}>
        <Art kind={kind} filled={filled} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
