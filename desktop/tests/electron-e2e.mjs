// End-to-end test of the real desktop shell, driven by Playwright's Electron support.
// Synthetic data only, in an isolated data directory.
//
//   Development tree:  node desktop/tests/electron-e2e.mjs
//   Installed app:     FATHERSAPP_EXE="C:\Program Files\Father's App\FathersApp.exe" node desktop/tests/electron-e2e.mjs
//
// Env: FATHERSAPP_DATA_DIR (required, isolated), FATHERSAPP_E2E_OUT (JSON report path),
//      FATHERSAPP_E2E_CYCLES (repeated open/close count, default 3), plus the dev overrides
//      the launcher understands (FATHERSAPP_RESOURCES, FATHERSAPP_PG_BIN, …).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const { _electron: electron } = require(require.resolve("playwright", { paths: [process.cwd(), path.resolve(desktop, "..")] }));

const dataDir = process.env.FATHERSAPP_DATA_DIR;
if (!dataDir) throw new Error("FATHERSAPP_DATA_DIR is required (an isolated scratch directory)");
const exe = process.env.FATHERSAPP_EXE;
const cycles = Number(process.env.FATHERSAPP_E2E_CYCLES ?? 3);
const report = { checks: {}, timings: {}, cycles: [] };
const extraArgs = process.platform === "linux" ? ["--no-sandbox"] : [];

function launchOpts() {
  return exe
    ? { executablePath: exe, args: [...extraArgs], env: { ...process.env } }
    : { executablePath: require(path.join(desktop, "node_modules", "electron")), args: [desktop, ...extraArgs], env: { ...process.env } };
}

async function appWindow(app, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      const url = w.url();
      if (url.startsWith("http://127.0.0.1:")) return w;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("app window did not appear");
}

async function silenceDialogs(app) {
  // First-run dialogs (credentials, recovery key) are modal; answer them non-interactively.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
}

async function closeGracefully(app) {
  const proc = app.process();
  const exited = new Promise((r) => proc.once("exit", (code) => r(code)));
  const t0 = Date.now();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith("http://127.0.0.1:"));
    w?.close();
  });
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r("timeout"), 180_000))]);
  return { code, ms: Date.now() - t0 };
}

function pgDataDir() {
  const state = JSON.parse(fs.readFileSync(path.join(dataDir, "config", "state.json"), "utf8"));
  return path.join(state.pgRoot, "data");
}

function credentials() {
  const f = path.join(dataDir, "storage", "private", "initial-credentials.txt");
  const line = fs.readFileSync(f, "utf8").split(/\r?\n/).find((l) => l.includes("principal"));
  const m = /كلمة المرور المؤقتة:\s*(\S+)/.exec(line ?? "");
  if (!m) throw new Error("initial credentials not found");
  return { username: "principal", password: m[1] };
}

