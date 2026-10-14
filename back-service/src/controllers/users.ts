import type { RequestHandler } from "express";
import { updateMeSchema } from "@caloria/shared";
import { userIdOf } from "../middleware/auth";
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
