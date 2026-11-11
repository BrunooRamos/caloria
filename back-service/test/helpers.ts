import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { Types } from "mongoose";
import { createLogger } from "@caloria/shared";
import { UserModel } from "../src/models/User";
import type { User } from "../src/models/User";
import { createQuotaService } from "../src/services/quota";

export async function listen(app: Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function captureLogger(service: string) {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({ service, write: (line) => lines.push(JSON.parse(line)) });
  return { logger, lines };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Config de storage de prueba: firmar URLs no hace llamadas de red, así que no hace falta MinIO.
export const storageEnv = {
  S3_ENDPOINT: "http://minio:9000",
  S3_PUBLIC_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "caloria-media",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
};

/** Caja ISO BMFF: tamaño (4 bytes) + tipo (4) + contenido. */
function box(type: string, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}

const ftyp = (major: string, ...compatible: string[]) =>
  box(
    "ftyp",
    Buffer.from(major, "latin1"),
    Buffer.alloc(4),
    Buffer.from(compatible.join(""), "latin1"),
  );

/** Solo los bytes que se miran para detectar el tipo; el resto es relleno. */
export const fixtures = {
  jpeg: (size = 1024) =>
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 1)]),
  png: () => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(512, 2)]),
  heic: () => Buffer.concat([ftyp("heic", "mif1", "heic"), Buffer.alloc(512, 3)]),
  /** M4A con `moov/mvhd` (versión 0, timescale 1000) que declara `seconds` de duración. */
  m4a(seconds: number) {
    const mvhd = Buffer.alloc(100);
    mvhd.writeUInt32BE(1000, 12); // timescale
    mvhd.writeUInt32BE(Math.round(seconds * 1000), 16); // duration
    return Buffer.concat([
      ftyp("M4A ", "M4A ", "mp42", "isom"),
      box("mdat", Buffer.alloc(2048, 4)),
      box("moov", box("mvhd", mvhd)),
    ]);
  },
  /** M4A sin `moov`: la duración no se puede leer. */
  m4aWithoutMoov: () => Buffer.concat([ftyp("M4A ", "M4A "), box("mdat", Buffer.alloc(2048, 4))]),
  text: () => Buffer.from("esto no es una imagen, es texto con extensión .jpg\n".repeat(20)),
};

export const unlimitedQuota = createQuotaService({ freeMonthlyAnalyses: Number.MAX_SAFE_INTEGER });

/**
 * Un usuario válido en Mongo. Los jobs del Worker descartan lo de una cuenta que ya no existe,
 * así que toda comida o Wrapped de un test necesita a su dueño.
 */
export async function createOwner(fields: Partial<User> = {}): Promise<Types.ObjectId> {
  const _id = fields._id ?? new Types.ObjectId();
  await UserModel.create({
    email: `${_id.toString()}@example.com`,
    passwordHash: "x",
    profile: {
      sex: "female",
      birthDate: "2002-04-10",
      heightCm: 165,
      weightKg: 60,
      activity: "moderate",
      goal: "maintain",
      timezone: "America/Montevideo",
    },
    targets: { kcal: 2093, proteinG: 108, carbsG: 285, fatG: 58 },
    tone: "off",
    ...fields,
    _id,
  });
  return _id;
}
