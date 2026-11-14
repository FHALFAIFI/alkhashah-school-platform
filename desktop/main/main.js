// @ts-check
"use strict";
/**
 * Electron main process of the Windows desktop edition ("Father's App").
 *
 * One double-click: single-instance lock → splash → orchestrator.start() (PostgreSQL,
 * migrations/seed when needed, Node server, authenticated readiness) → app window on
 * http://127.0.0.1:<port>. Closing the window runs the safe shutdown (drain report jobs,
 * daily backup if due, pg_ctl stop -m fast -w) before the process exits.
 *
 * The renderer is a plain, sandboxed browser window: no Node integration, no preload,
 * and every request that is not to the loopback app origin is cancelled.
 */
const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, Menu, dialog, shell, clipboard, safeStorage, session, powerMonitor } = require("electron");
const { Orchestrator } = require("../lib/orchestrator");
const { defaultDataRoot, dataLayout } = require("../lib/paths");
const { plainProtector, recoveryKeyText, parseRecoveryKey } = require("../lib/secrets");
const { listBackups } = require("../lib/backup");
const S = require("./strings");

const SELF_TEST = (process.argv.find((a) => a.startsWith("--self-test=")) ?? "").slice("--self-test=".length) || null;

// ————— single instance —————
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId("sa.edu.alkhashah.fathersapp");
// Nothing in the shell needs network access; keep Chromium from making background requests.
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-domain-reliability");
app.commandLine.appendSwitch("no-pings");

const dataRoot = defaultDataRoot();
const layout = dataLayout(dataRoot);
fs.mkdirSync(layout.logs, { recursive: true });
const launcherLog = path.join(layout.logs, "launcher.log");
try { if (fs.statSync(launcherLog).size > 5 * 1024 * 1024) fs.renameSync(launcherLog, launcherLog + ".1"); } catch { /* none yet */ }
const log = (/** @type {string} */ m) => {
  try { fs.appendFileSync(launcherLog, `${new Date().toISOString()} ${m}\n`); } catch { /* disk full: nothing sensible to do */ }
};

/** @type {BrowserWindow | null} */ let splash = null;
/** @type {BrowserWindow | null} */ let mainWindow = null;
/** @type {Orchestrator | null} */ let orch = null;
/** @type {string | null} */ let appOrigin = null;
let quitting = false;
let shuttingDown = false;
let busy = false;

function protector() {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      kind: "safeStorage",
      encrypt: (/** @type {string} */ s) => Buffer.concat([Buffer.from("SS1:"), safeStorage.encryptString(s)]),
      decrypt: (/** @type {Buffer} */ b) => {
        if (b.subarray(0, 4).toString() !== "SS1:") throw new Error("secrets file format");
        return safeStorage.decryptString(b.subarray(4));
      },
    };
  }
  // Windows always has DPAPI. Other platforms are development/test only and must opt in.
  if (process.platform !== "win32" && process.env.FATHERSAPP_ALLOW_PLAIN_SECRETS === "1") return plainProtector();
  throw new Error("OS secret storage (DPAPI) is unavailable");
}

function resourcesDir() {
  if (process.env.FATHERSAPP_RESOURCES) return process.env.FATHERSAPP_RESOURCES;
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "build");
}

// ————— splash —————

function showSplash() {
  if (splash && !splash.isDestroyed()) { splash.show(); return splash; }
  splash = new BrowserWindow({
    width: 560, height: 260, resizable: false, minimizable: true, maximizable: false, fullscreenable: false,
    show: !SELF_TEST, center: true, title: S.APP_TITLE, autoHideMenuBar: true, backgroundColor: "#f7f6f2",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  splash.setMenu(null);
  splash.on("close", (e) => { if (!quitting) e.preventDefault(); });
  void splash.loadFile(path.join(__dirname, "splash.html"));
  return splash;
}

/** Updates the splash text. The page itself contains no scripts (CSP default-src 'none'). */
function setStatus(/** @type {string} */ text, /** @type {string} */ detail = "") {
  log(`status: ${text} ${detail}`);
  if (!splash || splash.isDestroyed()) return;
  const wc = splash.webContents;
  const write = () => {
    if (wc.isDestroyed()) return;
    wc.executeJavaScript(`document.getElementById("status").textContent=${JSON.stringify(text)};document.getElementById("detail").textContent=${JSON.stringify(detail)};`).catch(() => {});
  };
  if (wc.isLoading()) wc.once("did-finish-load", write); else write();
}

// ————— main window —————

function createMainWindow(/** @type {string} */ url) {
  appOrigin = new URL(url).origin;
  mainWindow = new BrowserWindow({
    width: 1366, height: 860, minWidth: 900, minHeight: 600, show: false, title: S.APP_TITLE,
    backgroundColor: "#ffffff",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
  });
  const wc = mainWindow.webContents;
  wc.on("will-navigate", (e, target) => guardNavigation(e, target));
  wc.on("will-redirect", (e, target) => guardNavigation(e, target));
  wc.setWindowOpenHandler(({ url: target }) => {
    if (isAppUrl(target)) {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } } };
    }
    openExternalSafely(target);
    return { action: "deny" };
  });
  mainWindow.on("page-title-updated", (e) => { e.preventDefault(); });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.maximize();
    if (!SELF_TEST) mainWindow?.show();
    splash?.hide();
  });
  mainWindow.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    void shutdownAndQuit();
  });
  // Windows is shutting down / restarting / logging off: stop PostgreSQL synchronously.
  mainWindow.on("session-end", () => {
    log("session-end received — emergency stop");
    quitting = true;
    orch?.emergencyStopSync();
  });
  void mainWindow.loadURL(url);
}

