import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMENT_MAX_CHARS,
  COMMENT_TIMEOUT_MS,
  createOpenAiCommenter,
  InvalidCommentResponseError,
  parseCommentResponse,
} from "../src/services/comment";
import type { CommentInput } from "../src/services/comment";
import { BLOCKED_TERMS, isBlockedComment } from "../src/services/comment-safety";
import { VISION_TIMEOUT_MS } from "../src/services/vision";
import {
  BLOCKED_COMMENTS,
  PROBLEMATIC_MEALS,
  SAFE_COMMENTS,
} from "./fixtures/comidas-problematicas";

const prompt = { version: "1.0.0", system: "PROMPT DEL COMENTARIO" };
const TEXT = "Parrillada completa: el chorizo y la morcilla vinieron a jugar de titulares.";
const [{ analysis }] = PROBLEMATIC_MEALS;

const openAiResponse = (content: unknown[], extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      id: "resp_1",
      object: "response",
      created_at: 0,
      status: "completed",
      model: "gpt-6-luna-2026-09-01",
      output: [{ type: "message", id: "msg_1", status: "completed", role: "assistant", content }],
      usage: {
        input_tokens: 400,
        output_tokens: 30,
        total_tokens: 430,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
      ...extra,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const textPart = (text: string) => ({
  type: "output_text",
  text: JSON.stringify({ text }),
  annotations: [],
});

function setupCommenter(respond: () => Response = () => openAiResponse([textPart(TEXT)])) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const commenter = createOpenAiCommenter({
    apiKey: "sk-test",
    model: "gpt-6-luna",
    prompt,
    fetch: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return respond();
    },
  });
  return { commenter, requests };
}

describe("back-service: service del comentario de OpenAI (sin red)", () => {
  it("pide structured outputs con el tono y solo dish, items, kcal y macros", async () => {
    const { commenter, requests } = setupCommenter();
    assert.equal(commenter.model, "gpt-6-luna");
    assert.equal(commenter.promptVersion, "1.0.0");

    // Aunque el llamador mande de más, al modelo le llega solo lo que hace falta.
    const input = {
      tone: "roast",
      analysis: {
        ...analysis,
        confidence: 0.7,
        note: "nota privada",
        transcript: "audio privado",
        image: "data:image/jpeg;base64,AAAA",
        profile: { weightKg: 60 },
      },
    } as unknown as CommentInput;
    const result = await commenter.comment(input);
    assert.deepEqual(result, { text: TEXT, usage: { input: 400, output: 30, total: 430 } });

    assert.equal(requests.length, 1);
    const [{ url, body }] = requests;
    assert.match(url, /\/responses$/);
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.instructions, "PROMPT DEL COMENTARIO");
    assert.equal(body.store, false);
    assert.deepEqual(body.reasoning, { effort: "low" });
    assert.equal(typeof body.max_output_tokens, "number");
    const format = (body.text as { format: Record<string, unknown> }).format;
    assert.equal(format.type, "json_schema");
    assert.equal(format.strict, true);

    const [message] = body.input as { role: string; content: { type: string; text: string }[] }[];
    assert.equal(message.role, "user");
    assert.deepEqual(
      message.content.map((part) => part.type),
      ["input_text"],
    );
    const { dish, items, kcal, macros } = analysis;
    assert.deepEqual(JSON.parse(message.content[0].text), {
      tone: "roast",
      analysis: { dish, items, kcal, macros },
    });
    const sent = JSON.stringify(body);
    for (const leak of ["nota privada", "audio privado", "input_image", "base64", "weightKg"]) {
      assert.ok(!sent.includes(leak), leak);
    }
    assert.ok(!sent.includes("confidence"));
  });

  for (const [name, text] of [
    ["más de 200 caracteres", "a".repeat(COMMENT_MAX_CHARS + 1)],
    ["vacío", ""],
    ["solo espacios", "   "],
  ]) {
    it(`un texto ${name} es una respuesta inválida (no se corta a mano)`, async () => {
      const { commenter } = setupCommenter(() => openAiResponse([textPart(text)]));
      await assert.rejects(
        commenter.comment({ tone: "neutro", analysis }),
        (err: unknown) => err instanceof InvalidCommentResponseError && err.usage?.total === 430,
      );
    });
  }

  it("200 caracteres justos pasan, y los espacios de los bordes se sacan", () => {
    const text = "a".repeat(COMMENT_MAX_CHARS);
    assert.equal(parseCommentResponse(JSON.stringify({ text })).text, text);
    assert.equal(parseCommentResponse(JSON.stringify({ text: ` ${text} ` })).text, text);
    assert.throws(() => parseCommentResponse("no es json"), InvalidCommentResponseError);
    assert.throws(
      () => parseCommentResponse(JSON.stringify({ comment: "otra clave" })),
      InvalidCommentResponseError,
    );
  });

  it("una negativa o una respuesta incompleta son inválidas", async () => {
    for (const [respond, code] of [
      [() => openAiResponse([{ type: "refusal", refusal: "No puedo." }]), "refusal"],
      [
        () =>
          openAiResponse([textPart(TEXT)], {
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
          }),
        "incomplete",
      ],
    ] as const) {
      const { commenter } = setupCommenter(respond);
      await assert.rejects(
        commenter.comment({ tone: "motivador", analysis }),
        (err: unknown) => err instanceof InvalidCommentResponseError && err.issues[0].code === code,
      );
    }
  });

  it("timeout corto (menor al de la visión), corta y no reintenta por su cuenta", async () => {
    assert.ok(COMMENT_TIMEOUT_MS < VISION_TIMEOUT_MS);
    assert.ok(COMMENT_TIMEOUT_MS <= 10_000);
    let calls = 0;
    const commenter = createOpenAiCommenter({
      apiKey: "sk-test",
      model: "gpt-6-luna",
      prompt,
      timeoutMs: 50,
      fetch: (_url, init) => {
        calls++;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      },
    });
    await assert.rejects(commenter.comment({ tone: "roast", analysis }), /timed out/i);
    assert.equal(calls, 1);
  });

  it("un error de la API se propaga sin reintento", async () => {
    let calls = 0;
    const { commenter } = setupCommenter(() => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "boom" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    });
    await assert.rejects(commenter.comment({ tone: "roast", analysis }));
    assert.equal(calls, 1);
  });
});

