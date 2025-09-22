// src/modules/visits/http.ts
import type { FastifyInstance } from "fastify";
import { getVisitTotal, incrementVisit } from "../../database/index.js";
import { visitsDbTotal, visitsApiIncrementsTotal } from "../../common/metrics.js";

export default async function visitsHttp(app: FastifyInstance) {
  // GET /api/visits
  app.get("/visits", async () => {
    const total = await getVisitTotal();     // ← await
    visitsDbTotal.set(total);                // snapshot pour Grafana
    return { total };                        // le testeur lit .total
  });

  // POST /api/visit
  app.post("/visit", async (req) => {
    const raw = (req.headers["x-nav-type"] as string | undefined) || "";
    const type = raw.toLowerCase() === "navigate" ? "navigate" : "reload";
    visitsApiIncrementsTotal.inc({ type });

    const total = await incrementVisit();    // ← await
    visitsDbTotal.set(total);
    return { total };                        
  });
}