function isAppUrl(/** @type {string} */ u) {
  try { return appOrigin !== null && new URL(u).origin === appOrigin; } catch { return false; }
}

function guardNavigation(/** @type {Electron.Event} */ e, /** @type {string} */ target) {
  if (isAppUrl(target)) return;
  e.preventDefault();
  openExternalSafely(target);
}

function openExternalSafely(/** @type {string} */ target) {
  try {
    const u = new URL(target);
    if (u.protocol === "mailto:" || u.protocol === "https:") void shell.openExternal(u.toString());
  } catch { /* ignore malformed */ }
}

function hardenSession() {
  const ses = session.defaultSession;
  // Spell-check would download Hunspell dictionaries from Google on first use — never wanted offline.
  ses.setSpellCheckerEnabled(false);
  ses.setSpellCheckerLanguages([]);
  // Offline by construction: the renderer may only talk to the loopback app origin.
  ses.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (details, cb) => {
    try {
      const u = new URL(details.url);
      cb({ cancel: !(u.hostname === "127.0.0.1" && appOrigin !== null && u.origin === appOrigin) });
    } catch {
      cb({ cancel: true });
    }
  });
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "clipboard-sanitized-write" || permission === "fullscreen"));
  ses.setPermissionCheckHandler((_wc, permission) => permission === "clipboard-sanitized-write" || permission === "fullscreen");
}

// ————— menu —————

