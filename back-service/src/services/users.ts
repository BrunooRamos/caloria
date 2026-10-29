import { AppError } from "@caloria/shared";
import type { MeResponse, UpdateMeInput } from "@caloria/shared";
import { UserModel } from "../models/User";
import type { User } from "../models/User";
import { computeTargets } from "./targets";

const MAX_UPDATE_ATTEMPTS = 3;
const ME_FIELDS = { email: 1, profile: 1, targets: 1, tone: 1, plan: 1 } as const;

type MeFields = Pick<User, "_id" | "email" | "profile" | "targets" | "tone" | "plan">;

export interface UserService {
  getMe(userId: string): Promise<MeResponse>;
  updateMe(userId: string, input: UpdateMeInput): Promise<MeResponse>;
}

function toMe(user: MeFields): MeResponse {
  const { tier, since, renewsAt } = user.plan;
  return {
    id: user._id.toString(),
    email: user.email,
    profile: user.profile,
    targets: user.targets,
    tone: user.tone,
    plan: {
      tier,
      since: since.toISOString(),
      ...(renewsAt && { renewsAt: renewsAt.toISOString() }),
    },
  };
}

export function createUserService(): UserService {
  return {
    async getMe(userId) {
      const user = await UserModel.findById(userId, ME_FIELDS).lean<MeFields>();
      if (!user) throw new AppError("UNAUTHORIZED");
      return toMe(user);
    },

    async updateMe(userId, { profile: changes, tone }) {
      // Solo el tono: un $set atómico que no toca el perfil ni las metas.
      if (!changes) {
        const updated = await UserModel.findByIdAndUpdate(
          userId,
          { $set: { tone } },
          { new: true, projection: ME_FIELDS, runValidators: true },
        ).lean<MeFields>();
        if (!updated) throw new AppError("UNAUTHORIZED");
        return toMe(updated);
      }

      for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
        const current = await UserModel.findById(userId, { profile: 1 }).lean<
          Pick<User, "profile">
        >();
        if (!current) throw new AppError("UNAUTHORIZED");

        const profile = { ...current.profile, ...changes };
        const unchanged = Object.fromEntries(
          Object.entries(current.profile).map(([key, value]) => [`profile.${key}`, value]),
        );
        const updated = await UserModel.findOneAndUpdate(
          { _id: userId, ...unchanged },
          { $set: { profile, targets: computeTargets(profile), ...(tone && { tone }) } },
          { new: true, projection: ME_FIELDS },
        ).lean<MeFields>();
        if (updated) return toMe(updated);
      }
      throw new AppError("INTERNAL_ERROR", undefined, {
        cause: new Error(`El perfil cambió ${MAX_UPDATE_ATTEMPTS} veces durante el PATCH`),
      });
    },
  };
}
