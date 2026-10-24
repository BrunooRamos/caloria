import { createContext, useContext } from "react";

export type SurfaceTone = "default" | "brand";

export const ToneContext = createContext<SurfaceTone>("default");

export function useTone(): SurfaceTone {
  return useContext(ToneContext);
}