describe("back-service: filtro de seguridad del comentario", () => {
  it("descarta los comentarios sobre el cuerpo, el peso, la apariencia o la restricción", () => {
    for (const text of BLOCKED_COMMENTS) assert.equal(isBlockedComment(text), true, text);
  });

  it("deja pasar los comentarios sobre el plato", () => {
    for (const text of SAFE_COMMENTS) assert.equal(isBlockedComment(text), false, text);
  });

  it("no depende de mayúsculas, tildes ni espacios de más", () => {
    assert.equal(isBlockedComment("ADELGAZÁS"), true);
    assert.equal(isBlockedComment("te   pasaste"), true);
    assert.equal(isBlockedComment("Ojo con la Balanza"), true);
  });

  it("la lista es corta, sin tildes y en minúsculas", () => {
    assert.ok(BLOCKED_TERMS.length <= 30);
    for (const term of BLOCKED_TERMS) {
      assert.equal(term, term.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(), term);
      // Cada término se bloquea a sí mismo.
      assert.equal(isBlockedComment(term.replace("*", "")), true, term);
    }
  });

  it("el set de comidas problemáticas cubre los casos pedidos", () => {
    const cases = PROBLEMATIC_MEALS.map((meal) => meal.case);
    for (const expected of [
      "más de 2500 kcal",
      "menos de 80 kcal",
      "café solo",
      "porción doble de postre",
      "comida rápida",
      "mucha grasa",
    ]) {
      assert.ok(cases.includes(expected), expected);
    }
    const kcalOf = (name: string) => PROBLEMATIC_MEALS.find((meal) => meal.case === name)!;
    assert.ok(kcalOf("más de 2500 kcal").analysis.kcal.min > 2500);
    assert.ok(kcalOf("menos de 80 kcal").analysis.kcal.max < 80);
  });
});
