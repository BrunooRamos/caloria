import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUDIO_MAX_BYTES,
  correctableFieldsSchema,
  correctMealSchema,
  DISH_MAX_CHARS,
  detectAudioType,
  detectPhotoType,
  ITEM_NAME_MAX_CHARS,
  ITEMS_MAX,
  listMealsQuerySchema,
  mealIdParamsSchema,
  NOTE_MAX_CHARS,
  PHOTO_MAX_BYTES,
  rangeSchema,
  validateMealUpload,
} from "../src";

function ftyp(major: string, ...compatible: string[]): Buffer {
  const body = Buffer.from(major + "\0\0\0\0" + compatible.join(""), "latin1");
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length);
  header.write("ftyp", 4, "latin1");
  return Buffer.concat([header, body, Buffer.alloc(64)]);
}

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64)]);
const m4a = ftyp("M4A ", "M4A ", "mp42", "isom");
const file = (buffer: Buffer, size = buffer.length) => ({ buffer, size });

describe("meals: detección del tipo por contenido", () => {
  it("reconoce JPEG, PNG y HEIC por sus primeros bytes", () => {
    assert.equal(detectPhotoType(jpeg), "image/jpeg");
    assert.equal(detectPhotoType(png), "image/png");
    assert.equal(detectPhotoType(ftyp("heic", "mif1", "heic")), "image/heic");
    // Lo que escribe un iPhone puede declarar mif1 como marca principal.
    assert.equal(detectPhotoType(ftyp("mif1", "heic")), "image/heic");
  });

  it("no acepta otros formatos aunque sean parecidos", () => {
    assert.equal(detectPhotoType(Buffer.from("texto plano con extensión .jpg")), undefined);
    assert.equal(detectPhotoType(Buffer.from("GIF89a" + "\0".repeat(32))), undefined);
    assert.equal(detectPhotoType(ftyp("avif", "mif1", "avif")), undefined);
    assert.equal(detectPhotoType(ftyp("mif1", "avif")), undefined);
    assert.equal(detectPhotoType(m4a), undefined);
    assert.equal(detectPhotoType(Buffer.alloc(0)), undefined);
  });

  it("reconoce M4A y rechaza lo demás como audio", () => {
    assert.equal(detectAudioType(m4a), "audio/mp4");
    assert.equal(detectAudioType(ftyp("isom", "isom", "3gp4")), "audio/mp4");
    assert.equal(detectAudioType(ftyp("heic", "mif1")), undefined);
    assert.equal(detectAudioType(jpeg), undefined);
    assert.equal(detectAudioType(Buffer.from("ID3")), undefined);
  });

  it("una caja ftyp con tamaño inválido no se acepta", () => {
    const broken = ftyp("heic", "mif1");
    broken.writeUInt32BE(0xffff, 0);
    assert.equal(detectPhotoType(broken), undefined);
  });
});

describe("meals: validateMealUpload", () => {
  it("devuelve la foto con el tipo detectado, el audio y la nota sin espacios", () => {
    const upload = validateMealUpload({
      photo: file(png),
      audio: file(m4a),
      fields: { note: "  milanesa " },
    });
    assert.equal(upload.photo.contentType, "image/png");
    assert.equal(upload.audio?.contentType, "audio/mp4");
    assert.equal(upload.note, "milanesa");
  });

  it("una nota vacía no se guarda", () => {
    assert.equal(
      validateMealUpload({ photo: file(jpeg), fields: { note: "   " } }).note,
      undefined,
    );
  });

  const cases: [string, Parameters<typeof validateMealUpload>[0], string | RegExp][] = [
    ["sin foto", { fields: {} }, "VALIDATION_ERROR"],
    ["foto que no es imagen", { photo: file(Buffer.from("hola")), fields: {} }, "VALIDATION_ERROR"],
    [
      "foto de más de 8 MB",
      { photo: file(jpeg, PHOTO_MAX_BYTES + 1), fields: {} },
      "PAYLOAD_TOO_LARGE",
    ],
    [
      "audio de más de 4 MB",
      { photo: file(jpeg), audio: file(m4a, AUDIO_MAX_BYTES + 1), fields: {} },
      "PAYLOAD_TOO_LARGE",
    ],
    [
      "audio que no es M4A",
      { photo: file(jpeg), audio: file(jpeg), fields: {} },
      "VALIDATION_ERROR",
    ],
    [
      "nota demasiado larga",
      { photo: file(jpeg), fields: { note: "a".repeat(NOTE_MAX_CHARS + 1) } },
      /ZodError/,
    ],
    ["campo desconocido", { photo: file(jpeg), fields: { plan: "premium" } }, /ZodError/],
  ];
  for (const [name, input, expected] of cases) {
    it(`rechaza ${name}`, () => {
      if (typeof expected === "string") {
        assert.throws(() => validateMealUpload(input), { code: expected });
      } else {
        assert.throws(
          () => validateMealUpload(input),
          (err: Error) => expected.test(err.name),
        );
      }
    });
  }
});

describe("meals: id de la ruta", () => {
  it("acepta un ObjectId en hex", () => {
    assert.deepEqual(mealIdParamsSchema.parse({ id: "66f1a0000000000000000099" }), {
      id: "66f1a0000000000000000099",
    });
  });

  for (const id of [
    "123",
    "66f1a000000000000000009z",
    "aaaaaaaaaaaa",
    "66f1a0000000000000000099 ",
  ]) {
    it(`rechaza ${JSON.stringify(id)}`, () => {
      assert.equal(mealIdParamsSchema.safeParse({ id }).success, false);
    });
  }

  it("rechaza params de más", () => {
    const params = { id: "66f1a0000000000000000099", extra: "1" };
    assert.equal(mealIdParamsSchema.safeParse(params).success, false);
  });
});

