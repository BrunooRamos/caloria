// Corre el set de comidas problemáticas con los tres tonos contra OpenAI de verdad e imprime
// los comentarios para revisarlos a mano (RNF-10). No va al CI: gasta llamadas a la API.
//   OPENAI_API_KEY=sk-… npm run comments:check
import { COMMENT_PROMPT_PATH, loadPrompt } from "../src/config/prompts";
import { DEFAULT_OPENAI_TEXT_MODEL } from "../src/config/worker";
import { createOpenAiCommenter, InvalidCommentResponseError } from "../src/services/comment";
import type { CommentTone } from "../src/services/comment";
import { isBlockedComment } from "../src/services/comment-safety";
import { PROBLEMATIC_MEALS } from "../test/fixtures/comidas-problematicas";

const TONES: CommentTone[] = ["motivador", "neutro", "roast"];

async function main() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.log("Sin OPENAI_API_KEY: no se corre el set contra OpenAI.");
    return;
  }
  const prompt = loadPrompt(COMMENT_PROMPT_PATH);
  const model = process.env.OPENAI_TEXT_MODEL?.trim() || DEFAULT_OPENAI_TEXT_MODEL;
  const commenter = createOpenAiCommenter({ apiKey, model, prompt });
  console.log(`Modelo ${model} · roast.md ${prompt.version}\n`);

  let flagged = 0;
  for (const { case: name, analysis } of PROBLEMATIC_MEALS) {
    console.log(`## ${analysis.dish} (${name}, ${analysis.kcal.min}-${analysis.kcal.max} kcal)`);
    for (const tone of TONES) {
      const started = performance.now();
      let line: string;
      try {
        const { text } = await commenter.comment({ tone, analysis });
        const blocked = isBlockedComment(text);
        if (blocked) flagged++;
        line = `${blocked ? "BLOQUEADO" : "ok"} · ${text.length} car. · ${text}`;
      } catch (err) {
        flagged++;
        line =
          err instanceof InvalidCommentResponseError
            ? `INVÁLIDO · ${err.issues.map((issue) => issue.message).join("; ")}`
            : `FALLÓ · ${err instanceof Error ? err.message : String(err)}`;
      }
      const ms = Math.round(performance.now() - started);
      console.log(`- ${tone.padEnd(9)} ${String(ms).padStart(5)} ms · ${line}`);
    }
    console.log();
  }
  console.log(
    flagged
      ? `${flagged} comentario(s) bloqueados, inválidos o fallidos: revisar el prompt.`
      : "Ninguno cayó en el filtro. Igual revisalos a mano: el filtro es solo una red.",
  );
  if (flagged) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
