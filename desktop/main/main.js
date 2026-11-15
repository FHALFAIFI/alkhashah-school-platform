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
const { backupReadiness, sameVolume } = require("../lib/readiness");
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
/** @type {NodeJS.Timeout | null} */ let startupBackupTimer = null;

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
  // Installed builds always use their own read-only resources; the override is for development.
  if (app.isPackaged) return process.resourcesPath;
  return process.env.FATHERSAPP_RESOURCES ?? path.join(__dirname, "..", "build");
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
  // Windows asks whether the session may end (shutdown/restart/log-off). Delay it once and
  // run the normal safe shutdown (no backup, short drain); Windows continues by itself as
  // soon as the app has exited, or the user may choose "shut down anyway" — then
  // session-end below still stops PostgreSQL synchronously.
  mainWindow.on("query-session-end", (e) => {
    if (quitting) return;
    log(`query-session-end (${(e.reasons ?? []).join(",")}) — graceful stop before Windows continues`);
    e.preventDefault();
    void shutdownAndQuit({ fast: true });
  });
  // Windows is ending the session now: stop PostgreSQL synchronously.
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
        { label: "حالة النسخ الاحتياطي…", click: () => void backupStatus() },
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

// ————— dialogs —————
// Every dialog is owned by the visible main window: it is modal (cannot slip behind the
// maximized app and be overlooked — the backup-readiness reminder relies on this), and the
// main window stays the process's only unowned top-level window, so Windows' shutdown query
// (WM_QUERYENDSESSION) is answered by the window that runs the graceful stop.

function dialogOwner() {
  return mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null;
}

/** @param {Electron.MessageBoxOptions} o */
function messageBox(o) {
  const w = dialogOwner();
  return w ? dialog.showMessageBox(w, o) : dialog.showMessageBox(o);
}

/** @param {Electron.OpenDialogOptions} o */
function openDialog(o) {
  const w = dialogOwner();
  return w ? dialog.showOpenDialog(w, o) : dialog.showOpenDialog(o);
}

/** @param {Electron.SaveDialogOptions} o */
function saveDialog(o) {
  const w = dialogOwner();
  return w ? dialog.showSaveDialog(w, o) : dialog.showSaveDialog(o);
}

