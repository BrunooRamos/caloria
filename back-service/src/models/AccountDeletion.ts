import { Schema, model, type Types } from "mongoose";

/**
 * Un pedido de borrado de cuenta. Es la marca de "esta cuenta se está borrando": se crea
 * antes de borrar nada y la quita el Worker cuando terminó, así lo que falle a mitad de camino se
 * completa después. No guarda datos personales: solo el id de la cuenta y fechas.
 */
export interface AccountDeletion {
  /** El id del usuario que se borra. */
  _id: Types.ObjectId;
  requestedAt: Date;
  /** Cuándo el Worker terminó de borrar documentos y media. Sin el campo, está pendiente. */
  completedAt?: Date;
}

/**
 * Terminado, el registro se guarda una hora: un `DELETE /users/me` repetido con el mismo access
 * token (vive 15 min) responde 204 en vez de 401. Después se borra solo.
 */
export const COMPLETED_RETENTION_SECONDS = 60 * 60;

const accountDeletionSchema = new Schema<AccountDeletion>(
  {
    _id: { type: Schema.Types.ObjectId, required: true },
    requestedAt: { type: Date, required: true },
    completedAt: { type: Date },
  },
  { collection: "account_deletions", versionKey: false },
);

// El TTL solo mira los que tienen el campo: un pedido pendiente nunca vence.
accountDeletionSchema.index(
  { completedAt: 1 },
  { expireAfterSeconds: COMPLETED_RETENTION_SECONDS },
);

export const AccountDeletionModel = model<AccountDeletion>(
  "AccountDeletion",
  accountDeletionSchema,
);
