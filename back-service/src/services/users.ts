import { AppError, DEFAULT_NOTIFICATIONS, MAX_PUSH_TOKENS } from "@caloria/shared";
import type { MeResponse, UpdateMeInput } from "@caloria/shared";
import { UserModel } from "../models/User";
import type { User } from "../models/User";
import { computeTargets } from "./targets";

const MAX_UPDATE_ATTEMPTS = 3;
// Los push tokens nunca salen en la respuesta.
const ME_FIELDS = {
  email: 1,
  profile: 1,
  targets: 1,
  tone: 1,
  plan: 1,
  notifications: 1,
} as const;

type MeFields = Pick<
  User,
  "_id" | "email" | "profile" | "targets" | "tone" | "plan" | "notifications"
>;

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
    notifications: { ...DEFAULT_NOTIFICATIONS, ...user.notifications },
  };
}

/**
 * Expresión de agregación que suma `tokens` al final de `pushTokens`: un token que ya estaba se
 * mueve al final (es el más nuevo) y quedan los últimos MAX_PUSH_TOKENS.
 */
function appendPushTokens(tokens: string[]) {
  const others = {
    $filter: {
      input: { $ifNull: ["$pushTokens", []] },
      cond: { $not: [{ $in: ["$$this", { $literal: tokens }] }] },
    },
  };
  return { $slice: [{ $concatArrays: [others, { $literal: tokens }] }, -MAX_PUSH_TOKENS] };
}

export function createUserService(): UserService {
  return {
    async getMe(userId) {
      const user = await UserModel.findById(userId, ME_FIELDS).lean<MeFields>();
      if (!user) throw new AppError("UNAUTHORIZED");
      return toMe(user);
    },

    async updateMe(userId, { profile: changes, pushTokens = [], notifications = {} }) {
      // Avisos y tokens no dependen de lo que hay guardado: van igual en cada intento.
      const fixed: Record<string, unknown> = {};
      for (const [type, enabled] of Object.entries(notifications)) {
        fixed[`notifications.${type}`] = enabled;
      }
      if (pushTokens.length > 0) fixed.pushTokens = appendPushTokens(pushTokens);

      for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
        let filter: Record<string, unknown> = { _id: userId };
        const set = { ...fixed };
        if (changes) {
          const current = await UserModel.findById(userId, { profile: 1 }).lean<
            Pick<User, "profile">
          >();
          if (!current) throw new AppError("UNAUTHORIZED");

          const profile = { ...current.profile, ...changes };
          const unchanged = Object.fromEntries(
            Object.entries(current.profile).map(([key, value]) => [`profile.${key}`, value]),
          );
          filter = { ...filter, ...unchanged };
          set.profile = { $literal: profile };
          set.targets = { $literal: computeTargets(profile) };
        }

        // Un solo update (pipeline) para que todo el PATCH se aplique junto o no se aplique.
        const updated =
          Object.keys(set).length === 0
            ? await UserModel.findById(userId, ME_FIELDS).lean<MeFields>()
            : await UserModel.findOneAndUpdate(filter, [{ $set: set }], {
                new: true,
                projection: ME_FIELDS,
              }).lean<MeFields>();
        if (updated) {
          // El mismo teléfono con otra cuenta: esa cuenta deja de recibir los avisos.
          if (pushTokens.length > 0) {
            await UserModel.updateMany(
              { _id: { $ne: updated._id }, pushTokens: { $in: pushTokens } },
              { $pull: { pushTokens: { $in: pushTokens } } },
            );
          }
          return toMe(updated);
        }
        // Sin perfil el filtro es solo el _id: si no matcheó, la cuenta no existe.
        if (!changes) throw new AppError("UNAUTHORIZED");
      }
      throw new AppError("INTERNAL_ERROR", undefined, {
        cause: new Error(`El perfil cambió ${MAX_UPDATE_ATTEMPTS} veces durante el PATCH`),
      });
    },
  };
}
