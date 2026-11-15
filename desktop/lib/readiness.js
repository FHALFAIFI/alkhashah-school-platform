// @ts-check
"use strict";
/**
 * Pure decision helpers for release safety — no I/O beyond what callers pass in, so they
 * are unit-tested directly (tests/unit/desktop-edition.test.ts).
 */
const path = require("node:path");

/**
 * Compares dotted versions with an optional numeric pre-release ("2.6.0-0" < "2.6.0").
 * Returns -1/0/1, or null when either side is not a recognisable version — callers must
 * then skip version-dependent guards rather than guess.
 * @param {unknown} a @param {unknown} b
 * @returns {-1 | 0 | 1 | null}
 */
function compareVersions(a, b) {
  const parse = (/** @type {unknown} */ v) => {
    if (typeof v !== "string") return null;
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?$/.exec(v.trim());
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? Infinity : Number(m[4])];
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 4; i++) {
    if (x[i] < y[i]) return -1;
    if (x[i] > y[i]) return 1;
  }
  return 0;
}

const DAY = 24 * 3600_000;

/**
 * What still stands between this installation and a recoverable backup on another device.
 * Every item is shown at each launch until resolved — not a one-time prompt.
 *
 * @param {{ state: any, settings: any, now?: number, dataRoot: string }} o
 * @returns {{ code: string, ar: string }[]}
 */
function backupReadiness(o) {
  const now = o.now ?? Date.now();
  const s = o.state ?? {};
  const issues = [];
  if (!s.recoveryKeyExportedAt) {
    issues.push({ code: "recovery-key-missing", ar: "لم يُحفظ مفتاح استعادة النسخ الاحتياطية بعد. بدونه لا تُفتح النسخ على جهاز آخر." });
  } else if (s.recoveryKeyOnSameDrive) {
    issues.push({ code: "recovery-key-same-drive", ar: "مفتاح الاستعادة محفوظ على قرص هذا الجهاز فقط. انسخه إلى ذاكرة USB واحفظها في مكان آمن." });
  }
  if (!o.settings?.offsiteDir) {
    issues.push({ code: "offsite-missing", ar: "لم يُحدَّد مجلد للنسخ الخارجي (ذاكرة USB أو مجلد سحابي). النسخ الموجودة على هذا الجهاز وحده لا تحمي من تعطله أو فقده." });
  } else if (s.lastOffsiteError) {
    issues.push({ code: "offsite-failing", ar: "تعذّر آخر نسخ إلى المجلد الخارجي (هل الذاكرة الخارجية موصولة؟)." });
  } else if (!s.lastOffsiteOkAt || now - Date.parse(s.lastOffsiteOkAt) > 7 * DAY) {
    issues.push({ code: "offsite-stale", ar: "لم تُنسخ أي نسخة احتياطية إلى المجلد الخارجي منذ أكثر من ٧ أيام." });
  }
  if (s.lastBackupError) {
    issues.push({ code: "backup-failing", ar: "فشلت آخر نسخة احتياطية تلقائية." });
  } else if (s.bootstrapped && s.lastBackupAt && now - Date.parse(s.lastBackupAt) > 3 * DAY) {
    issues.push({ code: "backup-stale", ar: "آخر نسخة احتياطية أقدم من ٣ أيام." });
  }
  return issues;
}

/**
 * True when both paths are on the same volume (same drive letter or same UNC share) —
 * i.e. a copy there does not survive loss of this disk.
 * @param {string} a @param {string} b @param {NodeJS.Platform} [platform]
 */
function sameVolume(a, b, platform = process.platform) {
  if (platform !== "win32") {
    // POSIX (development only): same filesystem device of the nearest existing ancestor.
    const dev = (/** @type {string} */ p) => {
      let cur = path.resolve(p);
      for (;;) {
        try { return require("node:fs").statSync(cur).dev; } catch { /* try parent */ }
        const up = path.dirname(cur);
        if (up === cur) return -1;
        cur = up;
      }
    };
    return dev(a) === dev(b);
  }
  const root = (/** @type {string} */ p) => {
    const n = p.replace(/\//g, "\\");
    const unc = /^\\\\[^\\]+\\[^\\]+/.exec(n);
    if (unc) return unc[0].toLowerCase();
    const drive = /^[a-zA-Z]:/.exec(n);
    return drive ? drive[0].toLowerCase() : n.toLowerCase();
  };
  return root(a) === root(b);
}

/**
 * Removes secrets from text before it reaches a log or dialog.
 * @param {string} text @param {(string | undefined | null)[]} secrets
 */
function redactSecrets(text, secrets) {
  let out = String(text);
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join("[redacted]");
  }
  return out.replace(/password\s+'(?:[^']|'')*'/gi, "password '[redacted]'");
}

module.exports = { compareVersions, backupReadiness, sameVolume, redactSecrets };
