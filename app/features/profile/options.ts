import type { Profile } from "@/services/auth";

export interface Option<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export const SEX_OPTIONS: Option<Profile["sex"]>[] = [
  { value: "female", label: "Femenino" },
  { value: "male", label: "Masculino" },
];

export const ACTIVITY_OPTIONS: Option<Profile["activity"]>[] = [
  { value: "sedentary", label: "Poca", description: "Paso la mayor parte del día sentado." },
  { value: "light", label: "Ligera", description: "Camino o me muevo 1 a 3 días por semana." },
  { value: "moderate", label: "Moderada", description: "Hago ejercicio 3 a 5 días por semana." },
  { value: "active", label: "Alta", description: "Hago ejercicio 6 o 7 días por semana." },
  {
    value: "very_active",
    label: "Muy alta",
    description: "Entreno fuerte todos los días o mi trabajo es físico.",
  },
];

export const GOAL_OPTIONS: Option<Profile["goal"]>[] = [
  { value: "lose", label: "Bajar de peso" },
  { value: "maintain", label: "Mantener mi peso" },
  { value: "gain", label: "Subir de peso" },
];