async function info(/** @type {string} */ message, /** @type {string} */ detail = "", type = /** @type {"info"|"warning"|"error"} */ ("info")) {
  if (SELF_TEST) { log(`dialog(${type}): ${message} ${detail}`); return; }
  await messageBox({ type, title: S.APP_TITLE, message, detail, buttons: ["حسناً"], noLink: true });
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
  const r = await openDialog({ title: "اختر مجلداً خارج هذا الجهاز (ذاكرة USB أو مجلد سحابي)", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return;
  const dir = r.filePaths[0];
  try {
    const probe = path.join(dir, `.fathersapp-write-test-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
  } catch {
    await info("لا يمكن الكتابة في هذا المجلد.", "اختر مجلداً آخر (مثل ذاكرة USB موصولة).", "error");
    return;
  }
  if (sameVolume(dir, dataRoot)) {
    const c = await messageBox({
      type: "warning", title: S.APP_TITLE, noLink: true, cancelId: 1, defaultId: 1,
      message: "هذا المجلد على قرص هذا الجهاز نفسه.",
      detail: "لن يحمي من تعطّل الجهاز أو فقده، إلا إذا كان مجلداً متزامناً مع خدمة سحابية (مثل OneDrive) تعمل فعلاً. هل تريد استعماله مع ذلك؟",
      buttons: ["استعماله", "اختيار مجلد آخر"],
    });
    if (c.response !== 0) return;
  }
  orch.updateSettings({ offsiteDir: dir });
  delete orch.state.lastOffsiteError;
  orch.saveState();
  // Prove it works now, instead of discovering a problem on the day it is needed.
  await manualBackup();
}

async function exportRecoveryKey() {
  if (!orch?.secrets) return false;
  const r = await saveDialog({
    title: "حفظ مفتاح استعادة النسخ الاحتياطية (يفضَّل على ذاكرة USB)",
    defaultPath: path.join(app.getPath("documents"), "مفتاح-استعادة-النسخ-FathersApp.txt"),
    filters: [{ name: "ملف نصي", extensions: ["txt"] }],
  });
  if (r.canceled || !r.filePath) return false;
  try {
    fs.writeFileSync(r.filePath, recoveryKeyText(orch.secrets.backupKey, orch.secrets.createdAt), { encoding: "utf8" });
    // read back: a key file that does not round-trip is worse than none
    if (parseRecoveryKey(fs.readFileSync(r.filePath, "utf8")) !== orch.secrets.backupKey) throw new Error("readback mismatch");
  } catch (e) {
    log(`recovery key export failed: ${e instanceof Error ? e.message : e}`);
    await info("تعذّر حفظ مفتاح الاستعادة في هذا المكان.", "اختر مكاناً آخر (مثل ذاكرة USB).", "error");
    return false;
  }
  const local = sameVolume(r.filePath, dataRoot);
  orch.state.recoveryKeyExportedAt = new Date().toISOString();
  orch.state.recoveryKeyOnSameDrive = local;
  orch.saveState();
  await info(
    "حُفظ مفتاح الاستعادة وتم التحقق من الملف.",
    local
      ? "الملف الآن على قرص هذا الجهاز فقط. احفظه مرة أخرى على ذاكرة USB من قائمة «النسخ الاحتياطي ← حفظ مفتاح الاستعادة» واحفظ الذاكرة في مكان آمن بعيداً عن الجهاز."
      : "احفظ هذه الذاكرة في مكان آمن بعيداً عن الجهاز، ولا تضعها مع النسخ الاحتياطية في المكان نفسه.",
  );
  return true;
}

function fmtTime(/** @type {string | undefined} */ iso) {
  return iso ? new Date(iso).toLocaleString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh" }) : "لا يوجد";
}

async function backupStatus() {
  if (!orch) return;
  const issues = backupReadiness({ state: orch.state, settings: orch.settings, dataRoot });
  const lines = [
    `آخر نسخة احتياطية: ${fmtTime(orch.state.lastBackupAt)}`,
    `آخر نسخ إلى المجلد الخارجي: ${fmtTime(orch.state.lastOffsiteOkAt)}`,
    `المجلد الخارجي: ${orch.settings.offsiteDir ?? "غير محدد"}`,
    `مفتاح الاستعادة: ${orch.state.recoveryKeyExportedAt ? (orch.state.recoveryKeyOnSameDrive ? "محفوظ على هذا الجهاز فقط" : "محفوظ خارج هذا الجهاز") : "لم يُحفظ"}`,
  ];
  await info(issues.length ? "النسخ الاحتياطي يحتاج إلى انتباهك." : "إعدادات النسخ الاحتياطي مكتملة.", [...lines, "", ...issues.map((i) => `• ${i.ar}`)].join("\n"), issues.length ? "warning" : "info");
}

/**
 * Shown at EVERY launch while anything stands between this laptop and a backup that can be
 * restored elsewhere — not a one-time prompt that is easy to dismiss and forget.
 */
async function backupReadinessDialogs() {
  if (SELF_TEST || !orch) return;
  for (let round = 0; round < 4; round++) {
    const issues = backupReadiness({ state: orch.state, settings: orch.settings, dataRoot });
    if (!issues.length) return;
    const needKey = issues.some((i) => i.code.startsWith("recovery-key"));
    const r = await messageBox({
      type: "warning", title: S.APP_TITLE, noLink: true, cancelId: 1, defaultId: 0,
      message: "حماية بيانات المدرسة لم تكتمل بعد",
      detail: issues.map((i) => `• ${i.ar}`).join("\n") + "\n\nستظهر هذه الرسالة عند كل تشغيل حتى تكتمل.",
      // index 1 is always "remind me later" (also what the automated tests answer)
      buttons: [needKey ? "حفظ مفتاح الاستعادة…" : "تحديد مجلد النسخ الخارجي…", "تذكيري لاحقاً", needKey ? "تحديد مجلد النسخ الخارجي…" : "إنشاء نسخة الآن"],
    });
    if (r.response === 1) return;
    if (r.response === 0) { if (needKey) await exportRecoveryKey(); else await chooseOffsite(); }
    if (r.response === 2) { if (needKey) await chooseOffsite(); else await manualBackup(); }
  }
}

async function restoreFlow() {
  if (!orch || busy) return;
  const pick = await openDialog({
    title: "اختر ملف النسخة الاحتياطية",
    defaultPath: layout.backupsFull,
    filters: [{ name: "نسخة احتياطية مشفّرة", extensions: ["enc"] }],
    properties: ["openFile"],
  });
  if (pick.canceled || !pick.filePaths[0]) return;
  const file = pick.filePaths[0];

  const keyChoice = await messageBox({
    type: "question", title: S.APP_TITLE, noLink: true, cancelId: 3,
    message: "بأي مفتاح شُفّرت هذه النسخة؟",
    buttons: ["مفتاح هذا الجهاز", "ملف مفتاح الاستعادة…", "لصق المفتاح من الحافظة", "إلغاء"],
  });
  /** @type {string | null} */
  let key = null;
  if (keyChoice.response === 0) key = orch.secrets.backupKey;
  else if (keyChoice.response === 1) {
    const k = await openDialog({ title: "اختر ملف مفتاح الاستعادة", filters: [{ name: "ملف نصي", extensions: ["txt"] }], properties: ["openFile"] });
    if (k.canceled || !k.filePaths[0]) return;
    key = parseRecoveryKey(fs.readFileSync(k.filePaths[0], "utf8"));
  } else if (keyChoice.response === 2) key = parseRecoveryKey(await clipboard.readText());
  else return;
  if (!key) { await info("لم يُعثر على مفتاح صالح.", "", "error"); return; }

  busy = true;
  try {
    showSplash();
    setStatus(S.STEPS.restoreVerify);
    const v = await orch.verify(file, key);
    splash?.hide();
    const created = v.manifest?.createdAt ? new Date(v.manifest.createdAt).toLocaleString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh" }) : "غير معروف (نسخة من خادم ماك/أوبنتو)";
    const confirm = await messageBox({
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
    const code = /** @type {any} */ (e)?.code;
    if (code === "RESTORE_APPLIED_START_FAILED") {
      await info("استُعيدت النسخة، لكن تعذّر تشغيل المنصة بعدها.", `بياناتك السابقة محفوظة في نسخة الأمان: ${/** @type {any} */ (e).safetyBackup}\nأعد تشغيل المنصة، وإن تكرر الخطأ فأرسل مجلد السجلات للدعم الفني ولا تحذف أي ملفات.`, "error");
    } else {
      await info("لم تكتمل الاستعادة، ولم تُستبدل بياناتك الحالية.", S.errorMessage(e), "error");
    }
    if (orch?.url && mainWindow) { appOrigin = new URL(orch.url).origin; void mainWindow.loadURL(orch.url); }
  } finally {
    busy = false;
  }
}

// ————— first run —————

async function firstRunDialogs(/** @type {string[] | null} */ creds) {
  if (SELF_TEST || !orch) return;
  if (creds && creds.length) {
    const r = await messageBox({
      type: "info", title: S.APP_TITLE, noLink: true,
      message: "تم إعداد المنصة لأول مرة. هذه بيانات الدخول المؤقتة:",
      detail: `${creds.join("\n")}\n\nغيّر كلمتي المرور بعد أول دخول، وفعّل التحقق الثنائي.`,
      buttons: ["نسخ إلى الحافظة", "متابعة"],
    });
    if (r.response === 0) await clipboard.writeText(creds.join("\n"));
  }
  await backupReadinessDialogs();
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
    allowDevOverrides: !app.isPackaged,
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
  // daily automatic backup also shortly after start (not only at close): a laptop that is
  // always shut down with the app open must still get backups
  if (!SELF_TEST) startupBackupTimer = setTimeout(() => void orch?.backupIfDue(), 90_000);
  return res;
}

async function onServerCrash(/** @type {number | null} */ code) {
  if (quitting || shuttingDown) return;
  const r = await messageBox({
    type: "error", title: S.APP_TITLE, noLink: true,
    message: "توقفت المنصة بشكل غير متوقع.",
      detail: `لم يُحذف شيء من بياناتك، وستُفحص قاعدة البيانات عند إعادة التشغيل. (الرمز: ${code ?? "—"})`,
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

async function shutdownAndQuit(/** @type {{ fast?: boolean }} */ opts = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (startupBackupTimer) clearTimeout(startupBackupTimer);
  log(`shutdown requested${opts.fast ? " (Windows session ending)" : ""}`);
  showSplash();
  setStatus(S.STEPS.stopServer);
  mainWindow?.hide();
  try {
    // When Windows is ending the session: short drain, no backup (the startup backup covers it).
    const report = orch ? await orch.stop(opts.fast ? { drainMs: 15_000, backup: false } : { drainMs: 120_000 }) : {};
    if (!opts.fast && report?.backupError) await info("أُغلقت المنصة، لكن النسخة الاحتياطية التلقائية لم تكتمل.", "سيُعاد المحاولة عند الإغلاق القادم. يمكنك إنشاء نسخة يدوياً من قائمة «النسخ الاحتياطي».", "warning");
  } catch (e) {
    log(`shutdown error: ${e instanceof Error ? e.stack : e}`);
  } finally {
    quitting = true;
    // Session ending: everything is already stopped; exit directly so that an open modal
    // dialog (e.g. the backup reminder) can never keep the process alive under Windows.
    if (opts.fast) app.exit(0); else app.quit();
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
    const r = await messageBox({
      type: "error", title: S.APP_TITLE, noLink: true,
      message: "تعذّر تشغيل المنصة.",
      detail: `${S.errorMessage(e)}\n\nلم يُحذف شيء من بياناتك. إن تكرر ذلك فأرسل مجلد السجلات للدعم الفني، ولا تحذف مجلد FathersApp.`,
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
