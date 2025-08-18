const express = require("express");
const app = express();

app.get("/api/ping", (req, res) => {
  res.json({ ok: true });
});

app.listen(3000, () => {
  console.log("Backend running on port 3000");
});
