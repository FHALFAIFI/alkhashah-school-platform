// @ts-check
"use strict";
/**
 * The private PostgreSQL 16 cluster owned by this Windows user.
 *
 * Security posture:
 *  - listens on 127.0.0.1 only, no Unix socket, pg_hba allows only 127.0.0.1/32 with
 *    scram-sha-256 — there is no path for another machine to reach it;
 *  - superuser password and app-role password are random per installation (secrets.js);
 *  - the application connects as a non-superuser role that owns only its database.
 *
 * Lifecycle is always driven through pg_ctl against *our* data directory, so a stop can
 * only ever affect this cluster — never a separately installed PostgreSQL service.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { run, runChecked, cleanEnv } = require("./proc");
const { hasNonAscii } = require("./paths");

const SUPERUSER = "postgres";
const APP_ROLE = "madrasa";
const APP_DB = "madrasa";
const CONF_INCLUDE = "fathersapp.conf";

/**
 * @typedef {{ initdb: string, pgCtl: string, psql: string, pgDump: string, pgRestore: string }} PgTools
 * @typedef {{ root: string, data: string, log: string }} PgLocation
 */

/** @param {string} root @returns {PgLocation} */
function pgLocation(root) {
  return { root, data: path.join(root, "data"), log: path.join(root, "postgres.log") };
}

/**
 * Chooses where the cluster lives. PostgreSQL on Windows mishandles data-directory paths
 * that are not representable in the ANSI code page (e.g. an Arabic Windows user name on
 * an English-locale system), so a non-ASCII %LOCALAPPDATA% path is replaced by its 8.3
 * short form, or as a last resort by a per-user folder under %ProgramData% whose ACL is
 * reset to this user + SYSTEM + Administrators. The choice is recorded in state and never
 * changes once a cluster exists.
 *
 * @param {string} preferred
 * @param {{ recorded?: string, log?: (m: string) => void }} [o]
 * @returns {Promise<string>}
 */
