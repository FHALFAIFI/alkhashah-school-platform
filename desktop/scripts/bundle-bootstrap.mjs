// Bundles the production migration and seed entry points (src/db/migrate.ts, src/db/seed.ts)
// into self-contained CommonJS files that run on the bundled Node runtime, next to the
// Next.js standalone server. No logic is re-implemented: the desktop first run executes
// exactly the code the Docker `init` / `seed` services execute.
//
// Native/runtime packages stay external and resolve from the standalone node_modules.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const outDir = process.argv[2] ?? path.join(root, ".next", "standalone", "desktop-bootstrap");

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  logLevel: "warning",
  external: ["pg", "pg-native", "@node-rs/argon2"],
  alias: {
    "@": path.join(root, "src"),
    "server-only": path.join(here, "server-only-shim.cjs"),
  },
  legalComments: "none",
};

await build({ ...common, entryPoints: { migrate: path.join(root, "src/db/migrate.ts"), seed: path.join(root, "src/db/seed.ts") }, outdir: outDir, outExtension: { ".js": ".cjs" } });
console.log(`bootstrap bundles written to ${outDir}`);
