import { randomBytes } from "node:crypto";
import type { KeyObject } from "node:crypto";
import bcrypt from "bcryptjs";
import { mongo } from "mongoose";
import { AppError } from "@caloria/shared";
import type { AuthResponse, LoginInput, RegisterInput } from "@caloria/shared";
import { UserModel } from "../models/User";
import type { Session, User } from "../models/User";
import { computeTargets } from "./targets";
import { newRefreshSession, signAccessToken } from "./tokens";

export const BCRYPT_COST = 12;
const INVALID_CREDENTIALS = "Email o contraseña incorrectos";
/** Tope de sesiones por usuario: al pasarlo se descartan las más viejas. */
export const MAX_SESSIONS = 10;

export interface AuthService {
  register(input: RegisterInput): Promise<AuthResponse>;
  login(input: LoginInput): Promise<AuthResponse>;
}

function isDuplicateKey(err: unknown): boolean {
  return err instanceof mongo.MongoServerError && err.code === 11000;
}

/**
 * Agrega la sesión y, en la misma escritura, descarta las vencidas y deja solo las
 * MAX_SESSIONS más recientes, así `sessions` no crece sin límite.
 */
export function addSession(session: Session, now = new Date()) {
  const alive = {
    $filter: { input: "$sessions", cond: { $gt: ["$$this.expiresAt", now] } },
  };
  return [
    {
      $set: {
        sessions: {
          $slice: [{ $concatArrays: [alive, [{ $literal: session }]] }, -MAX_SESSIONS],
        },
      },
    },
  ];
}

export function createAuthService({ privateKey }: { privateKey: KeyObject }): AuthService {
  const dummyHash = bcrypt.hash(randomBytes(16).toString("hex"), BCRYPT_COST);

  function issueTokens(user: Pick<User, "_id" | "email" | "plan">) {
    const id = user._id.toString();
    const { token, session } = newRefreshSession();
    const response: AuthResponse = {
      accessToken: signAccessToken({ sub: id, plan: user.plan.tier }, privateKey),
      refreshToken: token,
      user: { id, email: user.email },
    };
    return { response, session };
  }

  return {
    async register({ email, password, profile }) {
      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
      const user = new UserModel({
        email,
        passwordHash,
        profile,
        targets: computeTargets(profile),
      });
      const { response, session } = issueTokens(user);
      user.sessions.push(session);
      try {
        await user.save();
      } catch (err) {
        // El índice único es la garantía: cubre también dos registros simultáneos.
        if (isDuplicateKey(err)) throw new AppError("EMAIL_TAKEN", undefined, { cause: err });
        throw err;
      }
      return response;
    },

    async login({ email, password }) {
      const user = await UserModel.findOne({ email });
      const matches = await bcrypt.compare(password, user?.passwordHash ?? (await dummyHash));
      if (!user || !matches) throw new AppError("UNAUTHORIZED", INVALID_CREDENTIALS);

      const { response, session } = issueTokens(user);
      await UserModel.updateOne({ _id: user._id }, addSession(session));
      return response;
    },
  };
}
