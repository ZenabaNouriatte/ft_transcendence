// backend/src/common/env.ts
import * as dotenv from "dotenv"; dotenv.config();
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(8000),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  DB_PATH: z.string().default("./data/app.sqlite"),
  CORS_ORIGIN: z.string().optional(),
});

export type Env = z.infer<typeof Env>;
export const env = Env.parse(process.env);
export const isProd = env.NODE_ENV === "production";
