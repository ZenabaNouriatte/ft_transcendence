// src/modules/visits/http.ts
import type { FastifyInstance } from "fastify";
import { getVisitTotal, incrementVisit } from "../../data/index.js";
import { visitsDbTotal, visitsApiIncrementsTotal } from "../../common/metrics.js";

export default async function visitsHttp(app: FastifyInstance) {
  // GET /api/visits (prefix défini dans index.ts)
  app.get("/visits", async (_req, _reply) => {
    const total = getVisitTotal();
    visitsDbTotal.set(total);           // snapshot pour Grafana
    return { total };
  });

  // POST /api/visit
  app.post("/visit", async (req, _reply) => {
    const raw = (req.headers["x-nav-type"] as string | undefined) || "";
    const type = raw.toLowerCase() === "navigate" ? "navigate" : "reload";
    visitsApiIncrementsTotal.inc({ type }); // compteur cumulatif (pour rate())
    const total = incrementVisit();         // source de vérité = DB
    visitsDbTotal.set(total);               // recale la gauge
    return { ok: true, total };
  });
}
