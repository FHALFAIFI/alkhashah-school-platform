import { defineConfig, globalIgnores } from "eslint/config";
import nextPlugin from "eslint-config-next";

export default defineConfig([
  globalIgnores([".next/**", "node_modules/**", "drizzle/**", "storage/**", "backups/**", "playwright-report/**", "test-results/**",
    // Windows desktop edition: generated app tree, downloaded runtimes and installer output
    "desktop/build/**", "desktop/vendor/**", "desktop/dist/**", "desktop/node_modules/**", "desktop/.cache/**"]),
  ...nextPlugin,
]);
