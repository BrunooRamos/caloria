import { readFileSync } from "node:fs";
import path from "node:path";

// Misma profundidad desde src/config y dist/config: apunta a prompts/ en la raíz del repo.
export const ANALYSIS_PROMPT_PATH = path.resolve(__dirname, "../../../prompts/analisis-comida.md");

export interface AnalysisPrompt {
  /** `version` del frontmatter; se guarda en la meal como `promptVersion`. */
  version: string;
  author?: string;
  date?: string;
  /** Prompt de sistema: el cuerpo del archivo. */
  system: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/** Lee el prompt de análisis una vez al arrancar. Lanza si falta el archivo, la versión o el cuerpo. */
export function loadAnalysisPrompt(file = ANALYSIS_PROMPT_PATH): AnalysisPrompt {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`No se pudo leer el prompt de análisis (${file})`, { cause: err });
  }
  const match = FRONTMATTER.exec(raw);
  if (!match) throw new Error(`El prompt de análisis no tiene frontmatter (${file})`);

  // Frontmatter plano: una clave `clave: valor` por línea.
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const [, key, value] = /^(\w+):\s*(.*)$/.exec(line.trim()) ?? [];
    if (key) meta[key] = value.replace(/^(["'])(.*)\1$/, "$2").trim();
  }
  const system = match[2].trim();
  if (!meta.version) throw new Error(`El prompt de análisis no tiene versión (${file})`);
  if (!system) throw new Error(`El prompt de análisis está vacío (${file})`);
  return { version: meta.version, author: meta.autor, date: meta.fecha, system };
}
