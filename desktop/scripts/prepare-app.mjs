// Assembles desktop/build/server — the immutable application tree shipped in the installer —
// from a `NEXT_OUTPUT=standalone next build`.
//
//   node desktop/scripts/prepare-app.mjs [--skip-build]
//
// Steps: (1) standalone production build (unless --skip-build) with loopback-only server
// action origins, (2) copy standalone server + .next/static + public, (3) bundle the
// production migrate/seed entry points, (4) add the desktop server entry and build
// metadata, (5) fail-closed audit: no school data, private storage, secrets, env files
// or development material may be present in the tree.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const root = path.resolve(desktop, "..");
const out = path.join(desktop, "build", "server");
const skipBuild = process.argv.includes("--skip-build");

function sh(cmd, args, env = {}) {
  // npx is a .cmd shim on Windows and needs a shell; node itself must not go through one
  // (its path may contain spaces, e.g. C:\\Program Files\\nodejs\\node.exe).
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env }, shell: process.platform === "win32" && cmd === "npx" });
}

if (!skipBuild) {
  fs.rmSync(path.join(root, ".next"), { recursive: true, force: true });
  sh("npx", ["next", "build"], {
    NEXT_OUTPUT: "standalone",
    NEXT_TELEMETRY_DISABLED: "1",
    // Only same-origin server actions on the loopback app origin are accepted.
    TRUSTED_ORIGINS: "127.0.0.1",
  });
}

const standalone = path.join(root, ".next", "standalone");
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  throw new Error("standalone build missing — run without --skip-build");
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.cpSync(standalone, out, { recursive: true, dereference: true });
fs.cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
// migrations are read by the bootstrap from ./drizzle relative to the app dir
fs.cpSync(path.join(root, "drizzle"), path.join(out, "drizzle"), { recursive: true });
fs.copyFileSync(path.join(root, "package.json"), path.join(out, "package.json"));
fs.copyFileSync(path.join(desktop, "server", "desktop-server-entry.cjs"), path.join(out, "desktop-server-entry.cjs"));

// The output tracer misses files some externals load dynamically (playwright-core requires
// browsers.json via a computed path). Ship those packages complete.
// sharp's platform packages carry their libvips DLLs/shared objects, which the tracer drops.
const imgDir = path.join(out, "node_modules", "@img");
const imgPkgs = fs.existsSync(imgDir) ? fs.readdirSync(imgDir).map((n) => `@img/${n}`) : [];
for (const pkgName of ["playwright", "playwright-core", ...imgPkgs]) {
  const src = path.join(root, "node_modules", pkgName);
  const dst = path.join(out, "node_modules", pkgName);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true, dereference: true });
}

// Turbopack references server externals through hashed aliases (.next/node_modules/<pkg>-<hash>)
// that are symlinks; fs.cpSync rewrote them to absolute build-machine paths, and symlinks are
// fragile in an NSIS install anyway. Each alias becomes a real copy of the package (a forwarding
// shim is not enough: Turbopack imports these as ES modules and needs their named exports).
const aliasRoot = path.join(out, ".next", "node_modules");
const replaceAliases = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
      const target = fs.readlinkSync(p).split(path.sep).join("/");
      const pkgName = target.slice(target.lastIndexOf("node_modules/") + "node_modules/".length);
      if (!/^(@[a-z0-9-]+\/)?[a-z0-9._-]+$/i.test(pkgName)) throw new Error(`unexpected alias target ${target}`);
      fs.rmSync(p);
      fs.cpSync(path.join(out, "node_modules", ...pkgName.split("/")), p, { recursive: true, dereference: true });
    } else if (e.isDirectory()) {
      replaceAliases(p);
    }
  }
};
replaceAliases(aliasRoot);

// Sources and dev configs are not needed at runtime.
for (const p of ["src", "tsconfig.json", "drizzle.config.ts", "postcss.config.mjs", "next.config.ts", "package-lock.json"]) {
  fs.rmSync(path.join(out, p), { recursive: true, force: true });
}

sh(process.execPath, [path.join(here, "bundle-bootstrap.mjs"), path.join(out, "desktop-bootstrap")]);

let commit = process.env.RELEASE_COMMIT ?? "unknown";
try {
  if (commit === "unknown") commit = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: root }).toString().trim();
} catch { /* not a git checkout */ }
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
fs.writeFileSync(
  path.join(out, "desktop-build.json"),
  JSON.stringify({ version: pkg.version, commit, builtAt: new Date().toISOString(), platform: process.platform, arch: process.arch }, null, 2),
);

// ——— fail-closed audit ———
const forbidden = [
  /(^|\/)reference_files(\/|$)/,
  /(^|\/)storage(-[^/]*)?(\/|$)/,
  /(^|\/)backups(\/|$)/,
  /(^|\/)local_data(\/|$)/,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)initial-credentials\.txt$/,
  /(^|\/)docs\//,
  /(^|\/)tests?\//,
  /(^|\/)scripts\//,
  /(^|\/)\.git(\/|$)/,
  /\.(xlsx|docx|pptx|jpeg|jpg)$/i,
  /(^|\/)(CLAUDE|PROGRESS|RUNBOOK)\.md$/,
];
// paths inside node_modules are third-party code (e.g. a package's own docs/ folder)
const violations = [];
const walk = (dir, rel) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (r.startsWith("node_modules/") || r.includes("/node_modules/")) continue;
    if (forbidden.some((re) => re.test(r))) violations.push(r);
    if (e.isDirectory()) walk(path.join(dir, e.name), r);
  }
};
walk(out, "");
const nm = path.join(out, "node_modules");
for (const e of fs.existsSync(nm) ? fs.readdirSync(nm) : []) {
  if (/^(reference_files|storage|backups)$/.test(e)) violations.push(`node_modules/${e}`);
}
const links = [];
const findLinks = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) links.push(path.relative(out, p));
    else if (e.isDirectory()) findLinks(p);
  }
};
findLinks(out);
if (links.length) violations.push(...links.map((l) => `symlink not allowed: ${l}`));
if (violations.length) {
  console.error("REFUSING TO PACKAGE — forbidden content in app tree:\n  " + violations.join("\n  "));
  process.exit(1);
}
for (const required of ["server.js", "desktop-server-entry.cjs", "desktop-bootstrap/migrate.cjs", "desktop-bootstrap/seed.cjs", "drizzle/meta/_journal.json", ".next/static", "node_modules/pg", "node_modules/@node-rs/argon2", "node_modules/playwright-core/browsers.json", "node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2"]) {
  if (!fs.existsSync(path.join(out, required))) {
    console.error(`app tree incomplete: missing ${required}`);
    process.exit(1);
  }
}
console.log(`app tree ready: ${out} (commit ${commit})`);
