import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa",
  },
  strict: true,
  verbose: true,
});
