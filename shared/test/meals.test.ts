import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUDIO_MAX_BYTES,
  detectAudioType,
  detectPhotoType,
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