function buildMenu() {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    {
      label: "المنصة",
      submenu: [
        { label: "إعادة تحميل الصفحة", accelerator: "F5", click: () => mainWindow?.webContents.reload() },
        { label: "الصفحة الرئيسية", click: () => appOrigin && mainWindow?.loadURL(appOrigin + "/") },
        { type: "separator" },
        { label: "تكبير", role: "zoomIn" },
        { label: "تصغير", role: "zoomOut" },
        { label: "الحجم الطبيعي", role: "resetZoom" },
        { label: "ملء الشاشة", role: "togglefullscreen" },
        { type: "separator" },
        { label: "طباعة الصفحة…", accelerator: "Ctrl+P", click: () => mainWindow?.webContents.print() },
        { type: "separator" },
        { label: "إغلاق المنصة", accelerator: "Alt+F4", click: () => void shutdownAndQuit() },
      ],
    },
    {
      label: "النسخ الاحتياطي",
      submenu: [
        { label: "إنشاء نسخة احتياطية الآن", click: () => void manualBackup() },
        { label: "استعادة نسخة احتياطية…", click: () => void restoreFlow() },
        { type: "separator" },
        { label: "فتح مجلد النسخ الاحتياطية", click: () => void shell.openPath(layout.backupsFull) },
        { label: "تحديد مجلد النسخ الخارجي (ذاكرة USB / مجلد سحابي)…", click: () => void chooseOffsite() },
        { label: "حفظ مفتاح الاستعادة…", click: () => void exportRecoveryKey() },
      ],
    },
    {
      label: "مساعدة",
      submenu: [
        { label: "دليل الاستخدام", click: () => void openGuide() },
        { label: "فتح مجلد السجلات", click: () => void shell.openPath(layout.logs) },
        { label: "حول المنصة", click: () => void about() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function info(/** @type {string} */ message, /** @type {string} */ detail = "", type = /** @type {"info"|"warning"|"error"} */ ("info")) {
  if (SELF_TEST) { log(`dialog(${type}): ${message} ${detail}`); return; }
  await dialog.showMessageBox({ type, title: S.APP_TITLE, message, detail, buttons: ["حسناً"], noLink: true });
}

async function about() {
  const b = orch?.buildInfo() ?? {};
  await info(
    "منصة الإدارة المدرسية المتكاملة — نسخة ويندوز المكتبية",
    `الإصدار: ${app.getVersion()}\nالالتزام: ${b.commit ?? "—"}\nمجلد البيانات: ${dataRoot}\nتعمل المنصة على هذا الجهاز فقط، ولا تتصل بالإنترنت.`,
  );
}

async function openGuide() {
  const guide = path.join(resourcesDir(), "guide", "دليل-الاستخدام.html");
  if (fs.existsSync(guide)) {
    const w = new BrowserWindow({ width: 900, height: 800, title: "دليل الاستخدام", autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, javascript: false, spellcheck: false } });
    void w.loadFile(guide);
  } else {
    await info("دليل الاستخدام غير متوفر في هذا التثبيت.");
  }
}

// ————— backup / restore —————

async function manualBackup() {
  if (!orch || busy) return;
  busy = true;
  mainWindow?.setProgressBar(2);
  try {
    const r = await orch.fullBackup();
    const off = r.offsite?.ok ? `\nونُسخت إلى المجلد الخارجي: ${r.offsite.path}` : orch.settings.offsiteDir ? "\nتنبيه: تعذّر النسخ إلى المجلد الخارجي (هل الذاكرة الخارجية موصولة؟)." : "\nتنبيه: لم يُحدَّد مجلد خارجي — احفظ نسخة خارج هذا الجهاز.";
    await info("اكتملت النسخة الاحتياطية وتم التحقق من سلامتها.", `الملف: ${r.name}${off}`);
  } catch (e) {
    log(`manual backup failed: ${e instanceof Error ? e.stack : e}`);
    await info("تعذّر إنشاء النسخة الاحتياطية.", S.errorMessage(e), "error");
  } finally {
    mainWindow?.setProgressBar(-1);
    busy = false;
  }
}

async function chooseOffsite() {
  if (!orch) return;
  const r = await dialog.showOpenDialog({ title: "اختر مجلداً خارج هذا الجهاز لحفظ نسخ إضافية", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return;
  orch.updateSettings({ offsiteDir: r.filePaths[0] });
  await info("سيُنسخ كل نسخة احتياطية جديدة إلى هذا المجلد أيضاً.", r.filePaths[0]);
}

async function exportRecoveryKey() {
  if (!orch?.secrets) return false;
  const r = await dialog.showSaveDialog({
    title: "حفظ مفتاح استعادة النسخ الاحتياطية",
    defaultPath: path.join(app.getPath("documents"), "مفتاح-استعادة-النسخ-FathersApp.txt"),
    filters: [{ name: "ملف نصي", extensions: ["txt"] }],
  });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, recoveryKeyText(orch.secrets.backupKey, orch.secrets.createdAt), { encoding: "utf8" });
  orch.state.recoveryKeyExportedAt = new Date().toISOString();
  orch.saveState();
  await info("حُفظ مفتاح الاستعادة.", "انقله الآن إلى ذاكرة USB أو مكان آمن خارج هذا الجهاز، ثم احذفه من هذا الجهاز.");
  return true;
}

async function restoreFlow() {
  if (!orch || busy) return;
  const pick = await dialog.showOpenDialog({
    title: "اختر ملف النسخة الاحتياطية",
    defaultPath: layout.backupsFull,
    filters: [{ name: "نسخة احتياطية مشفّرة", extensions: ["enc"] }],
    properties: ["openFile"],
  });
  if (pick.canceled || !pick.filePaths[0]) return;
  const file = pick.filePaths[0];

  const keyChoice = await dialog.showMessageBox({
    type: "question", title: S.APP_TITLE, noLink: true, cancelId: 3,
    message: "بأي مفتاح شُفّرت هذه النسخة؟",
    buttons: ["مفتاح هذا الجهاز", "ملف مفتاح الاستعادة…", "لصق المفتاح من الحافظة", "إلغاء"],
  });
  /** @type {string | null} */
  let key = null;
  if (keyChoice.response === 0) key = orch.secrets.backupKey;
  else if (keyChoice.response === 1) {
    const k = await dialog.showOpenDialog({ title: "اختر ملف مفتاح الاستعادة", filters: [{ name: "ملف نصي", extensions: ["txt"] }], properties: ["openFile"] });
    if (k.canceled || !k.filePaths[0]) return;
    key = parseRecoveryKey(fs.readFileSync(k.filePaths[0], "utf8"));
  } else if (keyChoice.response === 2) key = parseRecoveryKey(clipboard.readText());
  else return;
  if (!key) { await info("لم يُعثر على مفتاح صالح.", "", "error"); return; }

  busy = true;
  try {
    showSplash();
    setStatus(S.STEPS.restoreVerify);
    const v = await orch.verify(file, key);
    splash?.hide();
    const created = v.manifest?.createdAt ? new Date(v.manifest.createdAt).toLocaleString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh" }) : "غير معروف (نسخة من خادم ماك/أوبنتو)";
    const confirm = await dialog.showMessageBox({
      type: "warning", title: S.APP_TITLE, noLink: true, cancelId: 1, defaultId: 1,
      message: "استبدال البيانات الحالية بمحتوى هذه النسخة؟",
      detail: `تاريخ النسخة: ${created}\nعدد الملفات: ${v.fileCount}\n\nستُحفظ نسخة أمان تلقائية من بياناتك الحالية قبل الاستبدال.`,
      checkboxLabel: "أفهم أن البيانات الحالية ستُستبدل",
      buttons: ["استعادة", "إلغاء"],
    });
    if (confirm.response !== 0 || !confirm.checkboxChecked) return;
    showSplash();
    mainWindow?.hide();
    setStatus(S.STEPS.restore);
    const r = await orch.restore(file, key);
    if (r.url) { appOrigin = new URL(r.url).origin; await mainWindow?.loadURL(r.url); }
    splash?.hide();
    mainWindow?.show();
    await info("اكتملت الاستعادة بنجاح.", `نسخة الأمان السابقة للاستعادة: ${r.safetyBackup}`);
  } catch (e) {
    log(`restore failed: ${e instanceof Error ? e.stack : e}`);
    splash?.hide();
    mainWindow?.show();
    await info("لم تكتمل الاستعادة — بياناتك الحالية لم تتغير.", S.errorMessage(e), "error");
    if (orch?.url && mainWindow) { appOrigin = new URL(orch.url).origin; void mainWindow.loadURL(orch.url); }
  } finally {
    busy = false;
  }
}

// ————— first run —————

async function firstRunDialogs(/** @type {string[] | null} */ creds) {
  if (SELF_TEST || !orch) return;
  if (creds && creds.length) {
    const r = await dialog.showMessageBox({
      type: "info", title: S.APP_TITLE, noLink: true,
      message: "تم إعداد المنصة لأول مرة. هذه بيانات الدخول المؤقتة:",
      detail: `${creds.join("\n")}\n\nغيّر كلمتي المرور بعد أول دخول، وفعّل التحقق الثنائي.`,
      buttons: ["نسخ إلى الحافظة", "متابعة"],
    });
    if (r.response === 0) clipboard.writeText(creds.join("\n"));
  }
  if (!orch.state.recoveryKeyExportedAt) {
    const r = await dialog.showMessageBox({
      type: "warning", title: S.APP_TITLE, noLink: true, cancelId: 1,
      message: "احفظ مفتاح استعادة النسخ الاحتياطية",
      detail: "النسخ الاحتياطية مشفّرة. إذا تعطّل هذا الجهاز فلن تُفتح النسخ على جهاز آخر إلا بهذا المفتاح. احفظه على ذاكرة USB.",
      buttons: ["حفظ المفتاح الآن", "لاحقاً"],
    });
    if (r.response === 0) await exportRecoveryKey();
  }
}

// ————— startup / shutdown —————

async function start() {
  hardenSession();
  buildMenu();
  showSplash();
  orch = new Orchestrator({
    dataRoot,
    resourcesDir: resourcesDir(),
    protector: protector(),
    appVersion: app.getVersion(),
    ownExecutable: process.execPath,
    log,
    onStep: (k) => setStatus(S.STEPS[k] ?? S.STEPS.lock),
    onDraining: (n) => setStatus(S.STEPS.stopServer, S.draining(n)),
    onServerExit: (code) => void onServerCrash(code),
  });
  const res = await orch.start();
  log(`startup timings ${JSON.stringify(res.timings)}`);
  setStatus(S.STEPS.server);
  createMainWindow(res.url);
  await new Promise((r) => mainWindow?.webContents.once("did-finish-load", () => r(undefined)));
  await firstRunDialogs(res.initialCredentials);
  return res;
}

async function onServerCrash(/** @type {number | null} */ code) {
  if (quitting || shuttingDown) return;
  const r = await dialog.showMessageBox({
    type: "error", title: S.APP_TITLE, noLink: true,
    message: "توقفت المنصة بشكل غير متوقع.",
    detail: `بياناتك محفوظة. (الرمز: ${code ?? "—"})`,
    buttons: ["إعادة التشغيل", "إغلاق"],
  });
  if (r.response === 1) { void shutdownAndQuit(); return; }
  try {
    showSplash();
    setStatus(S.STEPS.restart);
    const url = /** @type {string} */ (await orch?.restartServer());
    appOrigin = new URL(url).origin;
    await mainWindow?.loadURL(url);
    splash?.hide();
  } catch (e) {
    log(`restart failed: ${e instanceof Error ? e.stack : e}`);
    await info("تعذّر إعادة تشغيل المنصة.", S.errorMessage(e), "error");
    void shutdownAndQuit();
  }
}

async function shutdownAndQuit() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutdown requested");
  showSplash();
  setStatus(S.STEPS.stopServer);
  mainWindow?.hide();
  try {
    const report = orch ? await orch.stop({ drainMs: 120_000 }) : {};
    if (report?.backupError) await info("أُغلقت المنصة، لكن النسخة الاحتياطية التلقائية لم تكتمل.", "سيُعاد المحاولة عند الإغلاق القادم. يمكنك إنشاء نسخة يدوياً من قائمة «النسخ الاحتياطي».", "warning");
  } catch (e) {
    log(`shutdown error: ${e instanceof Error ? e.stack : e}`);
  } finally {
    quitting = true;
    app.quit();
  }
}

app.on("second-instance", () => {
  const w = mainWindow && mainWindow.isVisible() ? mainWindow : splash;
  if (w && !w.isDestroyed()) {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  }
});

app.on("before-quit", (e) => {
  if (quitting) return;
  e.preventDefault();
  void shutdownAndQuit();
});
app.on("window-all-closed", () => { /* lifecycle is driven by shutdownAndQuit */ });

app.whenReady().then(async () => {
  // macOS/Linux equivalent of Windows' session-end (development only)
  powerMonitor.on("shutdown", () => { quitting = true; orch?.emergencyStopSync(); });
  if (SELF_TEST) { await selfTest(SELF_TEST); return; }
  try {
    await start();
  } catch (e) {
    log(`startup failed: ${e instanceof Error ? e.stack : e}`);
    splash?.hide();
    const r = await dialog.showMessageBox({
      type: "error", title: S.APP_TITLE, noLink: true,
      message: "تعذّر تشغيل المنصة.",
      detail: `${S.errorMessage(e)}\n\nبياناتك لم تُمسّ. إن تكرر ذلك فأرسل مجلد السجلات للدعم الفني.`,
      buttons: ["فتح مجلد السجلات", "إغلاق"],
    });
    if (r.response === 0) await shell.openPath(layout.logs);
    quitting = true;
    app.quit();
  }
});

/**
 * Non-interactive verification used by CI and support: full launch, real HTTP checks
 * against the running app, an encrypted backup + verification, clean shutdown. Writes a
 * JSON report and exits 0/1. It performs nothing a normal launch and a manual backup
 * would not.
 */
async function selfTest(/** @type {string} */ outFile) {
  const report = /** @type {Record<string, any>} */ ({ startedAt: new Date().toISOString(), checks: {} });
  let exitCode = 0;
  try {
    const t0 = Date.now();
    const res = await start();
    report.timings = res.timings;
    report.firstRun = res.firstRun;
    report.seeded = !!res.initialCredentials;
    report.windowLoadedMs = Date.now() - t0;
    const h = await (await fetch(`${res.url}/api/health`)).json();
    report.checks.health = h.status === "ok" && h.db === "up";
    report.version = h.version;
    const login = await fetch(`${res.url}/login`);
    const html = await login.text();
    report.checks.loginPage = login.status === 200 && html.includes('dir="rtl"');
    const title = await mainWindow?.webContents.executeJavaScript("document.documentElement.getAttribute('dir') + '|' + location.pathname");
    report.checks.windowRendered = typeof title === "string" && title.startsWith("rtl|");
    report.windowLocation = title;
    if (process.argv.includes("--self-test-backup")) {
      const b = await /** @type {Orchestrator} */ (orch).fullBackup();
      report.checks.backupVerified = b.verified === true;
      report.backup = { name: b.name, files: b.files };
      report.backups = listBackups(layout.backupsFull).map((x) => x.name);
    }
    report.ok = Object.values(report.checks).every(Boolean);
    if (!report.ok) exitCode = 1;
  } catch (e) {
    report.error = e instanceof Error ? e.stack : String(e);
    exitCode = 1;
  }
  try {
    const t1 = Date.now();
    report.stop = await orch?.stop({ drainMs: 30_000, backup: false });
    report.stopMs = Date.now() - t1;
  } catch (e) {
    report.stopError = String(e);
    exitCode = 1;
  }
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  quitting = true;
  app.exit(exitCode);
}
