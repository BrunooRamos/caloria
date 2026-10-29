import path from "node:path";
import { loadPrompt, PROMPTS_DIR } from "./prompt";
import type { Prompt } from "./prompt";

export const ANALYSIS_PROMPT_PATH = path.join(PROMPTS_DIR, "analisis-comida.md");

export type AnalysisPrompt = Prompt;

/** Lee el prompt de análisis una vez al arrancar. Lanza si falta el archivo, la versión o el cuerpo. */
export function loadAnalysisPrompt(file = ANALYSIS_PROMPT_PATH): AnalysisPrompt {
  return loadPrompt(file, "de análisis");
}
