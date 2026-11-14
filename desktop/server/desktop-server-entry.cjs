// @ts-check
"use strict";
/**
 * Entry point of the Next.js standalone server in the Windows desktop edition. Runs on
 * the bundled Node runtime as a child of the Electron launcher, connected by an IPC pipe.
 *
 * Responsibilities (the application code itself is untouched):
 *  1. Bind to 127.0.0.1 only, whatever HOSTNAME the environment carries.
 *  2. Authenticated readiness: answer GET /__fathersapp/ready only when the request carries
 *     the per-launch token the launcher generated; tell the launcher over IPC once the app
 *     health check (incl. database) passes. The launcher re-verifies over HTTP with the token,
 *     which proves the listener on that port is this very process.
 *  3. Graceful shutdown on IPC request or parent death: stop taking requests, let in-flight
 *     requests finish, drain background report jobs (bounded), mark any job that cannot
 *     finish as failed with a clear Arabic reason, then exit.
 */
const http = require("node:http");
const crypto = require("node:crypto");
const path = require("node:path");

const READY_PATH = "/__fathersapp/ready";
const token = process.env.FATHERSAPP_READY_TOKEN ?? "";
delete process.env.FATHERSAPP_READY_TOKEN; // never visible to application code
process.env.HOSTNAME = "127.0.0.1";
const port = Number(process.env.PORT);

// Must equal the constants in src/lib/reports/instances/jobs.ts (pinned by a unit test).
const JOB_PENDING = "قيد الانتظار";
const JOB_RUNNING = "قيد التنفيذ";
const JOB_FAILED = "فشل";
const JOB_INTERRUPTED_REASON = "أُغلق التطبيق قبل اكتمال التوليد — أعد المحاولة";

function log(/** @type {string} */ m) {
  process.stdout.write(`[desktop-entry ${new Date().toISOString()}] ${m}\n`);
}

if (!token || token.length < 32 || !Number.isInteger(port) || port <= 0) {
  log("refusing to start: missing readiness token or port");
  process.exit(2);
}

let inFlight = 0;
let shuttingDown = false;
/** @type {http.Server | null} */
let serverRef = null;

function tokenMatches(/** @type {unknown} */ given) {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const originalCreateServer = http.createServer;
// @ts-ignore — narrowed signature used by Next's start-server
http.createServer = function patchedCreateServer(...args) {
  const listenerIndex = args.findIndex((a) => typeof a === "function");
  const listener = args[listenerIndex];
  /** @type {http.RequestListener} */
  const wrapped = (req, res) => {
    if (req.url === READY_PATH) {
      if (req.method === "GET" && tokenMatches(req.headers["x-fathersapp-token"])) {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ ok: true, pid: process.pid, shuttingDown }));
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    if (shuttingDown) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8", connection: "close" });
      res.end("التطبيق قيد الإغلاق");
      return;
    }
    inFlight++;
    let done = false;
    const finish = () => { if (!done) { done = true; inFlight--; } };
    res.on("close", finish);
    res.on("finish", finish);
    return listener(req, res);
  };
  if (listenerIndex >= 0) args[listenerIndex] = wrapped;
  else args.push(wrapped);
  // @ts-ignore
  const srv = originalCreateServer.apply(this, args);
  serverRef = srv;
  return srv;
};

async function fetchJson(/** @type {string} */ p, /** @type {Record<string,string>} */ headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { headers, signal: AbortSignal.timeout(10000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function waitUntilHealthy() {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline && !shuttingDown) {
    try {
      const own = await fetchJson(READY_PATH, { "x-fathersapp-token": token });
      if (own.status === 200 && own.body?.pid === process.pid) {
        const h = await fetchJson("/api/health");
        if (h.status === 200 && h.body?.status === "ok" && h.body?.db === "up") {
          process.send?.({ type: "ready", token, pid: process.pid, port, version: h.body.version });
          log(`ready on 127.0.0.1:${port}`);
          return;
        }
      }
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!shuttingDown) {
    log("health check did not pass in time");
    process.send?.({ type: "failed", token, reason: "health-timeout" });
    process.exit(3);
  }
}

/** @returns {Promise<any>} */
async function withDb(/** @type {(c: any) => Promise<any>} */ fn) {
  // `pg` is in the standalone node_modules (serverExternalPackages).
  const { Client } = require(require.resolve("pg", { paths: [__dirname] }));
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function activeJobs() {
  return withDb(async (c) => {
    const r = await c.query("select count(*)::int as n from report_jobs where status = any($1)", [[JOB_PENDING, JOB_RUNNING]]);
    return r.rows[0].n;
  });
}

/** @param {number} drainMs */
async function shutdown(drainMs, /** @type {string} */ why) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`shutdown requested (${why}), drain up to ${drainMs} ms`);
  const deadline = Date.now() + drainMs;
  // in-flight HTTP requests first (an export download, a form post)
  while (inFlight > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  // then background report generation scheduled via after()
  let interrupted = 0;
  try {
    let n = await activeJobs();
    while (n > 0 && Date.now() < deadline) {
      safeSend({ type: "draining", activeJobs: n });
      await new Promise((r) => setTimeout(r, 1000));
      n = await activeJobs();
    }
    if (n > 0) {
      interrupted = await withDb(async (c) => {
        const r = await c.query(
          "update report_jobs set status = $1, error = $2, finished_at = now() where status = any($3)",
          [JOB_FAILED, JOB_INTERRUPTED_REASON, [JOB_PENDING, JOB_RUNNING]],
        );
        return r.rowCount ?? 0;
      });
    }
  } catch (e) {
    log(`job drain check failed: ${e instanceof Error ? e.message : e}`);
  }
  log(`drain finished (inFlight=${inFlight}, interruptedJobs=${interrupted})`);
  safeSend({ type: "stopped", interruptedJobs: interrupted });
  try { serverRef?.close(); } catch { /* ignore */ }
  setTimeout(() => process.exit(0), 200);
}

function safeSend(/** @type {any} */ m) {
  try { if (process.connected) process.send?.(m); } catch { /* parent gone */ }
}

process.on("message", (/** @type {any} */ m) => {
  if (m && m.type === "shutdown" && tokenMatches(m.token)) {
    void shutdown(Math.max(0, Math.min(Number(m.drainMs) || 0, 10 * 60_000)), "launcher");
  }
});
// Launcher crashed or was killed: never linger as an orphan holding the port and DB.
process.on("disconnect", () => void shutdown(15_000, "parent-disconnected"));
process.on("uncaughtException", (e) => log(`uncaught: ${e && e.stack ? e.stack : e}`));
process.on("unhandledRejection", (e) => log(`unhandled rejection: ${e instanceof Error ? e.stack : e}`));

require(path.join(__dirname, "server.js"));
void waitUntilHealthy();
