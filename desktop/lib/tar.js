// @ts-check
"use strict";
/**
 * Minimal POSIX tar (ustar + pax long names) writer and a reader that also accepts GNU
 * long-name entries — enough to produce archives GNU tar/bsdtar read, and to read the
 * archives the Mac/Linux backup-weekly.sh produces. Regular files and directories only.
 *
 * The reader is strict: absolute paths, drive letters, ".." segments and entries outside
 * the caller's allow-list are rejected, so a crafted backup cannot write outside the
 * extraction directory.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const BLOCK = 512;

/** @param {Buffer} buf @param {number} off @param {number} len @param {string} s */
function writeStr(buf, off, len, s) {
  buf.write(s, off, Math.min(len, Buffer.byteLength(s)), "utf8");
}
/** @param {Buffer} buf @param {number} off @param {number} len @param {number} n */
function writeOctal(buf, off, len, n) {
  const s = n.toString(8).padStart(len - 1, "0");
  if (s.length > len - 1) throw new Error("tar numeric field overflow");
  buf.write(s + "\0", off, len, "ascii");
}

/**
 * @param {{ name: string, size: number, mode: number, mtime: number, type: "0" | "5" | "x" }} h
 */
function header(h) {
  const b = Buffer.alloc(BLOCK);
  writeStr(b, 0, 100, h.name);
  writeOctal(b, 100, 8, h.mode);
  writeOctal(b, 108, 8, 0);
  writeOctal(b, 116, 8, 0);
  writeOctal(b, 124, 12, h.size);
  writeOctal(b, 136, 12, Math.floor(h.mtime));
  b.fill(0x20, 148, 156); // checksum placeholder (spaces)
  b.write(h.type, 156, 1, "ascii");
  b.write("ustar\0", 257, 6, "ascii");
  b.write("00", 263, 2, "ascii");
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += b[i];
  b.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return b;
}

/** pax record "LEN key=value\n" where LEN counts itself */
function paxRecord(/** @type {string} */ key, /** @type {string} */ value) {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body);
  let total = len + String(len).length;
  if (String(total).length !== String(len).length) total = len + String(total).length;
  return Buffer.from(String(total) + body, "utf8");
}

const pad = (/** @type {number} */ n) => Buffer.alloc((BLOCK - (n % BLOCK)) % BLOCK);

/**
 * @param {string} name archive path (forward slashes)
 * @param {number} size
 * @param {"0"|"5"} type
 * @param {number} mtime seconds
 * @returns {Buffer[]}
 */
function entryHeaders(name, size, type, mtime) {
  const out = [];
  const needsPax = Buffer.byteLength(name) > 99 || /[^\x20-\x7e]/.test(name);
  if (needsPax) {
    const rec = paxRecord("path", name);
    out.push(header({ name: "PaxHeader/" + crypto.createHash("sha1").update(name).digest("hex").slice(0, 40), size: rec.length, mode: 0o644, mtime, type: "x" }), rec, pad(rec.length));
  }
  out.push(header({ name: needsPax ? name.replace(/[^\x20-\x7e]/g, "_").slice(-99) : name, size, mode: type === "5" ? 0o755 : 0o644, mtime, type }));
  return out;
}

/**
 * Yields tar bytes for the given entries. File contents are streamed; each file's SHA-256
 * and byte count are reported through onFile (used for the backup manifest).
 *
 * @param {{ archivePath: string, file?: string, dir?: boolean }[]} entries
 * @param {(e: { archivePath: string, size: number, sha256: string }) => void} [onFile]
 * @param {{ trailer?: boolean }} [opts] trailer=false lets the caller append more entries
 * @returns {AsyncGenerator<Buffer>}
 */
async function* tarStream(entries, onFile, opts = {}) {
  for (const e of entries) {
    if (e.dir) {
      const name = e.archivePath.endsWith("/") ? e.archivePath : e.archivePath + "/";
      for (const h of entryHeaders(name, 0, "5", Date.now() / 1000)) yield h;
      continue;
    }
    if (!e.file) throw new Error("tar entry without source");
    const st = fs.statSync(e.file);
    for (const h of entryHeaders(e.archivePath, st.size, "0", st.mtimeMs / 1000)) yield h;
    const hash = crypto.createHash("sha256");
    let n = 0;
    for await (const chunk of fs.createReadStream(e.file)) {
      const c = /** @type {Buffer} */ (chunk);
      n += c.length;
      if (n > st.size) throw new Error(`file grew while archiving: ${e.archivePath}`);
      hash.update(c);
      yield c;
    }
    if (n !== st.size) throw new Error(`file shrank while archiving: ${e.archivePath}`);
    yield pad(n);
    onFile?.({ archivePath: e.archivePath, size: n, sha256: hash.digest("hex") });
  }
  if (opts.trailer !== false) yield Buffer.alloc(BLOCK * 2);
}

/**
 * Recursively lists files under dir as archive entries prefixed with `prefix/`.
 * @param {string} dir @param {string} prefix
 */
