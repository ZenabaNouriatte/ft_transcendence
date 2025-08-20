const express = require("express");
const app = express();

app.get("/api/ping", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/hello", (req, res) => {
  res.json({ message: "hello from backend" });
});

// ajout route healthz (pour healthcheck Docker)
app.get("/healthz", (req, res) => {
  res.send("ok");
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});
