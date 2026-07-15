import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __madrasaPool?: Pool };

export const pool =
  globalForDb.__madrasaPool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa",
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__madrasaPool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema };
