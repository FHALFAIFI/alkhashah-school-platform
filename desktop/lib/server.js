// @ts-check
"use strict";
/**
 * Launcher side of the Node/Next.js server process.
 */
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { cleanEnv } = require("./proc");

/**
 * @typedef {{ child: import("node:child_process").ChildProcess, port: number, token: string, pid: number, exited: Promise<number|null> }} ServerHandle
 */

/**
 * @param {{ nodeExe: string, entry: string, cwd: string, port: number, env: Record<string,string>, logFile: string, timeoutMs?: number, onMessage?: (m: any) => void }} o
 * @returns {Promise<ServerHandle>}
 */
async function startServer(o) {
  const token = crypto.randomBytes(32).toString("hex");
  rotate(o.logFile);
  const logFd = fs.openSync(o.logFile, "a", 0o600);
  const child = spawn(o.nodeExe, [o.entry], {
    cwd: o.cwd,
    env: cleanEnv({ ...o.env, PORT: String(o.port), HOSTNAME: "127.0.0.1", FATHERSAPP_READY_TOKEN: token }),
    stdio: ["ignore", logFd, logFd, "ipc"],
    windowsHide: true,
  });
  fs.closeSync(logFd);
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  child.on("message", (m) => o.onMessage?.(m));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      child.kill();
      reject(new Error("server did not become ready in time"));
    }, o.timeoutMs ?? 240_000);
    /** @param {any} m */
    const onMsg = (m) => {
      if (!m || m.token !== token) return;
      if (m.type === "ready" && m.pid === child.pid && m.port === o.port) { cleanup(); resolve(undefined); }
      if (m.type === "failed") { cleanup(); reject(new Error(`server reported failure: ${m.reason}`)); }
    };
    const onExit = (/** @type {number|null} */ code) => { cleanup(); reject(Object.assign(new Error(`server exited during startup (code ${code})`), { code: "SERVER_EXIT", exitCode: code })); };
    const onErr = (/** @type {Error} */ e) => { cleanup(); reject(e); };
    function cleanup() {
      clearTimeout(timer);
      child.off("message", onMsg);
      child.off("exit", onExit);
      child.off("error", onErr);
    }
    child.on("message", onMsg);
    child.once("exit", onExit);
    child.once("error", onErr);
  });

  // Second, independent proof over HTTP: the listener on this port knows our token and
  // reports our child's PID. A foreign process on the port cannot pass this.
  const res = await fetch(`http://127.0.0.1:${o.port}/__fathersapp/ready`, { headers: { "x-fathersapp-token": token }, signal: AbortSignal.timeout(10000) });
  const body = /** @type {any} */ (await res.json().catch(() => null));
  if (res.status !== 200 || body?.pid !== child.pid) {
    child.kill();
    throw new Error("readiness verification failed");
  }
  return { child, port: o.port, token, pid: /** @type {number} */ (child.pid), exited };
}

/**
 * Asks the server to drain and exit; force-terminates our own child only if it does not
 * exit in time (the PID is our direct child — no other process can be affected).
 * @param {ServerHandle} h
 * @param {{ drainMs: number }} o
 */
async function stopServer(h, o) {
  if (h.child.exitCode !== null) return "already-exited";
  try {
    h.child.send({ type: "shutdown", token: h.token, drainMs: o.drainMs });
  } catch { /* channel already closed */ }
  const graceful = await Promise.race([h.exited.then(() => true), new Promise((r) => setTimeout(() => r(false), o.drainMs + 20_000))]);
  if (graceful) return "graceful";
  h.child.kill();
  await Promise.race([h.exited, new Promise((r) => setTimeout(r, 10_000))]);
  return "killed";
}

function rotate(/** @type {string} */ file) {
  try {
    if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, file + ".1");
  } catch { /* missing is fine */ }
}

module.exports = { startServer, stopServer };
