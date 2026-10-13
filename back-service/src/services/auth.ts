import { randomBytes } from "node:crypto";
import type { KeyObject } from "node:crypto";
import bcrypt from "bcryptjs";
import { mongo } from "mongoose";
import { AppError } from "@caloria/shared";
import type { AuthResponse, LoginInput, PlanTier, RegisterInput } from "@caloria/shared";
import { User } from "../models/user";
import { newRefreshSession, signAccessToken } from "./tokens";

export const BCRYPT_COST = 12;
const INVALID_CREDENTIALS = "Email o contraseña incorrectos";

export interface AuthService {
  register(input: RegisterInput): Promise<AuthResponse>;
  login(input: LoginInput): Promise<AuthResponse>;
}

function isDuplicateKey(err: unknown): boolean {
  return err instanceof mongo.MongoServerError && err.code === 11000;
}

export function createAuthService({ privateKey }: { privateKey: KeyObject }): AuthService {
  const dummyHash = bcrypt.hash(randomBytes(16).toString("hex"), BCRYPT_COST);

  function issueTokens(user: { id: string; email: string; plan: { tier: PlanTier } }) {
    const { token, session } = newRefreshSession();
    const response: AuthResponse = {
      accessToken: signAccessToken({ sub: user.id, plan: user.plan.tier }, privateKey),
      refreshToken: token,
      user: { id: user.id, email: user.email },
    };
    return { response, session };
  }

  return {
    async register({ email, password, profile }) {
      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
      const user = new User({ email, passwordHash, profile });
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
      const user = await User.findOne({ email });
      const matches = await bcrypt.compare(password, user?.passwordHash ?? (await dummyHash));
      if (!user || !matches) throw new AppError("UNAUTHORIZED", INVALID_CREDENTIALS);

      const { response, session } = issueTokens(user);
      await User.updateOne({ _id: user._id }, { $push: { sessions: session } });
      return response;
    },
  };
}
