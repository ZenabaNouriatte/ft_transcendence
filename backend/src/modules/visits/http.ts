import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { getVisitTotal, incrementVisit, openDb } from "../../data/index.js";


const visitsHttp: FastifyPluginAsync = async (app) => {
  openDb(); // s’assure que la DB et le schéma sont prêts

  app.get("/visits", async () => ({ total: getVisitTotal() }));

  app.post("/visit", async (req: FastifyRequest) => {
    const h = req.headers;

    const ntype   = String(h["x-nav-type"] ?? "").toLowerCase(); // "navigate" | "reload" (from your client)
    const site    = String(h["sec-fetch-site"] ?? "same-origin").toLowerCase();
    const origin  = String(h["origin"] ?? "");
    const referer = String(h["referer"] ?? "");

    const isNav = ntype === "navigate" || ntype === "reload";

    // same-origin via Sec-Fetch-Site OR Origin/Referer fallback
    const isSameSite =
      site === "same-origin" ||
      origin.startsWith("https://localhost") ||
      referer.startsWith("https://localhost");

    const shouldCount = isNav && isSameSite;

    app.log.info({ ntype, site, origin, referer, shouldCount }, "visit check");

    const total = shouldCount ? incrementVisit() : getVisitTotal();
    return { ok: true, total };
  });
};
export default visitsHttp;

