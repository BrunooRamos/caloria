import type { RequestHandler } from "express";
import { updateMeSchema } from "@caloria/shared";
import { userIdOf } from "../middleware/auth";
import type { AccountDeletionService } from "../services/account-deletion";
import type { UserService } from "../services/users";

export function usersController(users: UserService): Record<"getMe" | "updateMe", RequestHandler> {
  return {
    async getMe(_req, res) {
      res.json(await users.getMe(userIdOf(res)));
    },
    async updateMe(req, res) {
      res.json(await users.updateMe(userIdOf(res), updateMeSchema.parse(req.body)));
    },
  };
}

/** `DELETE /users/me`: borra la cuenta y responde 204 sin cuerpo. */
export function accountDeletionController(accounts: AccountDeletionService): RequestHandler {
  return async (req, res) => {
    await accounts.deleteAccount(userIdOf(res), { requestId: req.requestId, log: req.log });
    res.status(204).end();
  };
}
