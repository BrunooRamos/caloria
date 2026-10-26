import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mp4DurationSeconds } from "../src/services/audio-duration";
import { localDateIn } from "../src/services/local-date";
import { fixtures } from "./helpers";

function box(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}

function mvhdV1(timescale: number, duration: bigint): Buffer {
  const body = Buffer.alloc(112);
  body[0] = 1;
  body.writeUInt32BE(timescale, 20);
  body.writeBigUInt64BE(duration, 24);
  return box("mvhd", body);
}

describe("back-service: duración del audio (mvhd)", () => {
  it("lee la duración de un M4A con moov al final", () => {
    assert.equal(mp4DurationSeconds(fixtures.m4a(42.5)), 42.5);
  });

  it("lee mvhd versión 1", () => {
    const file = box("moov", mvhdV1(44_100, 44_100n * 61n));
    assert.equal(mp4DurationSeconds(file), 61);
  });

  it("soporta cajas con tamaño de 64 bits", () => {
    const mdat = Buffer.alloc(16 + 32);
    mdat.writeUInt32BE(1);
    mdat.write("mdat", 4, "latin1");
    mdat.writeBigUInt64BE(BigInt(mdat.length), 8);
    const file = Buffer.concat([mdat, box("moov", mvhdV1(1000, 5000n))]);
    assert.equal(mp4DurationSeconds(file), 5);
  });

  it("devuelve undefined si no se puede leer", () => {
    assert.equal(mp4DurationSeconds(fixtures.m4aWithoutMoov()), undefined);
    assert.equal(mp4DurationSeconds(Buffer.alloc(0)), undefined);
    assert.equal(mp4DurationSeconds(fixtures.jpeg()), undefined);
    // Truncado a la mitad del moov.
    const full = fixtures.m4a(10);
    assert.equal(mp4DurationSeconds(full.subarray(0, full.length - 40)), undefined);
    // Duración desconocida y timescale 0.
    assert.equal(mp4DurationSeconds(box("moov", mvhdV1(1000, 0xffffffffffffffffn))), undefined);
    assert.equal(mp4DurationSeconds(box("moov", mvhdV1(0, 1000n))), undefined);
  });
});

describe("back-service: localDate", () => {
  it("usa el día de la zona del usuario, no el de UTC", () => {
    const at = new Date("2026-10-07T02:30:00Z");
    assert.equal(localDateIn("America/Montevideo", at), "2026-10-06");
    assert.equal(localDateIn("UTC", at), "2026-10-07");
    assert.equal(localDateIn("Asia/Tokyo", new Date("2026-10-06T15:30:00Z")), "2026-10-07");
  });
});