async function resolvePgRoot(preferred, o = {}) {
  if (o.recorded) return o.recorded;
  if (process.platform !== "win32" || !hasNonAscii(preferred)) return preferred;
  const parent = path.dirname(preferred);
  fs.mkdirSync(parent, { recursive: true });
  const ps = powershellPath();
  const quoted = parent.replace(/'/g, "''");
  const r = await run(ps, ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding=[Text.Encoding]::UTF8; (New-Object -ComObject Scripting.FileSystemObject).GetFolder('${quoted}').ShortPath`], { timeoutMs: 20000, env: cleanEnv({}) });
  const short = r.stdout.trim();
  if (r.code === 0 && short && !hasNonAscii(short)) {
    o.log?.("pg root: using 8.3 short path for non-ASCII profile path");
    return path.join(short, path.basename(preferred));
  }
  const programData = process.env.ProgramData ?? "C:\\ProgramData";
  const id = crypto.createHash("sha256").update(preferred.toLowerCase()).digest("hex").slice(0, 16);
  const fallback = path.join(programData, "FathersApp", `pg-${id}`);
  fs.mkdirSync(fallback, { recursive: true });
  await lockDownAclWin(fallback);
  o.log?.("pg root: profile path not ASCII-representable and no 8.3 name; using per-user ProgramData folder");
  return fallback;
}

function powershellPath() {
  const sys = process.env.SystemRoot ?? "C:\\Windows";
  return `${sys}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

/** Restricts a directory to the current user, SYSTEM and Administrators (no inheritance). */
async function lockDownAclWin(/** @type {string} */ dir) {
  const ps = powershellPath();
  const sidR = await runChecked(ps, ["-NoProfile", "-NonInteractive", "-Command", "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], { timeoutMs: 20000, env: cleanEnv({}) });
  const sid = sidR.stdout.trim();
  if (!/^S-1-[0-9-]+$/.test(sid)) throw new Error("could not determine current user SID");
  const sys = process.env.SystemRoot ?? "C:\\Windows";
  await runChecked(`${sys}\\System32\\icacls.exe`, [dir, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"], { timeoutMs: 30000, env: cleanEnv({}) });
}

/** @param {PgLocation} loc */
function clusterExists(loc) {
  return fs.existsSync(path.join(loc.data, "PG_VERSION"));
}

/**
 * Creates the cluster atomically: initdb writes into a temporary sibling directory that
 * is renamed into place only after initdb and our configuration fully succeed. An
 * interrupted first run therefore never leaves a half-initialised "data" directory.
 *
 * @param {PgTools} tools
 * @param {PgLocation} loc
 * @param {string} superPassword
 * @param {string} tmpDir
 */
async function initCluster(tools, loc, superPassword, tmpDir) {
  if (clusterExists(loc)) throw new Error("cluster already exists");
  fs.mkdirSync(loc.root, { recursive: true, mode: 0o700 });
  const staging = path.join(loc.root, `data.init-${process.pid}-${Date.now()}`);
  // A non-empty "data" without PG_VERSION is never deleted: it is moved aside for inspection.
  if (fs.existsSync(loc.data) && fs.readdirSync(loc.data).length > 0) {
    fs.renameSync(loc.data, path.join(loc.root, `data.incomplete-${Date.now()}`));
  } else if (fs.existsSync(loc.data)) {
    fs.rmdirSync(loc.data);
  }
  // stale staging dirs from an interrupted initdb contain no user data and are safe to remove
  for (const n of fs.readdirSync(loc.root)) {
    if (n.startsWith("data.init-")) fs.rmSync(path.join(loc.root, n), { recursive: true, force: true });
  }
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const pwfile = path.join(tmpDir, `pw-${crypto.randomBytes(6).toString("hex")}`);
  fs.writeFileSync(pwfile, superPassword + "\n", { mode: 0o600 });
  try {
    await runChecked(tools.initdb, [
      "-D", staging,
      "-U", SUPERUSER,
      `--pwfile=${pwfile}`,
      "--auth-local=scram-sha-256",
      "--auth-host=scram-sha-256",
      "--encoding=UTF8",
      "--locale=C",
      "--no-instructions",
    ], { env: cleanEnv({ LC_ALL: "C" }), timeoutMs: 300000 });
  } finally {
    fs.rmSync(pwfile, { force: true });
  }
  writeStaticConfig(staging);
  fs.renameSync(staging, loc.data);
}

/** @param {string} dataDir */
function writeStaticConfig(dataDir) {
  const confPath = path.join(dataDir, "postgresql.conf");
  const conf = fs.readFileSync(confPath, "utf8");
  if (!conf.includes(`include_if_exists = '${CONF_INCLUDE}'`)) {
    fs.appendFileSync(confPath, `\n# Father's App desktop edition — runtime settings\ninclude_if_exists = '${CONF_INCLUDE}'\n`);
  }
  fs.writeFileSync(
    path.join(dataDir, "pg_hba.conf"),
    [
      "# Father's App desktop edition: loopback TCP only, password (SCRAM) required.",
      "# TYPE  DATABASE  USER  ADDRESS        METHOD",
      "host    all       all   127.0.0.1/32   scram-sha-256",
      "",
    ].join("\n"),
  );
}

/**
 * Rewritten before every start (the port can change between launches).
 * @param {string} dataDir
 * @param {number} port
 */
function writeRuntimeConfig(dataDir, port) {
  fs.writeFileSync(
    path.join(dataDir, CONF_INCLUDE),
    [
      "# Managed by Father's App on every start — do not edit.",
      "listen_addresses = '127.0.0.1'",
      `port = ${port}`,
      "unix_socket_directories = ''",
      "password_encryption = 'scram-sha-256'",
      "max_connections = 40",
      "timezone = 'UTC'",
      "log_timezone = 'UTC'",
      "lc_messages = 'C'",
      "logging_collector = off",
      "log_min_messages = warning",
      "log_line_prefix = '%m [%p] '",
      "fsync = on",
      "synchronous_commit = on",
      "full_page_writes = on",
      "",
    ].join("\n"),
  );
}

/**
 * pg_ctl status: 0 running, 3 not running, 4 no/invalid data directory.
 * @param {PgTools} tools @param {PgLocation} loc
 */
async function status(tools, loc) {
  const r = await run(tools.pgCtl, ["status", "-D", loc.data], { env: cleanEnv({}), timeoutMs: 30000 });
  return r.code === 0 ? "running" : r.code === 3 ? "stopped" : "invalid";
}

/** Truncates the server log when it grows past ~5 MB (keeps one previous copy). */
function rotateLog(/** @type {string} */ file) {
  try {
    if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, file + ".1");
  } catch { /* missing is fine */ }
}

/**
 * @param {PgTools} tools @param {PgLocation} loc @param {number} port
 */
async function start(tools, loc, port) {
  writeRuntimeConfig(loc.data, port);
  rotateLog(loc.log);
  // -w waits until the server accepts connections; crash recovery after an unclean
  // shutdown (power loss, killed process) happens inside this wait.
  await runChecked(tools.pgCtl, ["start", "-D", loc.data, "-l", loc.log, "-w", "-t", "300", "-s"], { env: cleanEnv({ LC_ALL: "C" }), timeoutMs: 330000 });
}

/**
 * Stops only our cluster. "fast" rolls back open transactions and checkpoints cleanly;
 * if that does not finish in time, "immediate" is used — still safe (WAL replay on the
 * next start), and still scoped to this data directory only.
 *
 * @param {PgTools} tools @param {PgLocation} loc @param {{ timeoutSec?: number }} [o]
 */
async function stop(tools, loc, o = {}) {
  const t = String(o.timeoutSec ?? 60);
  const r = await run(tools.pgCtl, ["stop", "-D", loc.data, "-m", "fast", "-w", "-t", t, "-s"], { env: cleanEnv({}), timeoutMs: (Number(t) + 15) * 1000 });
  if (r.code === 0) return "fast";
  if ((await status(tools, loc)) !== "running") return "already-stopped";
  await run(tools.pgCtl, ["stop", "-D", loc.data, "-m", "immediate", "-w", "-t", "30", "-s"], { env: cleanEnv({}), timeoutMs: 45000 });
  return "immediate";
}

/**
 * Synchronous variant for OS shutdown/logoff, where the event loop may not get another turn.
 * @param {PgTools} tools @param {PgLocation} loc @param {number} timeoutSec
 */
function stopSync(tools, loc, timeoutSec) {
  const { spawnSync } = require("node:child_process");
  spawnSync(tools.pgCtl, ["stop", "-D", loc.data, "-m", "fast", "-w", "-t", String(timeoutSec), "-s"], { env: cleanEnv({}), windowsHide: true, timeout: (timeoutSec + 5) * 1000 });
}

/**
 * @param {PgTools} tools
 * @param {{ port: number, user: string, password: string, db: string }} c
 * @param {string} sql
 */
async function psql(tools, c, sql) {
  const r = await runChecked(tools.psql, ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(c.port), "-U", c.user, "-d", c.db, "-c", sql], {
    env: cleanEnv({ PGPASSWORD: c.password, PGCONNECT_TIMEOUT: "15", PGCLIENTENCODING: "UTF8" }),
    timeoutMs: 120000,
  });
  return r.stdout.trim();
}

/** Literal quoting for the generated random secrets (base64url — defensive anyway). */
function lit(/** @type {string} */ s) {
  return "'" + s.replace(/'/g, "''") + "'";
}

/**
 * Idempotently creates the application role and database (owned by that role).
 * @param {PgTools} tools @param {number} port @param {{ pgSuperPassword: string, pgAppPassword: string }} s
 */
async function ensureAppDatabase(tools, port, s) {
  const su = { port, user: SUPERUSER, password: s.pgSuperPassword, db: "postgres" };
  const hasRole = await psql(tools, su, `select 1 from pg_roles where rolname = ${lit(APP_ROLE)}`);
  if (hasRole !== "1") {
    await psql(tools, su, `create role ${APP_ROLE} login nosuperuser nocreatedb nocreaterole password ${lit(s.pgAppPassword)}`);
  } else {
    await psql(tools, su, `alter role ${APP_ROLE} login password ${lit(s.pgAppPassword)}`);
  }
  const hasDb = await psql(tools, su, `select 1 from pg_database where datname = ${lit(APP_DB)}`);
  if (hasDb !== "1") {
    await psql(tools, su, `create database ${APP_DB} owner ${APP_ROLE} encoding 'UTF8' template template0`);
  }
  await psql(tools, su, `revoke all on database ${APP_DB} from public`);
  await psql(tools, { ...su, db: APP_DB }, `revoke create on schema public from public; alter schema public owner to ${APP_ROLE}`);
}

/** @param {number} port @param {string} password */
function appDatabaseUrl(port, password) {
  return `postgresql://${APP_ROLE}:${encodeURIComponent(password)}@127.0.0.1:${port}/${APP_DB}`;
}

module.exports = {
  SUPERUSER, APP_ROLE, APP_DB,
  pgLocation, resolvePgRoot, clusterExists, initCluster, writeRuntimeConfig, status, start, stop, stopSync,
  psql, ensureAppDatabase, appDatabaseUrl, lit,
};
