// src/modules/visits/http.ts
import { type FastifyPluginAsync } from "fastify";
import { VisitsService } from "../../services/index.js";
// (optionnel) métriques si tu veux refléter la valeur en gauge:
// import { visitsDbTotal } from "../../common/metrics.js";

const visitsHttp: FastifyPluginAsync = async (app) => {
  // Assure la présence du schéma/ligne au chargement du plugin
  await VisitsService.ensure();

  app.get("/visits", async (_req, reply) => {
    const total = await VisitsService.getTotal();
    // try { visitsDbTotal.set(total); } catch {}
    reply.type("application/json");
    return reply.send({ total });
  });

  app.post("/visit", async (req, reply) => {
    const nav = String(req.headers["x-nav-type"] || "");
    if (!nav) {
      return reply.code(400).send({ error: "missing_nav_type" });
    }
    const total = await VisitsService.increment();
    // try { visitsDbTotal.set(total); } catch {}
    reply.type("application/json");
    return reply.send({ total });
  });
};

export default visitsHttp;

