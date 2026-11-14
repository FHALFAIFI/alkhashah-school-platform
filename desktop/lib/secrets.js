// @ts-check
"use strict";
/**
 * Per-installation secrets, generated once on first run and never shown in logs:
 *  - pgSuperPassword: PostgreSQL superuser of the private cluster (administration only)
 *  - pgAppPassword:   the non-superuser role the application connects as
 *  - backupKey:       backup encryption passphrase (exportable as a recovery key)
 *
 * At rest they are protected by a "protector": on Windows, Electron safeStorage (DPAPI,
 * bound to the Windows user). The backup key is the only one that must survive loss of
 * the machine, which is why it can be exported to a separate recovery-key file.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");

/**
 * @typedef {{ pgSuperPassword: string, pgAppPassword: string, backupKey: string, createdAt: string }} Secrets
 * @typedef {{ kind: string, encrypt(plain: string): Buffer, decrypt(data: Buffer): string }} Protector
 */

const token = (/** @type {number} */ n) => crypto.randomBytes(n).toString("base64url");

/** @returns {Secrets} */
function generateSecrets() {
  return { pgSuperPassword: token(24), pgAppPassword: token(24), backupKey: token(32), createdAt: new Date().toISOString() };
}

/**
 * Identity protector for platforms without an OS keystore (Linux test harness only).
 * The file is still mode 0600 inside a 0700 directory.
 * @returns {Protector}
 */
function plainProtector() {
  return {
    kind: "plain",
    encrypt: (s) => Buffer.from("PLAIN1:" + s, "utf8"),
    decrypt: (b) => {
      const s = b.toString("utf8");
      if (!s.startsWith("PLAIN1:")) throw new Error("secrets file is not in plain format");
      return s.slice(7);
    },
  };
}

/**
 * @param {string} file
 * @param {Protector} protector
 * @returns {{ secrets: Secrets, created: boolean }}
 */
function loadOrCreateSecrets(file, protector) {
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file);
    const secrets = JSON.parse(protector.decrypt(raw));
    for (const k of ["pgSuperPassword", "pgAppPassword", "backupKey"]) {
      if (typeof secrets[k] !== "string" || secrets[k].length < 16) throw new Error(`secrets file is missing ${k}`);
    }
    return { secrets, created: false };
  }
  const secrets = generateSecrets();
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, protector.encrypt(JSON.stringify(secrets)), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return { secrets, created: true };
}

/**
 * @param {string} file
 * @param {Secrets} secrets
 * @param {Protector} protector
 */
function saveSecrets(file, secrets, protector) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, protector.encrypt(JSON.stringify(secrets)), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const RECOVERY_PREFIX = "FATHERSAPP-BACKUP-KEY:";

/**
 * Text of the recovery-key file. Arabic for the principal; the key line is machine-readable.
 * @param {string} backupKey
 * @param {string} createdAt
 */
function recoveryKeyText(backupKey, createdAt) {
  return [
    "مفتاح استعادة النسخ الاحتياطية — منصة مجمع الخشعة (نسخة ويندوز)",
    "",
    "احفظ هذا الملف خارج هذا الجهاز (ذاكرة USB أو مكان آمن). بدونه لا يمكن فتح النسخ الاحتياطية",
    "على جهاز آخر إذا تعطّل هذا الجهاز. لا تشاركه مع أحد: من يملكه ومعه نسخة احتياطية يستطيع قراءتها.",
    "",
    `تاريخ الإنشاء: ${createdAt}`,
    "",
    `${RECOVERY_PREFIX}${backupKey}`,
    "",
  ].join("\r\n");
}

/** Extracts the key from a recovery-key file's text, or accepts a bare key. */
function parseRecoveryKey(/** @type {string} */ text) {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith(RECOVERY_PREFIX));
  const key = (line ? line.slice(RECOVERY_PREFIX.length) : text).trim();
  // a pasted server BACKUP_PASSPHRASE may contain spaces; only multi-line text is rejected
  if (key.length < 8 || /[\r\n]/.test(key)) return null;
  return key;
}

module.exports = { generateSecrets, plainProtector, loadOrCreateSecrets, saveSecrets, recoveryKeyText, parseRecoveryKey, RECOVERY_PREFIX };
