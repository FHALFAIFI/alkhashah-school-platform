// @ts-check
"use strict";
/**
 * Filesystem layout of the desktop edition.
 *
 * Two strictly separated trees:
 *  - resources (installed, read-only): the packaged app, Node runtime, PostgreSQL,
 *    Chromium and Poppler. Under "C:\Program Files\..." for a per-machine install.
 *  - data (per Windows user, writable): %LOCALAPPDATA%\FathersApp — database cluster,
 *    attachments, backups, logs, secrets, runtime metadata.
 *
 * Nothing in the resources tree is ever written at runtime.
 */
const path = require("node:path");
const fs = require("node:fs");

const APP_DIR_NAME = "FathersApp";

/**
 * @param {{ platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, homedir?: string }} [o]
 * @returns {string}
 */
function defaultDataRoot(o = {}) {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  if (env.FATHERSAPP_DATA_DIR) return path.resolve(env.FATHERSAPP_DATA_DIR);
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    if (!local) throw new Error("LOCALAPPDATA is not set");
    return path.win32.join(local, APP_DIR_NAME);
  }
  const home = o.homedir ?? require("node:os").homedir();
  return path.join(env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), APP_DIR_NAME);
}

/**
 * @param {string} root
 */
function dataLayout(root) {
  return {
    root,
    // PostgreSQL root (cluster in ./data, server log in ./postgres.log). May be relocated
    // to an ASCII-only path on Windows — see postgres.resolvePgRoot().
    pgRoot: path.join(root, "postgres"),
    storage: path.join(root, "storage"),
    backups: path.join(root, "backups"),
    // full encrypted backups land in backups/weekly so the in-app pilot-status card and the
    // Mac/Linux restore.sh recognise them unchanged (same naming and archive layout).
    backupsFull: path.join(root, "backups", "weekly"),
    backupsSafety: path.join(root, "backups", "safety"),
    logs: path.join(root, "logs"),
    run: path.join(root, "run"),
    config: path.join(root, "config"),
    tmp: path.join(root, "tmp"),
    sessionFile: path.join(root, "run", "session.json"),
    lockFile: path.join(root, "run", "launcher.lock"),
    stateFile: path.join(root, "config", "state.json"),
    settingsFile: path.join(root, "config", "settings.json"),
    secretsFile: path.join(root, "config", "secrets.bin"),
  };
}

/**
 * Locates bundled runtimes. In the packaged app `resourcesDir` is Electron's
 * process.resourcesPath. Every entry can be overridden by an env var for development
 * and for the Linux test harness (system PostgreSQL 16 + system Node).
 *
 * @param {string} resourcesDir
 * @param {{ platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv }} [o]
 */
function resourceLayout(resourcesDir, o = {}) {
  const env = o.env ?? process.env;
  const win = (o.platform ?? process.platform) === "win32";
  const exe = (/** @type {string} */ n) => (win ? `${n}.exe` : n);
  // "server", never "app": Electron loads <resources>/app ahead of app.asar.
  const appDir = env.FATHERSAPP_APP_DIR ?? path.join(resourcesDir, "server");
  const pgBin = env.FATHERSAPP_PG_BIN ?? path.join(resourcesDir, "pgsql", "bin");
  return {
    resourcesDir,
    appDir,
    serverEntry: path.join(appDir, "desktop-server-entry.cjs"),
    migrateScript: path.join(appDir, "desktop-bootstrap", "migrate.cjs"),
    seedScript: path.join(appDir, "desktop-bootstrap", "seed.cjs"),
    migrationJournal: path.join(appDir, "drizzle", "meta", "_journal.json"),
    node: env.FATHERSAPP_NODE ?? path.join(resourcesDir, "node", exe("node")),
    pgBin,
    pg: {
      initdb: path.join(pgBin, exe("initdb")),
      pgCtl: path.join(pgBin, exe("pg_ctl")),
      psql: path.join(pgBin, exe("psql")),
      pgDump: path.join(pgBin, exe("pg_dump")),
      pgRestore: path.join(pgBin, exe("pg_restore")),
    },
    browsersPath: env.FATHERSAPP_BROWSERS_PATH ?? path.join(resourcesDir, "chromium"),
    popplerBin: env.FATHERSAPP_POPPLER_BIN ?? path.join(resourcesDir, "poppler", "bin"),
  };
}

/** @param {ReturnType<typeof dataLayout>} d */
function ensureDataDirs(d) {
  for (const p of [d.root, d.storage, d.backups, d.backupsFull, d.backupsSafety, d.logs, d.run, d.config, d.tmp]) {
    fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  }
}

/** True when a path contains characters outside printable ASCII. */
function hasNonAscii(/** @type {string} */ p) {
  return /[^\x20-\x7e]/.test(p);
}

module.exports = { APP_DIR_NAME, defaultDataRoot, dataLayout, resourceLayout, ensureDataDirs, hasNonAscii };
