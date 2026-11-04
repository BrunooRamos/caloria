import { formatNumber } from "@/features/dashboard/format";
import type { WeeklySummary } from "@/services/summaries";

export type WrappedCardKind = "week" | "avgKcal" | "topDish" | "insights";

export interface WrappedCard {
  key: WrappedCardKind;
  kind: WrappedCardKind;
  eyebrow: string;
  hero?: string;
  unit?: string;
  detail?: string;
  filled?: number;
  photoUrl?: string;
  items?: string[];
  accessibilityLabel: string;
}

export function wrappedCards({ metrics, insights, topDishPhotoUrl }: WeeklySummary): WrappedCard[] {
  const { avgKcal, daysLogged, streak, topDish } = metrics;
  const kcal = Math.round(avgKcal);
  const streakLine = streak >= 2 ? `Tu mejor racha: ${streak} días seguidos` : undefined;

  const cards: WrappedCard[] = [
    {
      key: "week",
      kind: "week",
      eyebrow: "Tu semana",
      hero: formatNumber(daysLogged),
      unit: "de 7 días",
      detail: streakLine,
      filled: daysLogged,
      accessibilityLabel: [
        `Tu semana: registraste ${daysLogged} de 7 días.`,
        streakLine && `${streakLine}.`,
      ]
        .filter(Boolean)
        .join(" "),
    },
    {
      key: "avgKcal",
      kind: "avgKcal",
      eyebrow: "Promedio por día registrado",
      hero: formatNumber(kcal),
      unit: "kcal",
      accessibilityLabel: `Promedio por día registrado: ${kcal} kilocalorías.`,
    },
  ];

  const dish = topDish.trim();
  if (dish) {
    cards.push({
      key: "topDish",
      kind: "topDish",
      eyebrow: "Tu plato más repetido",
      hero: dish,
      photoUrl: topDishPhotoUrl,
      accessibilityLabel: `Tu plato más repetido: ${dish}.`,
    });
  }

  if (insights.length > 0) {
    cards.push({
      key: "insights",
      kind: "insights",
      eyebrow: "Lo que vimos en tu semana",
      items: insights,
      accessibilityLabel: `Lo que vimos en tu semana: ${insights.join(" ")}`,
    });
  }

  return cards;
}
