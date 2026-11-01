import type { ColorToken } from "@/theme";
import { Badge } from "./Badge";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
}

const LEVELS: Record<ConfidenceLevel, { label: string; background: ColorToken; text: ColorToken }> =
  {
    high: { label: "Confianza alta", background: "sageSoft", text: "primary" },
    medium: { label: "Confianza media", background: "surfaceAlt", text: "sageText" },
    low: { label: "Confianza baja", background: "warningSoft", text: "warning" },
  };

export function ConfidenceBadge({ level }: ConfidenceBadgeProps) {
  return <Badge {...LEVELS[level]} />;
}
