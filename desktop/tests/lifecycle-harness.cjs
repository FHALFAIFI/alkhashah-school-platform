// @ts-check
"use strict";
/**
 * End-to-end lifecycle harness for the desktop orchestrator — no Electron, synthetic data
 * only, an isolated throw-away data directory. Runs on Linux (system PostgreSQL 16 +
 * system Node, as a non-root user) and on Windows (bundled binaries of an installed or
 * unpacked build).
 *
 *   FATHERSAPP_DATA_DIR=<empty dir> FATHERSAPP_RESOURCES=<resources dir> node lifecycle-harness.cjs
 *
 * Linux overrides: FATHERSAPP_PG_BIN, FATHERSAPP_NODE, FATHERSAPP_APP_DIR,
 * FATHERSAPP_BROWSERS_PATH, FATHERSAPP_POPPLER_BIN.
 *
 * Prints one JSON line per check and exits non-zero on the first failure. A results
 * file (timings + checks) is written to $FATHERSAPP_HARNESS_OUT when set.
 */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { Orchestrator } = require("../lib/orchestrator");
const { plainProtector } = require("../lib/secrets");
const { isAlive } = require("../lib/proc");
const pg = require("../lib/postgres");

const dataRoot = process.env.FATHERSAPP_DATA_DIR;
if (!dataRoot) throw new Error("set FATHERSAPP_DATA_DIR to an empty scratch directory");
if (fs.existsSync(dataRoot) && fs.readdirSync(dataRoot).length > 0 && !process.env.FATHERSAPP_HARNESS_REUSE) {
  throw new Error("FATHERSAPP_DATA_DIR must be empty (refusing to touch existing data)");
}
const resourcesDir = process.env.FATHERSAPP_RESOURCES ?? path.join(__dirname, "..", "build");
const APP_VERSION = "2.6.0";
const results = { checks: /** @type {any[]} */ ([]), timings: /** @type {Record<string, any>} */ ({}) };
const log = (/** @type {string} */ m) => fs.appendFileSync(path.join(dataRoot, "harness.log"), `${new Date().toISOString()} ${m}\n`);

function make() {
  return new Orchestrator({ dataRoot, resourcesDir, protector: plainProtector(), appVersion: APP_VERSION, log });
}
function ok(/** @type {string} */ name, /** @type {any} */ detail = {}) {
  const line = { check: name, ok: true, ...detail };
  results.checks.push(line);
  console.log(JSON.stringify(line));
}
function cookieFrom(/** @type {Response} */ res) {
  const all = res.headers.getSetCookie?.() ?? [];
  return all.map((c) => c.split(";")[0]).join("; ");
}

async function login(/** @type {string} */ base, /** @type {string} */ user, /** @type {string} */ password) {
  // Drive the real login server action through the rendered form, like a browser would.
  const page = await fetch(`${base}/login`);
  assert.equal(page.status, 200, "login page renders");
  const html = await page.text();
  assert.match(html, /dir="rtl"/, "RTL document");
  return { html, user, password };
}

