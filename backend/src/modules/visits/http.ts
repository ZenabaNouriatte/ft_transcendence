// import type { FastifyPluginAsync, FastifyRequest } from "fastify";
// import { getVisitTotal, incrementVisit, openDb } from "../../data/index.js";


// const visitsHttp: FastifyPluginAsync = async (app) => {
//   openDb(); // s’assure que la DB et le schéma sont prêts

//   app.get("/visits", async () => ({ total: getVisitTotal() }));

//   app.post("/visit", async (req: FastifyRequest) => {
//     const h = req.headers;

//     const ntype   = String(h["x-nav-type"] ?? "").toLowerCase(); // "navigate" | "reload" (from your client)
//     const site    = String(h["sec-fetch-site"] ?? "same-origin").toLowerCase();
//     const origin  = String(h["origin"] ?? "");
//     const referer = String(h["referer"] ?? "");

//     const isNav = ntype === "navigate" || ntype === "reload";

//     // same-origin via Sec-Fetch-Site OR Origin/Referer fallback
//     const isSameSite =
//       site === "same-origin" ||
//       origin.startsWith("https://localhost") ||
//       referer.startsWith("https://localhost");

//     const shouldCount = isNav && isSameSite;

//     app.log.info({ ntype, site, origin, referer, shouldCount }, "visit check");

//     const total = shouldCount ? incrementVisit() : getVisitTotal();
//     return { ok: true, total };
//   });
// };
// export default visitsHttp;

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
