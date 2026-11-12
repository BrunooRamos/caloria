import { createServer } from "node:https";
import type { Server } from "node:https";
import type { TLSSocket } from "node:tls";
import type { RequestListener } from "node:http";
import { MTLS_FRONT_CN } from "@caloria/shared";
import type { Logger, MtlsCredentials } from "@caloria/shared";

/**
 * Servidor HTTPS con mTLS (RNF-03): el Backend solo acepta conexiones que presenten un certificado
 * de cliente firmado por la CA propia y emitido para el Front (CN caloria-front, uso clientAuth).
 * Sin certificado, con uno de otra CA o con otro de la nuestra (el del propio Backend), el
 * handshake falla o la conexión se corta antes de leer el request: nunca llega a Express.
 */
export function createMtlsServer(
  app: RequestListener,
  { ca, cert, key }: MtlsCredentials,
  logger: Logger,
): Server {
  const server = createServer(
    {
      ca,
      cert,
      key,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
    },
    app,
  );

  // La CA es nuestra y solo emite para Front y Backend, pero igual se exige el CN del Front.
  server.on("secureConnection", (socket: TLSSocket) => {
    const cn = socket.getPeerCertificate().subject?.CN;
    if (cn !== MTLS_FRONT_CN) {
      logger.warn("mTLS: conexión rechazada, el certificado no es del Front", {
        remoteAddress: socket.remoteAddress,
      });
      socket.destroy();
    }
  });
  server.on("tlsClientError", (err, socket) => {
    logger.warn("mTLS: handshake rechazado", {
      reason: (err as NodeJS.ErrnoException).code ?? err.message,
      remoteAddress: socket.remoteAddress,
    });
  });
  return server;
}
