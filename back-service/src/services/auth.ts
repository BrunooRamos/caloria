import { randomBytes } from "node:crypto";
import type { KeyObject } from "node:crypto";
import bcrypt from "bcryptjs";
import { isValidObjectId, mongo } from "mongoose";
import { AppError } from "@caloria/shared";
import type { AuthResponse, LoginInput, Logger, RegisterInput } from "@caloria/shared";
import { UserModel } from "../models/User";
import type { Session, User } from "../models/User";
import { effectiveTier } from "./plan";
import { monthIn } from "./quota";
import { computeTargets } from "./targets";
import { hashRefreshToken, newRefreshSession, signAccessToken } from "./tokens";

export const BCRYPT_COST = 12;
const INVALID_CREDENTIALS = "Email o contraseña incorrectos";
export const MAX_SESSIONS = 10;
export const MAX_INACTIVE_SESSIONS = 100;

export interface AuthService {
  register(input: RegisterInput): Promise<AuthResponse>;
  login(input: LoginInput): Promise<AuthResponse>;
  refresh(refreshToken: string, log: Logger): Promise<AuthResponse>;
  /** Con `pushToken`, además ese dispositivo deja de recibir los avisos de la cuenta. */
  logout(userId: string, refreshToken: string, pushToken?: string): Promise<void>;
}

function isDuplicateKey(err: unknown): boolean {
  return err instanceof mongo.MongoServerError && err.code === 11000;
}

type Expr = unknown;

const isUnset = (field: string) => ({ $eq: [{ $ifNull: [field, null] }, null] });
const isActive = (s: string) => ({
  $and: [isUnset(`${s}.rotatedAt`), isUnset(`${s}.revokedAt`)],
});

function writeSessions(next: Expr, now: Date) {
  const alive = { $filter: { input: next, as: "s", cond: { $gt: ["$$s.expiresAt", now] } } };
  return [
    { $set: { sessions: alive } },
    {
      $set: {
        sessions: {
          $concatArrays: [
            {
              $slice: [
                { $filter: { input: "$sessions", as: "s", cond: { $not: [isActive("$$s")] } } },
                -MAX_INACTIVE_SESSIONS,
              ],
            },
            {
              $slice: [
                { $filter: { input: "$sessions", as: "s", cond: isActive("$$s") } },
                -MAX_SESSIONS,
              ],
            },
          ],
        },
      },
    },
  ];
}

export function addSession(session: Session, now = new Date()) {
  return writeSessions({ $concatArrays: ["$sessions", [{ $literal: session }]] }, now);
}

function familyOf(tokenHash: string) {
  return {
    $let: {
      vars: {
        match: {
          $first: {
            $filter: { input: "$sessions", as: "s", cond: { $eq: ["$$s.tokenHash", tokenHash] } },
          },
        },
      },
      in: "$$match.family",
    },
  };
}

function rotateSession(tokenHash: string, next: Omit<Session, "family">, now: Date) {
  const marked = {
    $map: {
      input: "$sessions",
      as: "s",
      in: {
        $cond: [
          { $eq: ["$$s.tokenHash", tokenHash] },
          { $mergeObjects: ["$$s", { rotatedAt: now }] },
          "$$s",
        ],
      },
    },
  };
  const added = { $mergeObjects: [{ $literal: next }, { family: familyOf(tokenHash) }] };
  return writeSessions({ $concatArrays: [marked, [added]] }, now);
}

function revokeFamily(family: Expr, now: Date) {
  return writeSessions(
    {
      $map: {
        input: "$sessions",
        as: "s",
        in: {
          $cond: [
            { $eq: ["$$s.family", family] },
            { $mergeObjects: ["$$s", { revokedAt: { $ifNull: ["$$s.revokedAt", now] } }] },
            "$$s",
          ],
        },
      },
    },
    now,
  );
}

export function createAuthService({ privateKey }: { privateKey: KeyObject }): AuthService {
  const dummyHash = bcrypt.hash(randomBytes(16).toString("hex"), BCRYPT_COST);

  function issueTokens(user: Pick<User, "_id" | "email" | "plan">) {
    const id = user._id.toString();
    const { token, session } = newRefreshSession();
    const response: AuthResponse = {
      accessToken: signAccessToken(
        { sub: id, plan: effectiveTier(user.plan, new Date()) },
        privateKey,
      ),
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
        usage: { month: monthIn(profile.timezone, new Date()), analyses: 0 },
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

    async refresh(refreshToken, log) {
      const tokenHash = hashRefreshToken(refreshToken);
      const now = new Date();
      const usable = {
        tokenHash,
        rotatedAt: null,
        revokedAt: null,
        expiresAt: { $gt: now },
      };

      // Operación atómica que solo matchea si el refresh sigue sin rotar: de dos refresh
      // simultáneos con el mismo token, uno rota y el otro cae abajo como reuso.
      const { token, session } = newRefreshSession(now);
      const { tokenHash: nextHash, expiresAt } = session;
      const user = await UserModel.findOneAndUpdate(
        { sessions: { $elemMatch: usable } },
        rotateSession(tokenHash, { tokenHash: nextHash, expiresAt }, now),
        { projection: { email: 1, plan: 1 }, new: true, lean: true },
      );
      if (user) {
        const id = user._id.toString();
        return {
          // El plan sale de la base ahora, no del access anterior: puede haber pasado a premium.
          accessToken: signAccessToken(
            { sub: id, plan: effectiveTier(user.plan, new Date()) },
            privateKey,
          ),
          refreshToken: token,
          user: { id, email: user.email },
        };
      }

      const found = await UserModel.findOne(
        { "sessions.tokenHash": tokenHash },
        { sessions: { $elemMatch: { tokenHash } } },
      ).lean();
      const used = found?.sessions[0];
      if (found && used?.rotatedAt && !used.revokedAt && used.expiresAt > now) {
        await UserModel.updateOne({ _id: found._id }, revokeFamily({ $literal: used.family }, now));
        log.warn("reuso de refresh token: se revocó la familia", {
          userId: found._id.toString(),
          family: used.family,
        });
      }
      throw new AppError("UNAUTHORIZED");
    },

    async logout(userId, refreshToken, pushToken) {
      if (!isValidObjectId(userId)) return;
      // El access ya prueba que es su cuenta: el token se saca aunque la sesión ya no exista.
      if (pushToken) {
        await UserModel.updateOne({ _id: userId }, { $pull: { pushTokens: pushToken } });
      }
      const tokenHash = hashRefreshToken(refreshToken);
      await UserModel.updateOne(
        { _id: userId, "sessions.tokenHash": tokenHash },
        revokeFamily(familyOf(tokenHash), new Date()),
      );
    },
  };
}
