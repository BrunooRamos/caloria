import type { RequestHandler } from "express";
import { validateMealUpload } from "@caloria/shared";
import type { ValidMealUpload } from "@caloria/shared";
import type { BackendClient } from "../clients/backend";
import { authOf } from "../middleware/auth";
import type { RouteSchema } from "../schemas";

type MulterFiles = Partial<Record<"photo" | "audio", Express.Multer.File[]>>;

/**
 * Rearma el multipart con lo validado: el tipo es el detectado, no el que mandó el cliente,
 * y el nombre de archivo original no pasa (el Backend arma las keys con userId y mealId).
 */
function toForm({ photo, audio, note }: ValidMealUpload): FormData {
  const form = new FormData();
  const file = ({ buffer, contentType }: { buffer: Buffer; contentType: string }) =>
    new Blob([new Uint8Array(buffer)], { type: contentType });
  form.append("photo", file(photo), "photo");
  if (audio) form.append("audio", file(audio), "audio");
  if (note !== undefined) form.append("note", note);
  return form;
}

export function createMeal(backend: BackendClient, schema: RouteSchema): RequestHandler {
  return async (req, res) => {
    schema.params.parse(req.params);
    schema.query.parse(req.query);
    const files = req.files as MulterFiles | undefined;
    const upload = validateMealUpload({
      photo: files?.photo?.[0],
      audio: files?.audio?.[0],
      fields: req.body,
    });

    const auth = authOf(res);
    const result = await backend.request({
      method: "POST",
      path: "/api/v1/meals",
      requestId: req.requestId,
      form: toForm(upload),
      headers: auth && { authorization: `Bearer ${auth.accessToken}` },
    });
    res.status(result.status).set(result.headers).json(result.body);
  };
}
