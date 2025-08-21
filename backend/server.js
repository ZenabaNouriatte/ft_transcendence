const express = require("express");
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));


const { addVisit, countVisits } = require("./db");

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

app.post("/api/visit", async (_, res) => {
  try {
    await addVisit();
    const total = await countVisits();
    res.json({ total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "db_error" });
  }
});

app.get("/api/visits", async (_, res) => {
  try {
    const total = await countVisits();
    res.json({ total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "db_error" });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});

 