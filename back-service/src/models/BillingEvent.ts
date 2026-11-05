import { Schema, model } from "mongoose";

export interface BillingEvent {
  _id: string; // id del evento en el proveedor
  type: string;
  status: "processing" | "done";
  receivedAt: Date;
}

/** El proveedor reintenta hasta 3 días; se guardan 30 por las dudas y después se borran solos. */
const RETENTION_SECONDS = 30 * 24 * 60 * 60;

const billingEventSchema = new Schema<BillingEvent>(
  {
    _id: { type: String, required: true },
    type: { type: String, required: true },
    status: { type: String, enum: ["processing", "done"], required: true },
    receivedAt: { type: Date, required: true },
  },
  { collection: "billing_events", versionKey: false },
);

billingEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

export const BillingEventModel = model<BillingEvent>("BillingEvent", billingEventSchema);
