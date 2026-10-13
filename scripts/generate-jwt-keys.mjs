import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const force = args.includes("--force");
const target = args.find((arg) => !arg.startsWith("--"));

const repoRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const outDir = resolve(target ?? join(homedir(), ".caloria", "jwt"));

function assertOutsideRepo(dir) {
  const rel = relative(repoRoot, dir);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    console.error(
      `✖ ${dir} está dentro del repo. Elegí una carpeta afuera (p. ej. ~/.caloria/jwt).`,
    );
    process.exit(1);
  }
}

assertOutsideRepo(outDir);
mkdirSync(outDir, { recursive: true, mode: 0o700 });
// Otra vez sobre la ruta real, por si la carpeta (o un padre) es un symlink hacia el repo.
const realOut = realpathSync(outDir);
assertOutsideRepo(realOut);

const privatePath = join(realOut, "jwt-private.pem");
const publicPath = join(realOut, "jwt-public.pem");
const envPath = join(realOut, "jwt.env");

if (!force && [privatePath, publicPath].some((path) => existsSync(path))) {
  console.error(`✖ Ya hay claves en ${realOut}. Usá --force para reemplazarlas.`);
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const oneLine = (pem) => `"${pem.trim().replace(/\n/g, "\\n")}"`;

writeFileSync(privatePath, privateKey, { mode: 0o600 });
writeFileSync(publicPath, publicKey, { mode: 0o644 });
writeFileSync(
  envPath,
  `JWT_PRIVATE_KEY=${oneLine(privateKey)}\nJWT_PUBLIC_KEY=${oneLine(publicKey)}\n`,
  { mode: 0o600 },
);
chmodSync(privatePath, 0o600);
chmodSync(envPath, 0o600);

console.log(`✔ Par RS256 (RSA 2048) generado en ${realOut}
    jwt-private.pem  firma; solo back-service (JWT_PRIVATE_KEY)
    jwt-public.pem   verifica; front-service (JWT_PUBLIC_KEY)
    jwt.env          las dos variables en una línea cada una

Con docker compose (lee infra/.env, que está en .gitignore):
    cat "${envPath}" >> infra/.env

Corriendo los servicios con npm run dev, en la terminal de cada uno:
    back-service:   export JWT_PRIVATE_KEY="$(cat "${privatePath}")"
    front-service:  export JWT_PUBLIC_KEY="$(cat "${publicPath}")"

Nunca copies la clave privada al repo ni al Front.`);
