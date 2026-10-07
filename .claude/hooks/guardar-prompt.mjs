// Hook UserPromptSubmit: guarda cada prompt, tal cual, en prompts/historial/<persona>.md.
// La persona sale de `git config user.name`. Nunca bloquea el prompt: ante cualquier error, sale en 0.
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const prompt = input.prompt ?? "";
  if (!prompt.trim()) process.exit(0);

  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  let autor = "";
  try {
    autor = execSync("git config user.name", { cwd: root, encoding: "utf8" }).trim();
  } catch {}
  autor ||= process.env.USER || "desconocido";

  const slug = autor
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "desconocido";

  const dir = join(root, "prompts", "historial");
  const file = join(dir, `${slug}.md`);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, `# Prompts de ${autor}\n`);

  const pad = (n) => String(n).padStart(2, "0");
  const d = new Date();
  const fecha = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hora = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sesion = input.session_id ?? "sin-sesion";

  // Encabezado de sesión solo cuando cambia respecto de la última entrada del archivo.
  const actual = readFileSync(file, "utf8");
  const ultima = [...actual.matchAll(/^## Sesión `([^`]+)`/gm)].pop()?.[1];
  let out = "";
  if (ultima !== sesion) out += `\n## Sesión \`${sesion}\` · ${fecha}\n`;

  // Bloque de código con un fence más largo que cualquier secuencia de backticks del prompt,
  // para que el texto quede exactamente como se escribió.
  const largo = Math.max(3, ...[...prompt.matchAll(/`+/g)].map((m) => m[0].length + 1));
  const fence = "`".repeat(largo);
  out += `\n### ${fecha} ${hora}\n\n${fence}text\n${prompt}\n${fence}\n`;

  appendFileSync(file, out);
} catch {
  // No interrumpir el trabajo si algo falla al guardar.
}
process.exit(0);