function check(name, ok, detail) {
  report.checks[name] = ok;
  console.log(JSON.stringify({ check: name, ok, ...(detail ? { detail } : {}) }));
  if (!ok) throw new Error(`check failed: ${name} ${detail ? JSON.stringify(detail) : ""}`);
}

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });

  // ——— first launch: install-time experience ———
  let t0 = Date.now();
  let app = await electron.launch(launchOpts());
  await silenceDialogs(app);
  let page = await appWindow(app);
  await page.waitForLoadState("domcontentloaded");
  report.timings.coldStartToWindowMs = Date.now() - t0;
  check("first-window-is-login", /\/login/.test(page.url()), page.url());
  check("rtl", (await page.getAttribute("html", "dir")) === "rtl");

  // second launch while running → must focus, not start another instance
  const second = await electron.launch(launchOpts()).catch(() => null);
  if (!second) check("single-instance", true, "second launch exited before connecting");
  else {
    const code = await new Promise((r) => { const p = second.process(); if (p.exitCode !== null) r(p.exitCode); else p.once("exit", r); setTimeout(() => r("still-running"), 20000); });
    check("single-instance", code !== "still-running", { code });
  }

  // ——— real login (Secure session cookie over http://127.0.0.1 in production mode) ———
  const c = credentials();
  await page.fill("#username", c.username);
  await page.fill("#password", c.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  check("login", true);
  const cookies = await page.context().cookies();
  const session = cookies.find((k) => k.name === "madrasa_session");
  check("session-cookie-secure-httponly", !!session && session.secure && session.httpOnly, session && { secure: session.secure, httpOnly: session.httpOnly, sameSite: session.sameSite });

  // ——— exports through the real app (PDF via bundled Chromium, Excel, Word) ———
  const exp = await page.evaluate(async () => {
    const out = {};
    for (const f of ["pdf", "xlsx", "docx"]) {
      const r = await fetch(`/api/reports/export?report=maintenance-register&format=${f}`);
      const b = new Uint8Array(await r.arrayBuffer());
      out[f] = { status: r.status, type: r.headers.get("content-type"), head: Array.from(b.slice(0, 5)), size: b.length };
    }
    return out;
  });
  check("export-pdf", exp.pdf.status === 200 && String.fromCharCode(...exp.pdf.head) === "%PDF-", exp.pdf);
  check("export-xlsx", exp.xlsx.status === 200 && exp.xlsx.head[0] === 0x50 && exp.xlsx.head[1] === 0x4b, exp.xlsx);
  check("export-docx", exp.docx.status === 200 && exp.docx.head[0] === 0x50 && exp.docx.head[1] === 0x4b, exp.docx);

  // ——— offline by construction: the renderer cannot reach any non-loopback host ———
  const external = await page.evaluate(async () => {
    try { await fetch("https://example.com/", { mode: "no-cors" }); return "reached"; } catch { return "blocked"; }
  });
  check("renderer-network-blocked", external === "blocked", external);

  // ——— safe close ———
  const pgData = pgDataDir();
  let closed = await closeGracefully(app);
  report.timings.firstCloseMs = closed.ms;
  check("graceful-exit", closed.code === 0, closed);
  check("postgres-stopped-after-close", !fs.existsSync(path.join(pgData, "postmaster.pid")));
  check("no-session-metadata-left", !fs.existsSync(path.join(dataDir, "run", "session.json")));

  // ——— repeated warm open/close; data and login persist; never re-seeded ———
  for (let i = 0; i < cycles; i++) {
    t0 = Date.now();
    app = await electron.launch(launchOpts());
    await silenceDialogs(app);
    page = await appWindow(app);
    await page.waitForLoadState("domcontentloaded");
    const startMs = Date.now() - t0;
    const stillLoggedIn = /\/dashboard|\/$/.test(new URL(page.url()).pathname) || (await page.goto(new URL("/dashboard", page.url()).toString()).then(() => !/\/login/.test(page.url())));
    closed = await closeGracefully(app);
    report.cycles.push({ startMs, closeMs: closed.ms, exit: closed.code, stillLoggedIn });
    check(`cycle-${i + 1}`, closed.code === 0 && !fs.existsSync(path.join(pgData, "postmaster.pid")), report.cycles[i]);
  }
  check("session-persists-across-restarts", report.cycles.every((x) => x.stillLoggedIn));
  const creds = fs.readFileSync(path.join(dataDir, "storage", "private", "initial-credentials.txt"), "utf8");
  check("seed-ran-once", creds.trim().split(/\r?\n/).length === 2);

  // ——— hard kill (power loss / crash) → next launch recovers ———
  app = await electron.launch(launchOpts());
  await silenceDialogs(app);
  page = await appWindow(app);
  const pid = app.process().pid;
  // Hard crash of the whole Electron process tree (Task Manager "End process tree" / power cut);
  // PostgreSQL and the Node server are separate processes and are deliberately left behind.
  if (process.platform === "win32") {
    const { execFileSync } = await import("node:child_process");
    try { execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
  } else {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
  await new Promise((r) => setTimeout(r, 3000));
  t0 = Date.now();
  // A relaunch can briefly lose the single-instance race while Chromium helpers of the dead
  // instance wind down; a user would simply double-click again. Record how many tries it took.
  let attempts = 0;
  for (;;) {
    attempts++;
    try {
      app = await electron.launch(launchOpts());
      await silenceDialogs(app);
      page = await appWindow(app, 120_000);
      break;
    } catch (e) {
      if (attempts >= 6) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  report.recoveryLaunchAttempts = attempts;
  report.timings.recoveryStartMs = Date.now() - t0;
  const health = await page.evaluate(async () => (await fetch("/api/health")).json());
  check("crash-recovery", health.status === "ok" && health.db === "up", health);
  closed = await closeGracefully(app);
  check("graceful-exit-after-recovery", closed.code === 0, closed);
  check("postgres-stopped-after-recovery-close", !fs.existsSync(path.join(pgData, "postmaster.pid")));

  report.ok = true;
}

main()
  .catch((e) => {
    report.ok = false;
    report.error = String(e?.stack ?? e);
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.env.FATHERSAPP_E2E_OUT) fs.writeFileSync(process.env.FATHERSAPP_E2E_OUT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: report.ok, timings: report.timings, cycles: report.cycles, recoveryLaunchAttempts: report.recoveryLaunchAttempts }));
    // Playwright/Electron handles of a killed app can keep the event loop alive forever.
    setTimeout(() => process.exit(process.exitCode ?? 0), 1000);
  });
