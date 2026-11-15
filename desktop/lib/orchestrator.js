// @ts-check
"use strict";
/**
 * Start/stop state machine of the desktop edition. Independent of Electron (the UI layer
 * passes callbacks), so the whole lifecycle is exercised by the Linux harness and by the
 * Windows CI smoke tests alike.
 *
 * Start:  lock data dir → clean stale processes → secrets → PostgreSQL (init once) →
 *         app role/db (once) → pre-upgrade backup + migrations (only when the bundled
 *         migration set changed) → seed (only on an empty database, ever) → Node server →
 *         authenticated readiness.
 * Stop:   drain the server (HTTP requests + report jobs) → daily automatic backup if due →
 *         pg_ctl stop -m fast -w on our data directory → clear runtime metadata.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { dataLayout, resourceLayout, ensureDataDirs } = require("./paths");
const { pickPort } = require("./ports");
const { loadOrCreateSecrets } = require("./secrets");
const pg = require("./postgres");
const { startServer, stopServer } = require("./server");
const backup = require("./backup");
const { runChecked, cleanEnv, isAlive, commandLineOf } = require("./proc");
const { compareVersions, redactSecrets } = require("./readiness");

const DEFAULT_SETTINGS = { offsiteDir: null, autoBackupHours: 24, retention: 14, safetyRetention: 5 };

/**
 * @typedef {{ key: string, ms?: number }} Step
 * @typedef {{
 *   dataRoot: string,
 *   resourcesDir: string,
 *   protector: import("./secrets").Protector,
 *   appVersion: string,
 *   onStep?: (key: string) => void,
 *   onServerExit?: (code: number | null) => void,
 *   onDraining?: (activeJobs: number) => void,
 *   log?: (m: string) => void,
 *   ownExecutable?: string,
 *   allowDevOverrides?: boolean,
 * }} OrchestratorOptions
 */

