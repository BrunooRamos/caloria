import express from "express";
import { connectMongo, mongoStatus } from "./config/db";
import { UserModel } from "./models/User";

const app = express();
const port = Number(process.env.PORT) || 4000;

app.get("/health", (_req, res) => {
  const mongo = mongoStatus();
  const ok = mongo === "connected";
  res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", service: "back", mongo });
});

app.listen(port, () => {
  console.log(`back-service escuchando en :${port}`);
});

connectMongo()
  .then(() => UserModel.syncIndexes())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