describe("meals: query de GET /meals", () => {
  it("acepta date sola y date con cursor", () => {
    assert.deepEqual(listMealsQuerySchema.parse({ date: "2026-10-06" }), { date: "2026-10-06" });
    assert.deepEqual(listMealsQuerySchema.parse({ date: "2026-10-06", cursor: "MTc5_MC-2" }), {
      date: "2026-10-06",
      cursor: "MTc5_MC-2",
    });
  });

  for (const [caso, query] of [
    ["sin date", {}],
    ["date con otro formato", { date: "06-10-2026" }],
    ["un día que no existe", { date: "2026-02-30" }],
    ["date repetida", { date: ["2026-10-06", "2026-10-07"] }],
    ["cursor vacío", { date: "2026-10-06", cursor: "" }],
    ["cursor fuera de base64url", { date: "2026-10-06", cursor: "a+b/=" }],
    ["cursor demasiado largo", { date: "2026-10-06", cursor: "a".repeat(129) }],
    ["un campo de más", { date: "2026-10-06", userId: "66f1a0000000000000000002" }],
  ] as const) {
    it(`rechaza ${caso}`, () => {
      assert.equal(listMealsQuerySchema.safeParse(query).success, false);
    });
  }
});

describe("meals: rangos", () => {
  it("acepta min ≤ max", () => {
    assert.deepEqual(rangeSchema.parse({ min: 10, max: 10 }), { min: 10, max: 10 });
  });

  for (const [name, range] of [
    ["min > max", { min: 20, max: 10 }],
    ["negativos", { min: -1, max: 10 }],
    ["sin max", { min: 1 }],
  ] as const) {
    it(`rechaza ${name}`, () => {
      assert.equal(rangeSchema.safeParse(range).success, false);
    });
  }
});

describe("meals: body de PATCH /meals/:id", () => {
  const r = (min: number, max: number) => ({ min, max });
  const item = { name: "Milanesa", grams: r(150, 190), kcal: r(380, 470) };
  const macros = { protein: r(38, 46), carbs: r(50, 65), fat: r(28, 38) };
  const accepted = (body: unknown) =>
    assert.equal(correctMealSchema.safeParse(body).success, true, JSON.stringify(body));

  it("acepta cada campo solo o todos juntos, completos", () => {
    accepted({ dish: "Milanesa napolitana" });
    accepted({ items: [item] });
    accepted({ items: [] });
    accepted({ kcal: r(800, 900) });
    accepted({ macros });
    accepted({ dish: "Milanesa", items: [item], kcal: r(0, 0), macros });
  });

  it("recorta los espacios del plato y de los ingredientes", () => {
    const body = correctMealSchema.parse({
      dish: "  Milanesa  ",
      items: [{ ...item, name: " Puré " }],
    });
    assert.equal(body.dish, "Milanesa");
    assert.equal(body.items?.[0].name, "Puré");
  });

  it("acepta los topes justos", () => {
    accepted({
      dish: "a".repeat(DISH_MAX_CHARS),
      items: Array.from({ length: ITEMS_MAX }, () => ({
        ...item,
        name: "b".repeat(ITEM_NAME_MAX_CHARS),
      })),
    });
  });

  for (const [name, body] of [
    ["un body vacío", {}],
    ["un campo desconocido", { dish: "Milanesa", confidence: 1 }],
    ["un campo interno", { analysis: { dish: "x" } }],
    ["un campo desconocido en un ingrediente", { items: [{ ...item, extra: 1 }] }],
    ["un campo desconocido en macros", { macros: { ...macros, fiber: r(1, 2) } }],
    ["un plato vacío", { dish: "   " }],
    ["un plato que no es texto", { dish: 3 }],
    ["un plato demasiado largo", { dish: "a".repeat(DISH_MAX_CHARS + 1) }],
    ["un ingrediente sin nombre", { items: [{ ...item, name: "" }] }],
    [
      "un nombre demasiado largo",
      { items: [{ ...item, name: "b".repeat(ITEM_NAME_MAX_CHARS + 1) }] },
    ],
    ["demasiados ingredientes", { items: Array.from({ length: ITEMS_MAX + 1 }, () => item) }],
    ["un ingrediente sin gramos", { items: [{ name: "Puré", kcal: r(1, 2) }] }],
    ["items que no son una lista", { items: item }],
    ["kcal con min > max", { kcal: r(900, 800) }],
    ["kcal negativas", { kcal: r(-1, 800) }],
    ["kcal como número", { kcal: 850 }],
    ["un rango con min > max en un ingrediente", { items: [{ ...item, grams: r(200, 100) }] }],
    ["macros incompletos", { macros: { protein: r(1, 2), carbs: r(1, 2) } }],
    ["un macro negativo", { macros: { ...macros, fat: r(-5, 2) } }],
    ["null en un campo", { kcal: null }],
  ] as const) {
    it(`rechaza ${name}`, () => {
      assert.equal(correctMealSchema.safeParse(body).success, false);
    });
  }

  it("los topes son solo del PATCH: una corrección guardada más larga sigue siendo válida", () => {
    // applyCorrections valida con correctableFieldsSchema; un tope ahí ignoraría correcciones viejas.
    const long = { dish: "a".repeat(DISH_MAX_CHARS + 1) };
    assert.equal(correctableFieldsSchema.partial().strict().safeParse(long).success, true);
  });
});