function readJson(/** @type {string} */ file, /** @type {any} */ fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJsonAtomic(/** @type {string} */ file, /** @type {any} */ value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

class Orchestrator {
  /** @param {OrchestratorOptions} o */
  constructor(o) {
    this.o = o;
    this.d = dataLayout(o.dataRoot);
    // Packaged builds ignore the FATHERSAPP_* runtime-path overrides (development/test only),
    // so the environment cannot redirect which node.exe / PostgreSQL binaries are executed.
    this.r = resourceLayout(o.resourcesDir, { env: o.allowDevOverrides === false ? {} : process.env });
    /** @type {Promise<any> | null} */
    this.backupInFlight = null;
    this.log = o.log ?? (() => {});
    /** @type {import("./server").ServerHandle | null} */
    this.server = null;
    /** @type {import("./postgres").PgLocation | null} */
    this.pgLoc = null;
    this.pgPort = 0;
    this.pgRunning = false;
    this.stopping = false;
    this.lockHeld = false;
    /** @type {Record<string, number>} */
    this.timings = {};
    /** @type {any} */
    this.state = {};
    /** @type {any} */
    this.secrets = null;
  }

  get settings() {
    return { ...DEFAULT_SETTINGS, ...readJson(this.d.settingsFile, {}) };
  }
  /** @param {Partial<typeof DEFAULT_SETTINGS>} patch */
  updateSettings(patch) {
    writeJsonAtomic(this.d.settingsFile, { ...readJson(this.d.settingsFile, {}), ...patch });
  }
  saveState() {
    writeJsonAtomic(this.d.stateFile, this.state);
  }
  get url() {
    return this.server ? `http://127.0.0.1:${this.server.port}` : null;
  }

  /** @param {string} key @param {() => Promise<any>} fn */
  async step(key, fn) {
    this.o.onStep?.(key);
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      this.timings[key] = Date.now() - t0;
      this.log(`step ${key}: ${this.timings[key]} ms`);
    }
  }

  // ————— locking & stale state —————

  async acquireLock() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = fs.openSync(this.d.lockFile, "wx", 0o600);
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, exe: process.execPath, at: new Date().toISOString() }));
        fs.closeSync(fd);
        this.lockHeld = true;
        return;
      } catch (e) {
        if (/** @type {NodeJS.ErrnoException} */ (e).code !== "EEXIST") throw e;
        const held = readJson(this.d.lockFile, {});
        if (held.pid && held.pid !== process.pid && isAlive(held.pid)) {
          const cmd = await commandLineOf(held.pid);
          const exe = this.o.ownExecutable ?? process.execPath;
          if (cmd && cmd.toLowerCase().includes(path.basename(exe).toLowerCase())) {
            throw Object.assign(new Error("another launcher instance owns this data directory"), { code: "ALREADY_RUNNING" });
          }
        }
        this.log(`removing stale launcher lock (pid ${held.pid ?? "?"})`);
        fs.rmSync(this.d.lockFile, { force: true });
      }
    }
    throw new Error("could not acquire data directory lock");
  }

  releaseLock() {
    if (!this.lockHeld) return;
    const held = readJson(this.d.lockFile, {});
    if (held.pid === process.pid) fs.rmSync(this.d.lockFile, { force: true });
    this.lockHeld = false;
  }

  /**
   * After a crash, power loss or killed launcher: terminate a leftover server process only
   * when its command line proves it is our server entry, and stop our own cluster.
   */
  async cleanupStale() {
    const sess = readJson(this.d.sessionFile, null);
    if (sess?.serverPid && isAlive(sess.serverPid)) {
      const cmd = await commandLineOf(sess.serverPid);
      if (cmd && cmd.includes(path.basename(this.r.serverEntry)) && cmd.includes(sess.serverEntryMarker ?? "desktop-server-entry")) {
        this.log(`terminating orphaned server pid ${sess.serverPid}`);
        try { process.kill(sess.serverPid); } catch { /* gone */ }
        for (let i = 0; i < 50 && isAlive(sess.serverPid); i++) await new Promise((r) => setTimeout(r, 200));
      } else {
        this.log(`stale server pid ${sess.serverPid} is not ours — left untouched`);
      }
    }
    if (this.pgLoc && pg.clusterExists(this.pgLoc) && (await pg.status(this.r.pg, this.pgLoc)) === "running") {
      this.log("stopping leftover PostgreSQL of this data directory");
      await pg.stop(this.r.pg, this.pgLoc, { timeoutSec: 60 });
    }
    fs.rmSync(this.d.sessionFile, { force: true });
  }

  /**
   * Work files of an interrupted backup/verify/restore can hold DECRYPTED school data (the
   * database dump and attachments). They are removed at every start, before anything else
   * runs, together with partial encrypted archives (*.part). Only our own tmp folder and our
   * own backup folders are touched.
   */
  cleanupWorkFiles() {
    let removed = 0;
    if (fs.existsSync(this.d.tmp)) {
      for (const n of fs.readdirSync(this.d.tmp)) {
        fs.rmSync(path.join(this.d.tmp, n), { recursive: true, force: true });
        removed++;
      }
    }
    for (const dir of [this.d.backupsFull, this.d.backupsSafety]) {
      if (!fs.existsSync(dir)) continue;
      for (const n of fs.readdirSync(dir)) {
        if (n.endsWith(".part")) { fs.rmSync(path.join(dir, n), { force: true }); removed++; }
      }
    }
    if (removed) this.log(`removed ${removed} leftover work file(s) from an interrupted operation`);
    return removed;
  }

  // ————— start —————

  migrationsHash() {
    return crypto.createHash("sha256").update(fs.readFileSync(this.r.migrationJournal)).digest("hex");
  }

  buildInfo() {
    return readJson(path.join(this.r.appDir, "desktop-build.json"), {});
  }

  /** @param {Record<string,string>} extra */
  appEnv(extra = {}) {
    const info = this.buildInfo();
    return {
      NODE_ENV: "production",
      MADRASA_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: pg.appDatabaseUrl(this.pgPort, this.secrets.pgAppPassword),
      STORAGE_DIR: this.d.storage,
      BACKUP_DIR: this.d.backups,
      PLAYWRIGHT_BROWSERS_PATH: this.r.browsersPath,
      POPPLER_BIN_DIR: this.r.popplerBin,
      TEMP: this.d.tmp,
      TMP: this.d.tmp,
      TMPDIR: this.d.tmp,
      RELEASE_COMMIT: info.commit ?? "unknown",
      APP_VERSION: this.o.appVersion,
      FATHERSAPP_DESKTOP: "1",
      ...extra,
    };
  }

  /** @param {string} script */
  async runNodeScript(script) {
    await runChecked(this.r.node, [script], {
      cwd: this.r.appDir,
      env: cleanEnv(this.appEnv()),
      timeoutMs: 15 * 60_000,
    });
  }

  async start() {
    const t0 = Date.now();
    this.timings = {};
    ensureDataDirs(this.d);
    await this.step("lock", () => this.acquireLock());
    try {
      this.state = readJson(this.d.stateFile, {});
      await this.step("workFiles", async () => this.cleanupWorkFiles());
      // Data written by a newer version must never be opened by older code (downgrade).
      if (compareVersions(this.state.appVersion, this.o.appVersion) === 1) {
        throw Object.assign(new Error(`data was last used by version ${this.state.appVersion}, this is ${this.o.appVersion}`), { code: "DATA_NEWER_THAN_APP", dataVersion: this.state.appVersion });
      }
      const { secrets, created } = loadOrCreateSecrets(this.d.secretsFile, this.o.protector);
      this.secrets = secrets;
      if (created) this.log("generated installation secrets");

      const root = await pg.resolvePgRoot(this.d.pgRoot, { recorded: this.state.pgRoot, log: this.log });
      if (this.state.pgRoot !== root) { this.state.pgRoot = root; this.saveState(); }
      this.pgLoc = pg.pgLocation(root);

      await this.step("cleanup", () => this.cleanupStale());

      const firstRun = !pg.clusterExists(this.pgLoc);
      if (firstRun) {
        await this.step("initdb", () => pg.initCluster(this.r.pg, /** @type {any} */ (this.pgLoc), secrets.pgSuperPassword, this.d.tmp));
        this.state.clusterCreatedAt = new Date().toISOString();
        this.state.bootstrapped = false;
        this.state.dbReady = false;
        this.saveState();
      }

      await this.step("postgres", () => this.startPostgres());

      if (!this.state.dbReady) {
        await this.step("database", () => pg.ensureAppDatabase(this.r.pg, this.pgPort, secrets));
        this.state.dbReady = true;
        this.saveState();
      }

      const mh = this.migrationsHash();
      if (this.state.migrationsHash !== mh) {
        const hasData = await this.userCount().catch(() => 0);
        if (this.state.bootstrapped && hasData > 0) {
          await this.step("preUpgradeBackup", () => this.safetyBackup("pre-upgrade"));
        }
        await this.step("migrate", () => this.runNodeScript(this.r.migrateScript));
        this.state.migrationsHash = mh;
        this.saveState();
      }

      /** @type {string[] | null} */
      let initialCredentials = null;
      if (!this.state.bootstrapped) {
        // The reference seed runs only against a database with no user accounts — never
        // over existing (e.g. restored) school data, even if local state was lost.
        if ((await this.userCount()) === 0) {
          await this.step("seed", () => this.runNodeScript(this.r.seedScript));
          initialCredentials = this.readInitialCredentials();
        }
        this.state.bootstrapped = true;
        this.state.bootstrappedAt = new Date().toISOString();
        this.saveState();
      }

      await this.step("server", () => this.startAppServer());
      if (compareVersions(this.o.appVersion, this.state.appVersion) !== -1 || this.state.appVersion === undefined) {
        if (this.state.appVersion !== this.o.appVersion) { this.state.appVersion = this.o.appVersion; this.saveState(); }
      }
      writeJsonAtomic(this.d.sessionFile, {
        launcherPid: process.pid,
        serverPid: this.server?.pid,
        serverEntryMarker: "desktop-server-entry",
        pgPort: this.pgPort,
        appPort: this.server?.port,
        startedAt: new Date().toISOString(),
      });
      this.timings.total = Date.now() - t0;
      this.log(`ready in ${this.timings.total} ms (firstRun=${firstRun})`);
      return { url: /** @type {string} */ (this.url), firstRun, initialCredentials, timings: { ...this.timings } };
    } catch (e) {
      this.log(`start failed: ${redactSecrets(e instanceof Error ? String(e.stack) : String(e), this.secretValues())}`);
      await this.stop({ backup: false, drainMs: 2000 }).catch(() => {});
      throw e;
    }
  }

  async startPostgres() {
    const loc = /** @type {import("./postgres").PgLocation} */ (this.pgLoc);
    /** @type {unknown} */
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      const port = await pickPort(attempt === 0 ? this.state.pgPort : undefined);
      try {
        await pg.start(this.r.pg, loc, port);
        this.pgPort = port;
        this.pgRunning = true;
        if (this.state.pgPort !== port) { this.state.pgPort = port; this.saveState(); }
        return;
      } catch (e) {
        lastErr = e;
        this.log(`postgres start on ${port} failed (attempt ${attempt + 1}): ${e instanceof Error ? e.message : e}`);
        if ((await pg.status(this.r.pg, loc)) === "running") await pg.stop(this.r.pg, loc);
      }
    }
    throw lastErr;
  }

  async startAppServer() {
    /** @type {unknown} */
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      const port = await pickPort(attempt === 0 ? this.state.appPort : undefined, new Set([this.pgPort]));
      try {
        this.server = await startServer({
          nodeExe: this.r.node,
          entry: this.r.serverEntry,
          cwd: this.r.appDir,
          port,
          env: this.appEnv({ APP_URL: `http://127.0.0.1:${port}` }),
          logFile: path.join(this.d.logs, "server.log"),
          onMessage: (m) => { if (m?.type === "draining") this.o.onDraining?.(m.activeJobs); },
        });
        if (this.state.appPort !== port) { this.state.appPort = port; this.saveState(); }
        const h = this.server;
        h.exited.then((code) => {
          if (this.server === h) this.server = null;
          if (!this.stopping) {
            this.log(`server exited unexpectedly (code ${code})`);
            this.o.onServerExit?.(code);
          }
        });
        return;
      } catch (e) {
        lastErr = e;
        this.log(`server start on ${port} failed (attempt ${attempt + 1}): ${e instanceof Error ? e.message : e}`);
      }
    }
    throw lastErr;
  }

  async restartServer() {
    if (this.server) await stopServer(this.server, { drainMs: 5000 });
    this.server = null;
    await this.startAppServer();
    return this.url;
  }

  async userCount() {
    const out = await pg.psql(this.r.pg, { port: this.pgPort, user: pg.APP_ROLE, password: this.secrets.pgAppPassword, db: pg.APP_DB }, "select count(*) from users");
    return Number(out) || 0;
  }

  secretValues() {
    return this.secrets ? [this.secrets.pgSuperPassword, this.secrets.pgAppPassword, this.secrets.backupKey] : [];
  }

  readInitialCredentials() {
    const f = path.join(this.d.storage, "private", "initial-credentials.txt");
    try { return fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean); } catch { return null; }
  }

  // ————— backups —————

  backupContext() {
    return {
      tools: this.r.pg,
      port: this.pgPort,
      secrets: this.secrets,
      storageDir: this.d.storage,
      tmpDir: this.d.tmp,
      appVersion: this.o.appVersion,
      packageJson: path.join(this.r.appDir, "package.json"),
      migrationsHash: this.state.migrationsHash ?? null,
      dataRoot: this.d.root,
    };
  }

  /** Local safety copy before risky operations (upgrade, restore). Never copied off-device. */
  async safetyBackup(/** @type {string} */ label) {
    return backup.createBackup(this.backupContext(), { outDir: this.d.backupsSafety, label, retention: this.settings.safetyRetention, log: this.log });
  }

  /**
   * User-visible full backup (manual or automatic), with retention and off-device copy.
   * Serialized: a second request waits for the one in flight instead of racing it.
   */
  async fullBackup() {
    if (this.backupInFlight) return this.backupInFlight;
    this.backupInFlight = (async () => {
      if (!this.pgRunning) throw new Error("database is not running");
      const s = this.settings;
      try {
        const res = await backup.createBackup(this.backupContext(), { outDir: this.d.backupsFull, retention: s.retention, offsiteDir: s.offsiteDir, log: this.log });
        this.state.lastBackupAt = new Date().toISOString();
        this.state.lastBackupFile = res.name;
        delete this.state.lastBackupError;
        if (s.offsiteDir) {
          if (res.offsite?.ok) { this.state.lastOffsiteOkAt = this.state.lastBackupAt; delete this.state.lastOffsiteError; }
          else this.state.lastOffsiteError = res.offsite?.reason ?? "offsite-error";
        }
        this.saveState();
        return res;
      } catch (e) {
        this.state.lastBackupError = redactSecrets(e instanceof Error ? e.message : String(e), this.secretValues()).slice(0, 500);
        this.saveState();
        throw e;
      }
    })();
    try { return await this.backupInFlight; } finally { this.backupInFlight = null; }
  }

  /**
   * Daily automatic backup at startup as well as at close — so a laptop that is always shut
   * down with the app open still gets backups. Never throws (failure is recorded in state).
   */
  async backupIfDue() {
    if (!this.pgRunning || !this.state.bootstrapped || !this.backupDue()) return null;
    try { return await this.fullBackup(); } catch (e) { this.log(`automatic backup failed: ${e instanceof Error ? e.message : e}`); return null; }
  }

  backupDue() {
    const hours = Number(this.settings.autoBackupHours);
    if (!hours || hours <= 0) return false;
    const last = this.state.lastBackupAt ? Date.parse(this.state.lastBackupAt) : 0;
    return Date.now() - last >= hours * 3600_000;
  }

  /** @param {string} file @param {string} key */
  async verify(file, key) {
    return backup.verifyBackup(file, key, { tools: this.r.pg, tmpDir: this.d.tmp });
  }

  /**
   * Restore: verify → safety backup of current data → stop server → restore into staging
   * DB and swap → migrate (if the backup is older) → start server. Any failure before the
   * swap restarts the server on untouched current data.
   * @param {string} file @param {string} key
   */
  async restore(file, key) {
    const info = await this.verify(file, key);
    if (compareVersions(info.backupVersion, this.o.appVersion) === 1) {
      throw Object.assign(new Error(`backup was made by a newer version (${info.backupVersion})`), { code: "BACKUP_NEWER_THAN_APP", backupVersion: info.backupVersion });
    }
    const safety = await this.safetyBackup("pre-restore");
    if (this.server) {
      this.stopping = true;
      try { await stopServer(this.server, { drainMs: 30_000 }); } finally { this.stopping = false; }
      this.server = null;
    }
    let result;
    try {
      result = await backup.restoreBackup(this.backupContext(), file, key, { log: this.log });
    } catch (e) {
      this.log(`restore failed, restarting on current data: ${e instanceof Error ? e.message : e}`);
      await this.startAppServer();
      throw e;
    }
    this.state.migrationsHash = null;
    this.state.bootstrapped = true;
    this.state.restoredAt = new Date().toISOString();
    this.saveState();
    try {
      await this.runNodeScript(this.r.migrateScript);
      this.state.migrationsHash = this.migrationsHash();
      this.saveState();
      await this.startAppServer();
    } catch (e) {
      // The restored data IS in place now; the previous data is in the safety backup and in
      // the kept previous database/storage. Say exactly that — never "nothing changed".
      throw Object.assign(new Error(`restore applied but the application could not start: ${e instanceof Error ? e.message : e}`), { code: "RESTORE_APPLIED_START_FAILED", safetyBackup: safety.name, cause: e });
    }
    return { ...result, safetyBackup: safety.name, url: this.url };
  }

  // ————— stop —————

  /**
   * @param {{ backup?: boolean, drainMs?: number }} [o]
   */
  async stop(o = {}) {
    if (this.stopping) return { already: true };
    this.stopping = true;
    /** @type {Record<string, any>} */
    const report = {};
    try {
      if (this.server) {
        this.o.onStep?.("stopServer");
        report.server = await stopServer(this.server, { drainMs: o.drainMs ?? 120_000 });
        this.server = null;
      }
      if (this.backupInFlight) {
        // never stop PostgreSQL underneath a running pg_dump
        this.o.onStep?.("autoBackup");
        await this.backupInFlight.catch(() => {});
      }
      if (o.backup !== false && this.pgRunning && this.state.bootstrapped && this.backupDue()) {
        this.o.onStep?.("autoBackup");
        try {
          const b = await this.fullBackup();
          report.backup = b.name;
        } catch (e) {
          report.backupError = this.state.lastBackupError ?? (e instanceof Error ? e.message : String(e));
          this.log(`automatic backup failed: ${report.backupError}`);
        }
      }
      if (this.pgLoc && pg.clusterExists(this.pgLoc)) {
        this.o.onStep?.("stopPostgres");
        report.postgres = await pg.stop(this.r.pg, this.pgLoc, { timeoutSec: 60 });
        this.pgRunning = false;
      }
      fs.rmSync(this.d.sessionFile, { force: true });
    } finally {
      this.releaseLock();
      this.stopping = false;
    }
    this.log(`stopped: ${JSON.stringify(report)}`);
    return report;
  }

  /**
   * Windows is ending the session (shutdown/restart/log-off): only seconds remain and the
   * event loop may not run again. Ask the server to exit and stop PostgreSQL synchronously.
   * If the OS still kills us mid-way, PostgreSQL recovers from WAL on the next start.
   */
  emergencyStopSync() {
    this.stopping = true;
    try {
      if (this.server && this.server.child.exitCode === null) {
        try { this.server.child.send({ type: "shutdown", token: this.server.token, drainMs: 2000 }); } catch { /* ignore */ }
      }
      if (this.pgLoc && this.pgRunning) pg.stopSync(this.r.pg, this.pgLoc, 15);
      this.pgRunning = false;
      fs.rmSync(this.d.sessionFile, { force: true });
    } finally {
      this.releaseLock();
    }
  }
}

module.exports = { Orchestrator, DEFAULT_SETTINGS };