function listTree(dir, prefix) {
  /** @type {{ archivePath: string, file?: string, dir?: boolean }[]} */
  const out = [{ archivePath: prefix, dir: true }];
  if (!fs.existsSync(dir)) return out;
  const walk = (/** @type {string} */ abs, /** @type {string} */ rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const a = path.join(abs, ent.name);
      const r = `${rel}/${ent.name}`;
      if (ent.isDirectory()) { out.push({ archivePath: r, dir: true }); walk(a, r); }
      else if (ent.isFile()) out.push({ archivePath: r, file: a });
      // symlinks and special files are never archived
    }
  };
  walk(dir, prefix);
  return out;
}

/** Validates and normalises an archive path; returns null when unsafe. */
function safeName(/** @type {string} */ raw) {
  const name = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!name || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return null;
  const parts = name.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === ".." || /[\0<>:"|?*]/.test(p))) return null;
  return parts.join("/");
}

/** @param {Buffer} b @param {number} off @param {number} len */
function readStr(b, off, len) {
  const s = b.subarray(off, off + len);
  const z = s.indexOf(0);
  return s.subarray(0, z === -1 ? len : z).toString("utf8");
}
/** @param {Buffer} b @param {number} off @param {number} len */
function readOctal(b, off, len) {
  const s = readStr(b, off, len).trim();
  return s ? parseInt(s, 8) : 0;
}

/**
 * Extracts a tar byte stream into destDir.
 *
 * @param {AsyncIterable<Buffer>} source
 * @param {string} destDir
 * @param {(name: string) => boolean} allow  allow-list predicate on the normalised name
 * @returns {Promise<{ files: Map<string, { size: number, sha256: string }> }>}
 */
async function extractTar(source, destDir, allow) {
  /** @type {Map<string, { size: number, sha256: string }>} */
  const files = new Map();
  let buf = Buffer.alloc(0);
  /** @type {null | { name: string, remaining: number, padding: number, fd: number | null, hash: crypto.Hash, size: number, kind: "file"|"pax"|"gnu"|"skip", meta: Buffer[] }} */
  let cur = null;
  /** @type {string | null} */
  let nextName = null;
  let ended = false;

  const root = path.resolve(destDir);
  const target = (/** @type {string} */ n) => {
    const t = path.resolve(root, ...n.split("/"));
    if (t !== root && !t.startsWith(root + path.sep)) throw new Error("unsafe path in archive");
    return t;
  };

  for await (const chunk of source) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (!ended) {
      if (cur) {
        if (cur.remaining > 0) {
          if (buf.length === 0) break;
          const take = Math.min(cur.remaining, buf.length);
          const part = buf.subarray(0, take);
          if (cur.kind === "file") { cur.hash.update(part); fs.writeSync(/** @type {number} */ (cur.fd), part); }
          else if (cur.kind !== "skip") cur.meta.push(Buffer.from(part));
          cur.remaining -= take;
          buf = buf.subarray(take);
          continue;
        }
        if (buf.length < cur.padding) break;
        buf = buf.subarray(cur.padding);
        if (cur.kind === "file") {
          fs.closeSync(/** @type {number} */ (cur.fd));
          files.set(cur.name, { size: cur.size, sha256: cur.hash.digest("hex") });
        } else if (cur.kind === "pax") {
          const text = Buffer.concat(cur.meta).toString("utf8");
          const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text);
          if (m) nextName = m[1];
        } else if (cur.kind === "gnu") {
          nextName = Buffer.concat(cur.meta).toString("utf8").replace(/\0+$/, "");
        }
        cur = null;
        continue;
      }
      if (buf.length < BLOCK) break;
      const h = buf.subarray(0, BLOCK);
      buf = buf.subarray(BLOCK);
      if (h.every((x) => x === 0)) { ended = true; break; }
      let sum = 0;
      for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
      if (sum !== readOctal(h, 148, 8)) throw new Error("corrupt tar header (checksum)");
      const type = String.fromCharCode(h[156] || 0x30);
      const size = readOctal(h, 124, 12);
      const prefix = readStr(h, 345, 155);
      const rawName = nextName ?? (prefix ? `${prefix}/${readStr(h, 0, 100)}` : readStr(h, 0, 100));
      const padding = (BLOCK - (size % BLOCK)) % BLOCK;
      const base = { remaining: size, padding, fd: null, hash: crypto.createHash("sha256"), size, meta: [] };
      if (type === "x") { cur = { ...base, name: "", kind: "pax" }; continue; }
      if (type === "L") { cur = { ...base, name: "", kind: "gnu" }; continue; }
      nextName = null;
      if (type === "g") { cur = { ...base, name: "", kind: "skip" }; continue; }
      const name = safeName(rawName);
      if (!name) throw new Error(`unsafe path in archive: ${rawName}`);
      if (type === "5") {
        if (allow(name)) fs.mkdirSync(target(name), { recursive: true });
        cur = { ...base, name, kind: "skip" };
        continue;
      }
      if ((type === "0" || type === "7") && allow(name)) {
        const t = target(name);
        fs.mkdirSync(path.dirname(t), { recursive: true });
        cur = { ...base, name, kind: "file", fd: fs.openSync(t, "w", 0o600) };
        continue;
      }
      // symlinks, devices, or names outside the allow-list are skipped, never written
      cur = { ...base, name, kind: "skip" };
    }
  }
  if (cur) throw new Error("truncated archive");
  if (!ended) throw new Error("archive end marker missing (truncated?)");
  return { files };
}

module.exports = { tarStream, listTree, extractTar, safeName };
