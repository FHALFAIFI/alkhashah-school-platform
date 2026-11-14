// @ts-check
"use strict";
/**
 * Streaming encryption that is byte-compatible with the Mac/Linux backup scripts:
 *   openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE
 * Layout: "Salted__" | salt(8) | AES-256-CBC(PKCS#7) ciphertext, where key||iv =
 * PBKDF2-HMAC-SHA256(passphrase, salt, 200000, 48).
 *
 * Compatibility is deliberate: a Windows backup can be restored by scripts/restore.sh
 * on the Mac/Ubuntu server and vice versa. CBC has no authentication, so integrity is
 * enforced separately (SHA-256 sidecar + per-file manifest + pg_restore --list).
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");

const MAGIC = Buffer.from("Salted__", "ascii");
const ITERATIONS = 200000;

/** @param {string} passphrase @param {Buffer} salt */
function deriveKeyIv(passphrase, salt) {
  const kiv = crypto.pbkdf2Sync(Buffer.from(passphrase, "utf8"), salt, ITERATIONS, 48, "sha256");
  return { key: kiv.subarray(0, 32), iv: kiv.subarray(32, 48) };
}

/**
 * @param {string} inFile
 * @param {string} outFile
 * @param {string} passphrase
 */
async function encryptFile(inFile, outFile, passphrase) {
  if (!passphrase) throw new Error("empty passphrase");
  const salt = crypto.randomBytes(8);
  const { key, iv } = deriveKeyIv(passphrase, salt);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const out = fs.createWriteStream(outFile, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, salt]));
  await pipeline(fs.createReadStream(inFile), cipher, out);
}

/**
 * @param {string} inFile
 * @param {string} outFile
 * @param {string} passphrase
 */
async function decryptFile(inFile, outFile, passphrase) {
  const fd = fs.openSync(inFile, "r");
  const header = Buffer.alloc(16);
  try {
    const n = fs.readSync(fd, header, 0, 16, 0);
    if (n !== 16 || !header.subarray(0, 8).equals(MAGIC)) throw new Error("not an encrypted backup (missing Salted__ header)");
  } finally {
    fs.closeSync(fd);
  }
  const { key, iv } = deriveKeyIv(passphrase, header.subarray(8, 16));
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  try {
    await pipeline(fs.createReadStream(inFile, { start: 16 }), decipher, fs.createWriteStream(outFile, { mode: 0o600 }));
  } catch (e) {
    // Bad padding is what a wrong key looks like for CBC.
    try { fs.rmSync(outFile, { force: true }); } catch { /* ignore */ }
    const err = new Error("wrong backup key or corrupted backup");
    // @ts-ignore
    err.code = "BAD_KEY_OR_CORRUPT";
    // @ts-ignore
    err.cause = e;
    throw err;
  }
}

/**
 * Transform: plaintext in → "Salted__"|salt|ciphertext out.
 * @param {string} passphrase
 */
function createEncryptStream(passphrase) {
  if (!passphrase) throw new Error("empty passphrase");
  const salt = crypto.randomBytes(8);
  const { key, iv } = deriveKeyIv(passphrase, salt);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let headerSent = false;
  return new Transform({
    transform(chunk, _e, cb) {
      if (!headerSent) { this.push(Buffer.concat([MAGIC, salt])); headerSent = true; }
      cb(null, cipher.update(chunk));
    },
    flush(cb) {
      if (!headerSent) this.push(Buffer.concat([MAGIC, salt]));
      cb(null, cipher.final());
    },
  });
}

/**
 * Transform: encrypted file bytes in → plaintext out. A wrong key surfaces as an error
 * with code BAD_KEY_OR_CORRUPT at the end of the stream (CBC padding check).
 * @param {string} passphrase
 */
function createDecryptStream(passphrase) {
  /** @type {crypto.Decipher | null} */
  let decipher = null;
  let head = Buffer.alloc(0);
  const badKey = (/** @type {unknown} */ e) => Object.assign(new Error("wrong backup key or corrupted backup"), { code: "BAD_KEY_OR_CORRUPT", cause: e });
  return new Transform({
    transform(chunk, _e, cb) {
      if (!decipher) {
        head = Buffer.concat([head, chunk]);
        if (head.length < 16) return cb();
        if (!head.subarray(0, 8).equals(MAGIC)) return cb(new Error("not an encrypted backup (missing Salted__ header)"));
        const { key, iv } = deriveKeyIv(passphrase, head.subarray(8, 16));
        decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
        chunk = head.subarray(16);
      }
      cb(null, decipher.update(chunk));
    },
    flush(cb) {
      if (!decipher) return cb(new Error("encrypted backup is truncated"));
      try { cb(null, decipher.final()); } catch (e) { cb(badKey(e)); }
    },
  });
}

/** @param {string} file */
async function sha256File(file) {
  const h = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), new Transform({ transform(c, _e, cb) { h.update(c); cb(); } }));
  return h.digest("hex");
}

module.exports = { encryptFile, decryptFile, createEncryptStream, createDecryptStream, sha256File, deriveKeyIv, ITERATIONS };
