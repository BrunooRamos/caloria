import { readFileSync } from "node:fs";
import path from "node:path";

// Misma profundidad desde src/config y dist/config: apunta a prompts/ en la raíz del repo.
export const PROMPTS_DIR = path.resolve(__dirname, "../../../prompts");

export interface Prompt {
  /** `version` del frontmatter; se guarda como `promptVersion` en lo que genera. */
  version: string;
  author?: string;
  date?: string;
  /** Prompt de sistema: el cuerpo del archivo. */
  system: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/**
 * Lee un prompt de `prompts/` una vez al arrancar. `label` nombra el prompt en los errores
 * ("de análisis", "del Wrapped"). Lanza si falta el archivo, la versión o el cuerpo.
 */
export function loadPrompt(file: string, label: string): Prompt {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`No se pudo leer el prompt ${label} (${file})`, { cause: err });
  }
  const match = FRONTMATTER.exec(raw);
  if (!match) throw new Error(`El prompt ${label} no tiene frontmatter (${file})`);

  // Frontmatter plano: una clave `clave: valor` por línea.
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const [, key, value] = /^(\w+):\s*(.*)$/.exec(line.trim()) ?? [];
    if (key) meta[key] = value.replace(/^(["'])(.*)\1$/, "$2").trim();
  }
  const system = match[2].trim();
  if (!meta.version) throw new Error(`El prompt ${label} no tiene versión (${file})`);
  if (!system) throw new Error(`El prompt ${label} está vacío (${file})`);
  return { version: meta.version, author: meta.autor, date: meta.fecha, system };
}
