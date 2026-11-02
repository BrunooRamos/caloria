import path from "node:path";
import { PROMPTS_DIR } from "./prompt";

export { loadPrompt } from "./prompt";
export type { Prompt } from "./prompt";

export const ANALYSIS_PROMPT_PATH = path.join(PROMPTS_DIR, "analisis-comida.md");
// La llamada corta que identifica el plato para buscar comidas corregidas parecidas.
export const IDENTIFY_PROMPT_PATH = path.join(PROMPTS_DIR, "identificar-plato.md");
// Los insights del Wrapped semanal.
export const WRAPPED_PROMPT_PATH = path.join(PROMPTS_DIR, "wrapped.md");
