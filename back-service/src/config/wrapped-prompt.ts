import path from "node:path";
import { loadPrompt, PROMPTS_DIR } from "./prompt";
import type { Prompt } from "./prompt";

export const WRAPPED_PROMPT_PATH = path.join(PROMPTS_DIR, "wrapped.md");

/** Lee el prompt del Wrapped una vez al arrancar. Lanza si falta el archivo, la versión o el cuerpo. */
export function loadWrappedPrompt(file = WRAPPED_PROMPT_PATH): Prompt {
  return loadPrompt(file, "del Wrapped");
}
