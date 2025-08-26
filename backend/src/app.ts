// backend/src/app.ts (extrait)
import Fastify from 'fastify';
import { registerMetrics } from './metrics';

export async function buildApp() {
  const app = Fastify({ logger: true });
  // ... tes routes existantes ...
  await registerMetrics(app);
  return app;
}
