import type { FastifyPluginAsync } from "fastify";
import { visitTotal } from "../../common/metrics.js";

let VISITS_TOTAL = 0;

const visitsHttp: FastifyPluginAsync = async (app) => {
  // Ping module -> /api/visits/ping
  app.get("/visits/ping", async () => ({ ok: true, service: "visits" }));

  // Incrémente pour navigate/reload UNIQUEMENT
  app.post("/visit", async (req) => {
    const ntype = String(req.headers["x-nav-type"] || "");
    const site  = String(req.headers["sec-fetch-site"] || "same-origin"); // chrome met "same-origin"
    const origin = String(req.headers["origin"] || "");
    const referer = String(req.headers["referer"] || "");

    const isNavType = ntype === "navigate" || ntype === "reload";
    const isSameSite = site === "same-origin"
      || (origin.startsWith("https://localhost") || referer.startsWith("https://localhost"));

    const shouldCount = isNavType && isSameSite;

    app.log.info(
      `Visit detected: ${shouldCount ? "YES" : "NO"} (site:${site}, type:${ntype}, origin:${origin || "-"}, referer:${referer || "-"})`
    );

    if (shouldCount) {
      VISITS_TOTAL++;
      visitTotal.inc();
    }

    return { total: VISITS_TOTAL };
  });

  // Lecture simple
  app.get("/visits", async () => ({ total: VISITS_TOTAL }));
};

export default visitsHttp;
