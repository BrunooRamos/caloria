import type { KeyObject } from "node:crypto";
import type { RequestHandler, Response } from "express";
import { isValidObjectId } from "mongoose";
import { AppError, verifyAccessToken } from "@caloria/shared";
import { UserModel } from "../models/User";
import { hasDeletionRequest } from "../services/account-deletion";

const BEARER = /^Bearer (\S+)$/i;

export interface RequireAuthOptions {
  /**
   * Solo `DELETE /users/me`: deja pasar el token de una cuenta que ya se borró, si hay un pedido de
   * borrado reciente. Así repetir el pedido (se perdió la respuesta) responde 204 y no 401.
   */
  allowDeletedAccount?: boolean;
}

/**
 * Verifica el JWT y que la cuenta exista. El access token no tiene estado y sigue siendo válido
 * hasta 15 min después de borrar la cuenta (y el Front solo mira la firma): sin este chequeo, un
 * token de una cuenta borrada seguiría leyendo y escribiendo.
 */
export function requireAuth(
  publicKey: KeyObject,
  { allowDeletedAccount = false }: RequireAuthOptions = {},
): RequestHandler {
  return async (req, res, next) => {
    const token = BEARER.exec(req.get("authorization") ?? "")?.[1];
    if (!token) throw new AppError("UNAUTHORIZED");
    const { sub } = verifyAccessToken(token, publicKey);
    if (!isValidObjectId(sub)) throw new AppError("UNAUTHORIZED");
    if (!(await UserModel.exists({ _id: sub }))) {
      if (!allowDeletedAccount || !(await hasDeletionRequest(sub))) {
        throw new AppError("UNAUTHORIZED");
      }
    }
    res.locals.userId = sub;
    next();
  };
}

export function userIdOf(res: Response): string {
  const { userId } = res.locals;
  if (typeof userId !== "string") throw new AppError("UNAUTHORIZED");
  return userId;
}
