import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Application version/commit stamped onto pilot-feedback records.
 * Reads package.json version once (cached) and appends the short commit from
 * APP_COMMIT when the deploy provides it. No secrets, no request-time shelling out.
 */
let cached: string | null = null;

export function appVersion(): string {
  if (cached) return cached;
  let version = "0.0.0";
  try {
    const pkg = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as {
      version?: string;
    };
    version = pkg.version ?? version;
  } catch {
    // package.json unreadable in some runtimes — fall back to the default
  }
  const commit = process.env.APP_COMMIT?.trim().slice(0, 12);
  cached = commit ? `${version}+${commit}` : version;
  return cached;
}