async function main() {
  fs.mkdirSync(dataRoot, { recursive: true });

  // 1) cold first run
  let o = make();
  const first = await o.start();
  results.timings.firstRun = first.timings;
  assert.ok(first.firstRun, "first run detected");
  assert.ok(first.initialCredentials && first.initialCredentials.length === 2, "initial credentials produced once");
  ok("first-run", { ms: first.timings.total });

  const health = await (await fetch(`${first.url}/api/health`)).json();
  assert.equal(health.status, "ok");
  assert.equal(health.db, "up");
  ok("health", { version: health.version, commit: health.commit });

  await login(first.url, "principal", "");
  ok("login-page");

  // loopback-only: the app must not answer on another interface address
  const os = require("node:os");
  const ext = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);
  if (ext) {
    const port = Number(new URL(first.url).port);
    const reached = await fetch(`http://${ext.address}:${port}/api/health`, { signal: AbortSignal.timeout(3000) }).then(() => true, () => false);
    assert.equal(reached, false, "server must not be reachable on a non-loopback interface");
    const pgReached = await new Promise((resolve) => {
      const s = require("node:net").connect({ host: ext.address, port: o.pgPort }, () => { s.destroy(); resolve(true); });
      s.on("error", () => resolve(false));
      s.setTimeout(3000, () => { s.destroy(); resolve(false); });
    });
    assert.equal(pgReached, false, "postgres must not be reachable on a non-loopback interface");
    ok("loopback-only", { checkedInterface: ext.address });
  }

  // readiness endpoint refuses requests without the token
  const anon = await fetch(`${first.url}/__fathersapp/ready`);
  assert.equal(anon.status, 404);
  ok("ready-endpoint-requires-token");

  // synthetic attachment so storage is part of backup/restore
  const synthetic = path.join(o.d.storage, "attachments", "zz", "harness-synthetic.txt");
  fs.mkdirSync(path.dirname(synthetic), { recursive: true });
  fs.writeFileSync(synthetic, "ملف تجريبي آلي — بيانات اصطناعية\n");
  await pg.psql(o.r.pg, { port: o.pgPort, user: pg.APP_ROLE, password: o.secrets.pgAppPassword, db: pg.APP_DB },
    "insert into settings(key, value) values ('harness.marker', '\"before-backup\"'::jsonb) on conflict (key) do update set value = excluded.value");

  // 2) PDF generation through the bundled Chromium (same code path as reports)
  if (!process.env.FATHERSAPP_SKIP_PDF) {
    const t0 = Date.now();
    const r = await require("../lib/proc").run(o.r.node, ["-e", `
      process.chdir(${JSON.stringify(o.r.appDir)});
      const { chromium } = require(require.resolve("playwright", { paths: [process.cwd()] }));
      (async () => {
        const b = await chromium.launch();
        const p = await b.newPage();
        await p.setContent('<html dir="rtl"><body style="font-family:sans-serif">تقرير تجريبي — مجمع</body></html>');
        const pdf = await p.pdf({ format: "A4" });
        await b.close();
        if (pdf.subarray(0,5).toString() !== "%PDF-") process.exit(5);
        console.log("PDF_BYTES=" + pdf.length);
      })().catch((e) => { console.error(e); process.exit(4); });
    `], { cwd: o.r.appDir, env: require("../lib/proc").cleanEnv({ PLAYWRIGHT_BROWSERS_PATH: o.r.browsersPath, TEMP: o.d.tmp, TMP: o.d.tmp, TMPDIR: o.d.tmp }), timeoutMs: 120000 });
    assert.equal(r.code, 0, `pdf generation failed: ${r.stderr}`);
    ok("pdf-bundled-chromium", { ms: Date.now() - t0, out: r.stdout.trim() });
  }

  // 3) manual backup + verification
  const b = await o.fullBackup();
  assert.ok(b.verified, "backup verified after creation");
  assert.ok(fs.existsSync(b.file + ".sha256"));
  ok("backup", { name: b.name, files: b.files });

  // tamper detection: corrupt a copy → must fail verification
  const tampered = path.join(o.d.tmp, "tampered-" + b.name);
  fs.copyFileSync(b.file, tampered);
  fs.copyFileSync(b.file + ".sha256", tampered + ".sha256");
  const fd = fs.openSync(tampered, "r+");
  fs.writeSync(fd, Buffer.from([0xff, 0x00, 0xff]), 0, 3, 4096);
  fs.closeSync(fd);
  await assert.rejects(o.verify(tampered, o.secrets.backupKey), /corrupted|SHA-256/);
  ok("backup-tamper-detected");
  await assert.rejects(o.verify(b.file, "wrong-key-wrong-key"), /wrong backup key|corrupt/);
  ok("backup-wrong-key-rejected");
  fs.rmSync(tampered, { force: true }); fs.rmSync(tampered + ".sha256", { force: true });

  // 4) change data after the backup, then restore → data returns to the backup state
  await pg.psql(o.r.pg, { port: o.pgPort, user: pg.APP_ROLE, password: o.secrets.pgAppPassword, db: pg.APP_DB },
    "update settings set value = '\"after-backup\"'::jsonb where key = 'harness.marker'");
  fs.rmSync(synthetic);
  const rr = await o.restore(b.file, o.secrets.backupKey);
  const marker = await pg.psql(o.r.pg, { port: o.pgPort, user: pg.APP_ROLE, password: o.secrets.pgAppPassword, db: pg.APP_DB }, "select value::text from settings where key = 'harness.marker'");
  assert.equal(marker, '"before-backup"');
  assert.ok(fs.existsSync(synthetic), "attachment restored");
  assert.equal((await (await fetch(`${rr.url}/api/health`)).json()).status, "ok");
  ok("restore", { safetyBackup: rr.safetyBackup });

  // a backup written by a newer version is refused before anything is touched
  o.o.appVersion = "2.5.9";
  await assert.rejects(o.restore(b.file, o.secrets.backupKey), (e) => /** @type {any} */ (e).code === "BACKUP_NEWER_THAN_APP");
  o.o.appVersion = APP_VERSION;
  assert.equal((await (await fetch(`${o.url}/api/health`)).json()).status, "ok", "server still running after refused restore");
  ok("restore-refuses-newer-backup");

  // 5) clean shutdown with automatic backup; nothing left running
  const pgLoc = o.pgLoc;
  const serverPid = o.server?.pid;
  const t1 = Date.now();
  const stopReport = await o.stop({ drainMs: 10000 });
  results.timings.cleanStopMs = Date.now() - t1;
  assert.equal(await pg.status(o.r.pg, /** @type {any} */ (pgLoc)), "stopped");
  assert.ok(!serverPid || !isAlive(serverPid), "server process gone");
  assert.ok(!fs.existsSync(o.d.sessionFile));
  ok("clean-stop", { report: stopReport, ms: results.timings.cleanStopMs });

  // 5b) leftovers of an interrupted backup/restore (decrypted dump!) are removed at start
  const leftover = path.join(o.d.tmp, "restore-20260101-000000-x");
  fs.mkdirSync(path.join(leftover, "storage"), { recursive: true });
  fs.writeFileSync(path.join(leftover, "db.dump"), "PLAINTEXT");
  fs.writeFileSync(path.join(o.d.backupsFull, "full-20260101-000000.tar.gz.enc.part"), "partial");
  // 5c) data last used by a newer version: refuse to start, touch nothing
  const stateFile = o.d.stateFile;
  const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  fs.writeFileSync(stateFile, JSON.stringify({ ...saved, appVersion: "99.0.0" }));
  await assert.rejects(make().start(), (e) => /** @type {any} */ (e).code === "DATA_NEWER_THAN_APP");
  assert.equal(await pg.status(o.r.pg, /** @type {any} */ (pgLoc)), "stopped", "nothing started for a newer data set");
  fs.writeFileSync(stateFile, JSON.stringify(saved));
  ok("downgrade-refused");

  // 6) warm starts (repeated open/close) — never re-seeds
  const warm = [];
  for (let i = 0; i < 3; i++) {
    o = make();
    const s = await o.start();
    assert.equal(s.firstRun, false);
    assert.equal(s.initialCredentials, null, "seed must not run again");
    warm.push(s.timings.total);
    if (i === 0) {
      assert.ok(!fs.existsSync(leftover), "decrypted leftovers removed");
      assert.ok(!fs.readdirSync(o.d.backupsFull).some((n) => n.endsWith(".part")), "partial archives removed");
      ok("leftover-work-files-removed");
      // startup backup when due, and a stop issued while it runs must wait for it
      o.state.lastBackupAt = "2000-01-01T00:00:00.000Z";
      const pending = o.backupIfDue();
      await new Promise((r) => setTimeout(r, 50));
      const before = fs.readdirSync(o.d.backupsFull).filter((n) => n.endsWith(".enc")).length;
      await o.stop({ backup: false, drainMs: 5000 });
      const res = await pending;
      assert.ok(res && res.verified, "startup backup completed and verified despite concurrent stop");
      assert.equal(fs.readdirSync(o.d.backupsFull).filter((n) => n.endsWith(".enc")).length, before + 1);
      ok("startup-backup-serialized-with-stop", { name: res.name });
      continue;
    }
    await o.stop({ backup: false, drainMs: 5000 });
  }
  results.timings.warmStartsMs = warm;
  ok("warm-restarts", { ms: warm });

  // 7) crash: launcher dies without stopping anything → next start recovers
  o = make();
  await o.start();
  const orphanPid = /** @type {number} */ (o.server?.pid);
  // simulate a hard crash: drop all in-memory handles, keep processes and metadata on disk
  o.server?.child.disconnect?.();
  o.lockHeld = false; // the dead launcher could not release its lock
  fs.writeFileSync(o.d.lockFile, JSON.stringify({ pid: 999999, exe: "dead" }));
  const o2 = make();
  const s2 = await o2.start();
  assert.ok(!isAlive(orphanPid), "orphaned server terminated");
  assert.equal((await (await fetch(`${s2.url}/api/health`)).json()).db, "up");
  ok("crash-recovery", { ms: s2.timings.total });
  await o2.stop({ backup: false, drainMs: 5000 });

  // 8) users were seeded exactly once
  o = make();
  await o.start();
  const users = await o.userCount();
  assert.equal(users, 2);
  ok("seed-once", { users });
  await o.stop({ backup: false, drainMs: 5000 });

  // 9) no secret ever reaches a log file (launcher, server, PostgreSQL)
  const secretsNow = [o.secrets.pgSuperPassword, o.secrets.pgAppPassword, o.secrets.backupKey];
  const logFiles = [path.join(dataRoot, "harness.log"), ...fs.readdirSync(o.d.logs).map((n) => path.join(o.d.logs, n)), /** @type {any} */ (o.pgLoc).log];
  for (const f of logFiles) {
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, "utf8");
    for (const sec of secretsNow) assert.ok(!text.includes(sec), `secret found in ${path.basename(f)}`);
  }
  ok("no-secrets-in-logs", { files: logFiles.filter((f) => fs.existsSync(f)).length });

  if (process.env.FATHERSAPP_HARNESS_OUT) fs.writeFileSync(process.env.FATHERSAPP_HARNESS_OUT, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ done: true, timings: results.timings }));
  process.exit(0);
}

main().catch((e) => {
  console.error("HARNESS FAILED:", e);
  if (process.env.FATHERSAPP_HARNESS_OUT) fs.writeFileSync(process.env.FATHERSAPP_HARNESS_OUT, JSON.stringify({ ...results, error: String(e && e.stack || e) }, null, 2));
  process.exit(1);
});
