import express from "express";

const app = express();
const port = Number(process.env.PORT) || 4000;

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "back" });
});

app.listen(port, () => {
  console.log(`back-service escuchando en :${port}`);
});
