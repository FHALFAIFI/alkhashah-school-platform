// @ts-check
"use strict";
/**
 * Child-process helpers. Every executable is invoked by absolute path with an argument
 * array (no shell), windowsHide, and a sanitised environment — so PATH contents on the
 * user's machine (a system Node, a system PostgreSQL) can never be picked up by mistake.
 */
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");

/**
 * Environment for bundled tools: inherit only what Windows/POSIX need to run processes,
 * never PATH-dependent runtime selection. PATH is reduced to the system directory.
 *
 * @param {Record<string, string | undefined>} extra
 * @param {NodeJS.ProcessEnv} [base]
 */
function cleanEnv(extra, base = process.env) {
  /** @type {Record<string, string>} */
  const env = {};
  const keep = process.platform === "win32"
    ? ["SystemRoot", "SYSTEMROOT", "windir", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "ProgramData", "COMPUTERNAME", "USERNAME", "USERDOMAIN", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "ComSpec"]
    : ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL"];
  for (const k of keep) {
    const v = base[k];
    if (v !== undefined) env[k] = v;
  }
  if (process.platform === "win32") {
    const sys = base.SystemRoot ?? base.SYSTEMROOT ?? "C:\\Windows";
    env.PATH = `${sys}\\System32;${sys}`;
  } else {
    env.PATH = "/usr/bin:/bin";
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined) env[k] = v;
  }
  return env;
}

/**
 * Runs a program to completion. Resolves with {code, stdout, stderr}; never rejects on
 * a non-zero exit (callers decide), rejects only if the program cannot be started.
 *
 * @param {string} file
 * @param {string[]} args
 * @param {{ env?: Record<string,string>, cwd?: string, timeoutMs?: number, input?: string, stdoutFile?: string, stdinFile?: string }} [o]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string, timedOut: boolean }>}
 */
function run(file, args, o = {}) {
  return new Promise((resolve, reject) => {
    /** @type {any} */
    let outFd;
    /** @type {any} */
    let inFd;
    try {
      if (o.stdoutFile) outFd = fs.openSync(o.stdoutFile, "w", 0o600);
      if (o.stdinFile) inFd = fs.openSync(o.stdinFile, "r");
    } catch (e) {
      reject(e);
      return;
    }
    const child = spawn(file, args, {
      cwd: o.cwd,
      env: o.env,
      windowsHide: true,
      stdio: [inFd ?? "pipe", outFd ?? "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout?.on("data", (d) => { stdout += d; if (stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000); });
    child.stderr?.on("data", (d) => { stderr += d; if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000); });
    const timer = o.timeoutMs
      ? setTimeout(() => { timedOut = true; child.kill(); }, o.timeoutMs)
      : null;
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      closeFds();
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      closeFds();
      resolve({ code, stdout, stderr, timedOut });
    });
    if (child.stdin) {
      if (o.input !== undefined) child.stdin.end(o.input);
      else child.stdin.end();
    }
    function closeFds() {
      if (outFd !== undefined) try { fs.closeSync(outFd); } catch { /* already closed */ }
      if (inFd !== undefined) try { fs.closeSync(inFd); } catch { /* already closed */ }
    }
  });
}

/** Like run() but throws a descriptive Error on non-zero exit. */
async function runChecked(/** @type {string} */ file, /** @type {string[]} */ args, /** @type {Parameters<typeof run>[2]} */ o = {}) {
  const r = await run(file, args, o);
  if (r.code !== 0) {
    const name = require("node:path").basename(file);
    const err = new Error(`${name} exited with ${r.timedOut ? "timeout" : r.code}: ${(r.stderr || r.stdout).trim().slice(-2000)}`);
    // @ts-ignore attach for callers
    err.result = r;
    throw err;
  }
  return r;
}

/** @param {number} pid */
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists but belongs to someone else — still "alive", and certainly not ours to kill.
    return /** @type {NodeJS.ErrnoException} */ (e).code === "EPERM";
  }
}

/**
 * Command line of a live process, used to prove a stale PID really is our own server
 * before it is ever terminated (PIDs are reused by Windows).
 *
 * @param {number} pid
 * @returns {Promise<string | null>}
 */
async function commandLineOf(pid) {
  if (!isAlive(pid)) return null;
  if (process.platform === "linux") {
    try {
      return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ");
    } catch {
      return null;
    }
  }
  if (process.platform === "win32") {
    const sys = process.env.SystemRoot ?? "C:\\Windows";
    const ps = `${sys}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const r = await run(ps, ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { timeoutMs: 15000, env: cleanEnv({}) });
    const out = r.stdout.trim();
    return out || null;
  }
  return null;
}

module.exports = { cleanEnv, run, runChecked, isAlive, commandLineOf, execFile };
