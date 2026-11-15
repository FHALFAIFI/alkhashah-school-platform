// @ts-check
"use strict";
/**
 * Encrypted full backup and restore for the Windows desktop edition.
 *
 * Archive (identical layout to scripts/backup-weekly.sh, so restore.sh on the Mac/Ubuntu
 * server can read it and vice versa):
 *     db.dump          pg_dump --format=custom
 *     package.json     application version at backup time
 *     storage/...      all attachments and generated documents
 *     manifest.json    (desktop only) SHA-256 + size of every member, app/pg versions
 * → gzip → AES-256-CBC/PBKDF2 (openssl enc compatible) → full-YYYYMMDD-HHMMSS.tar.gz.enc
 * plus a sidecar full-….tar.gz.enc.sha256 for the encrypted file itself.
 *
 * Integrity is checked at three levels: sidecar hash (bit rot / truncated copy), per-file
 * manifest hashes (after decryption), and `pg_restore --list` on the dump.
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { createEncryptStream, createDecryptStream, sha256File } = require("./crypto-enc");
const { tarStream, listTree, extractTar } = require("./tar");
const { run, runChecked, cleanEnv } = require("./proc");
const pg = require("./postgres");
const { compareVersions } = require("./readiness");

const MANIFEST_FORMAT = "fathersapp-backup/1";
const NAME_RE = /^full-(\d{8}-\d{6})(?:-[a-z0-9-]+)?\.tar\.gz\.enc$/;

/** Local timestamp YYYYMMDD-HHMMSS (same as `date +%Y%m%d-%H%M%S` in the shell scripts). */
function stamp(d = new Date()) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * @typedef {{
 *   tools: import("./postgres").PgTools,
 *   port: number,
 *   secrets: { pgSuperPassword: string, pgAppPassword: string, backupKey: string },
 *   storageDir: string,
 *   tmpDir: string,
 *   appVersion: string,
 *   packageJson?: string,
 *   migrationsHash?: string | null,
 * }} BackupContext
 */

/** @param {BackupContext} ctx */
function appConn(ctx) {
  return { port: ctx.port, user: pg.APP_ROLE, password: ctx.secrets.pgAppPassword, db: pg.APP_DB };
}

/** @param {BackupContext} ctx @param {string} dumpFile */
async function dumpDatabase(ctx, dumpFile) {
  await runChecked(ctx.tools.pgDump, ["-h", "127.0.0.1", "-p", String(ctx.port), "-U", pg.APP_ROLE, "-d", pg.APP_DB, "--format=custom", "--no-password"], {
    env: cleanEnv({ PGPASSWORD: ctx.secrets.pgAppPassword, PGCONNECT_TIMEOUT: "15" }),
    stdoutFile: dumpFile, // written by Node: no non-ASCII path ever reaches pg_dump
    timeoutMs: 30 * 60_000,
  });
}

/** `pg_restore --list` succeeds only on a structurally valid custom-format dump. */
async function checkDump(/** @type {import("./postgres").PgTools} */ tools, /** @type {string} */ dumpFile) {
  const r = await run(tools.pgRestore, ["--list"], { env: cleanEnv({}), stdinFile: dumpFile, timeoutMs: 10 * 60_000 });
  if (r.code !== 0) throw new Error(`database dump failed validation: ${r.stderr.trim().slice(-500)}`);
  const entries = r.stdout.split("\n").filter((l) => /^\d+;/.test(l)).length;
  if (entries === 0) throw new Error("database dump is empty");
  return entries;
}

/**
 * Creates, verifies and (optionally) copies off-device one full encrypted backup.
 *
 * @param {BackupContext} ctx
 * @param {{ outDir: string, label?: string, verify?: boolean, retention?: number, offsiteDir?: string | null, log?: (m: string) => void }} o
 */
async function createBackup(ctx, o) {
  const s = stamp();
  const label = o.label ? `-${o.label}` : "";
  const name = `full-${s}${label}.tar.gz.enc`;
  fs.mkdirSync(o.outDir, { recursive: true, mode: 0o700 });
  const work = fs.mkdtempSync(path.join(ctx.tmpDir, `backup-${s}-`));
  const finalPath = path.join(o.outDir, name);
  const partPath = finalPath + ".part";
  try {
    const dump = path.join(work, "db.dump");
    await dumpDatabase(ctx, dump);
    const tocEntries = await checkDump(ctx.tools, dump);
    const pkg = path.join(work, "package.json");
    if (ctx.packageJson && fs.existsSync(ctx.packageJson)) fs.copyFileSync(ctx.packageJson, pkg);
    else fs.writeFileSync(pkg, JSON.stringify({ version: ctx.appVersion }) + "\n");

    /** @type {{ path: string, size: number, sha256: string }[]} */
    const members = [];
    const entries = [
      { archivePath: "db.dump", file: dump },
      { archivePath: "package.json", file: pkg },
      ...listTree(ctx.storageDir, "storage"),
    ];
    const manifestOf = () => ({
      format: MANIFEST_FORMAT,
      createdAt: new Date().toISOString(),
      appVersion: ctx.appVersion,
      migrationsHash: ctx.migrationsHash ?? null,
      platform: process.platform,
      dumpTocEntries: tocEntries,
      files: members,
    });
    const manifestFile = path.join(work, "manifest.json");
    // Members first (hashes collected while streaming), then the manifest describing them,
    // then the end-of-archive marker.
    async function* withManifest() {
      yield* tarStream(entries, (f) => members.push({ path: f.archivePath, size: f.size, sha256: f.sha256 }), { trailer: false });
      fs.writeFileSync(manifestFile, JSON.stringify(manifestOf(), null, 2));
      yield* tarStream([{ archivePath: "manifest.json", file: manifestFile }]);
    }
    await pipeline(Readable.from(withManifest()), zlib.createGzip({ level: 6 }), createEncryptStream(ctx.secrets.backupKey), fs.createWriteStream(partPath, { mode: 0o600 }));
    const sha = await sha256File(partPath);
    fs.renameSync(partPath, finalPath);
    fs.writeFileSync(finalPath + ".sha256", `${sha}  ${name}\n`, { mode: 0o600 });
    o.log?.(`backup written: ${name} (${members.length} files)`);

    let verified = false;
    if (o.verify !== false) {
      await verifyBackup(finalPath, ctx.secrets.backupKey, { tools: ctx.tools, tmpDir: ctx.tmpDir });
      verified = true;
    }
    const pruned = o.retention ? pruneBackups(o.outDir, o.retention) : [];
    let offsite = null;
    if (o.offsiteDir) offsite = await copyOffsite(finalPath, o.offsiteDir);
    return { file: finalPath, name, sha256: sha, files: members.length, verified, pruned, offsite };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(partPath, { force: true });
  }
}

/** @param {string} encFile */
function readSidecar(encFile) {
  const side = encFile + ".sha256";
  if (!fs.existsSync(side)) return null;
  const m = /^([0-9a-f]{64})\b/.exec(fs.readFileSync(side, "utf8").trim());
  return m ? m[1] : null;
}

/** Allowed archive members — anything else in a backup is ignored, never written. */
function allowMember(/** @type {string} */ name) {
  return name === "db.dump" || name === "manifest.json" || name === "package.json" || name === "env.example" || name === "storage" || name.startsWith("storage/");
}

/**
 * Decrypts and extracts into destDir, then checks every integrity layer.
 * @param {string} encFile @param {string} key @param {string} destDir
 * @param {{ tools: import("./postgres").PgTools, requireManifest?: boolean }} o
 */
async function extractVerified(encFile, key, destDir, o) {
  const expected = readSidecar(encFile);
  if (expected) {
    const actual = await sha256File(encFile);
    if (actual !== expected) throw Object.assign(new Error("backup file is corrupted (SHA-256 mismatch)"), { code: "CHECKSUM_MISMATCH" });
  } else if (o.requireManifest) {
    throw Object.assign(new Error("checksum file (.sha256) is missing next to the backup"), { code: "NO_SIDECAR" });
  }
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  /** @type {Awaited<ReturnType<typeof extractTar>> | undefined} */
  let extracted;
  try {
    // pipeline() propagates an error from any stage (wrong key, gzip damage, tar damage)
    await pipeline(fs.createReadStream(encFile), createDecryptStream(key), zlib.createGunzip(), async (/** @type {AsyncIterable<Buffer>} */ plain) => {
      extracted = await extractTar(plain, destDir, allowMember);
    });
  } catch (e) {
    const err = /** @type {any} */ (e);
    if (err?.code === "BAD_KEY_OR_CORRUPT" || err?.code === "Z_DATA_ERROR" || /incorrect header check|bad decrypt|wrong backup key/i.test(String(err?.message))) {
      throw Object.assign(new Error("wrong backup key or corrupted backup"), { code: "BAD_KEY_OR_CORRUPT" });
    }
    throw e;
  }
  if (!extracted) throw new Error("backup could not be read");
  const { files } = extracted;
  if (!files.has("db.dump")) throw new Error("backup has no database dump");
  let manifest = null;
  const manifestPath = path.join(destDir, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.format !== MANIFEST_FORMAT) throw new Error(`unsupported backup format ${manifest.format}`);
    for (const f of manifest.files) {
      const got = files.get(f.path);
      if (!got) throw Object.assign(new Error(`backup member missing: ${f.path}`), { code: "MEMBER_MISSING" });
      if (got.sha256 !== f.sha256 || got.size !== f.size) throw Object.assign(new Error(`backup member corrupted: ${f.path}`), { code: "MEMBER_CORRUPT" });
    }
  } else if (o.requireManifest) {
    throw new Error("backup has no manifest");
  }
  const tocEntries = await checkDump(o.tools, path.join(destDir, "db.dump"));
  return { manifest, tocEntries, fileCount: files.size, legacy: manifest === null, backupVersion: readArchiveVersion(destDir) };
}

/**
 * Full verification without touching live data.
 * @param {string} encFile @param {string} key @param {{ tools: import("./postgres").PgTools, tmpDir: string }} o
 */
async function verifyBackup(encFile, key, o) {
  const dest = fs.mkdtempSync(path.join(o.tmpDir, "verify-"));
  try {
    return await extractVerified(encFile, key, dest, { tools: o.tools });
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
}

/**
 * Keeps the newest `keep` backups in dir (by name timestamp), removing older ones together
 * with their sidecars. Only files matching our naming scheme are ever considered.
 * @param {string} dir @param {number} keep
 */
function pruneBackups(dir, keep) {
  if (!Number.isInteger(keep) || keep < 1) return [];
  const all = fs.readdirSync(dir).filter((n) => NAME_RE.test(n)).sort().reverse();
  const removed = [];
  for (const n of all.slice(keep)) {
    fs.rmSync(path.join(dir, n), { force: true });
    fs.rmSync(path.join(dir, n + ".sha256"), { force: true });
    removed.push(n);
  }
  return removed;
}

/**
 * Copies a backup and its sidecar to an off-device folder (USB drive, network share,
 * synced cloud folder) and re-verifies the copy's hash.
 * @param {string} file @param {string} offsiteDir
 */
async function copyOffsite(file, offsiteDir) {
  try {
    if (!fs.existsSync(offsiteDir)) return { ok: false, reason: "offsite-unavailable" };
    const dest = path.join(offsiteDir, "FathersApp-backups");
    fs.mkdirSync(dest, { recursive: true });
    const target = path.join(dest, path.basename(file));
    fs.copyFileSync(file, target + ".part");
    const expected = readSidecar(file);
    const got = await sha256File(target + ".part");
    if (expected && got !== expected) {
      fs.rmSync(target + ".part", { force: true });
      return { ok: false, reason: "offsite-copy-corrupt" };
    }
    fs.renameSync(target + ".part", target);
    if (fs.existsSync(file + ".sha256")) fs.copyFileSync(file + ".sha256", target + ".sha256");
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, reason: "offsite-error", detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Restores a verified backup into the live database and storage. The caller must have
 * stopped the application server. Steps are ordered so that any failure before the final
 * swap leaves current data untouched, and the swap itself keeps the previous database and
 * storage (renamed) until the next successful restore.
 *
 * @param {BackupContext & { dataRoot: string }} ctx
 * @param {string} encFile
 * @param {string} key
 * @param {{ log?: (m: string) => void, rename?: (from: string, to: string) => Promise<void> }} [o]
 */
async function restoreBackup(ctx, encFile, key, o = {}) {
  const s = stamp();
  const work = fs.mkdtempSync(path.join(ctx.tmpDir, `restore-${s}-`));
  const su = { port: ctx.port, user: pg.SUPERUSER, password: ctx.secrets.pgSuperPassword, db: "postgres" };
  const staging = `${pg.APP_DB}_restore_${crypto.randomBytes(3).toString("hex")}`;
  const prevDb = `${pg.APP_DB}_prev_${s.replace("-", "_")}`;
  const prevStorage = path.join(ctx.dataRoot, `storage.prev-${s}`);
  let stagingCreated = false;
  try {
    const info = await extractVerified(encFile, key, work, { tools: ctx.tools });
    o.log?.(`restore: archive verified (${info.fileCount} members, legacy=${info.legacy})`);
    // Never restore data written by a newer application version: older code on a newer
    // schema can misread or damage it. (Older backups are fine — migrations bring them up.)
    const backupVersion = readArchiveVersion(work);
    if (compareVersions(backupVersion, ctx.appVersion) === 1) {
      throw Object.assign(new Error(`backup was made by a newer version (${backupVersion} > ${ctx.appVersion})`), { code: "BACKUP_NEWER_THAN_APP", backupVersion });
    }

    await pg.psql(ctx.tools, su, `create database ${staging} owner ${pg.APP_ROLE} encoding 'UTF8' template template0`);
    stagingCreated = true;
    await pg.psql(ctx.tools, { ...su, db: staging }, `revoke create on schema public from public; alter schema public owner to ${pg.APP_ROLE}`);
    await runChecked(ctx.tools.pgRestore, ["-h", "127.0.0.1", "-p", String(ctx.port), "-U", pg.APP_ROLE, "-d", staging, "--no-owner", "--no-acl", "--exit-on-error", "--no-password"], {
      env: cleanEnv({ PGPASSWORD: ctx.secrets.pgAppPassword, PGCONNECT_TIMEOUT: "15" }),
      stdinFile: path.join(work, "db.dump"),
      timeoutMs: 60 * 60_000,
    });
    o.log?.("restore: database restored into staging");

    // 1) storage first — on Windows a folder rename can fail while antivirus or the search
    //    indexer holds a file open; that must happen before anything live has changed.
    const extractedStorage = path.join(work, "storage");
    fs.mkdirSync(extractedStorage, { recursive: true });
    const revertStorage = await swapStorage(ctx.storageDir, extractedStorage, prevStorage, o.rename);
    o.log?.("restore: storage swapped");

    // 2) database — if either rename fails, everything is put back as it was
    try {
      await pg.psql(ctx.tools, su, `select pg_terminate_backend(pid) from pg_stat_activity where datname in (${pg.lit(pg.APP_DB)}, ${pg.lit(staging)}) and pid <> pg_backend_pid()`);
      await pg.psql(ctx.tools, su, `alter database ${pg.APP_DB} rename to ${prevDb}`);
      try {
        await pg.psql(ctx.tools, su, `alter database ${staging} rename to ${pg.APP_DB}`);
      } catch (e) {
        await pg.psql(ctx.tools, su, `alter database ${prevDb} rename to ${pg.APP_DB}`);
        throw e;
      }
    } catch (e) {
      await revertStorage();
      throw e;
    }
    stagingCreated = false;
    o.log?.("restore: database swapped");

    // 3) only now discard older safety copies (the one just made is kept)
    await pg.psql(ctx.tools, su, `revoke all on database ${pg.APP_DB} from public`).catch(() => {});
    const olds = (await pg.psql(ctx.tools, su, `select datname from pg_database where datname like '${pg.APP_DB}_prev_%' and datname <> ${pg.lit(prevDb)}`).catch(() => "")).split("\n").filter(Boolean);
    for (const d of olds) if (/^[a-z0-9_]+$/.test(d)) await pg.psql(ctx.tools, su, `drop database if exists ${d}`).catch(() => {});
    for (const n of fs.readdirSync(ctx.dataRoot)) {
      const p = path.join(ctx.dataRoot, n);
      if (n.startsWith("storage.prev-") && p !== prevStorage) fs.rmSync(p, { recursive: true, force: true });
    }
    return { ok: true, legacy: info.legacy, manifest: info.manifest, backupVersion, previousDatabase: prevDb, previousStorage: prevStorage };
  } catch (e) {
    if (stagingCreated) await pg.psql(ctx.tools, su, `drop database if exists ${staging}`).catch(() => {});
    throw e;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Version recorded inside an extracted archive (package.json; desktop manifest as fallback). */
function readArchiveVersion(/** @type {string} */ dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version ?? null; } catch { /* none */ }
  try { return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).appVersion ?? null; } catch { /* none */ }
  return null;
}

/**
 * Directory rename that tolerates the transient locks Windows antivirus/indexing take.
 * @param {string} from @param {string} to
 */
async function renameWithRetry(from, to, attempts = 10) {
  for (let i = 1; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      const code = /** @type {NodeJS.ErrnoException} */ (e).code;
      if (i >= attempts || !["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"].includes(String(code))) throw e;
      await new Promise((r) => setTimeout(r, 250 * i));
    }
  }
}

/**
 * live → prev, incoming → live. Returns a function that undoes the swap. If the second
 * rename fails, the first is undone before the error propagates, so `live` is never missing.
 * @param {string} live @param {string} incoming @param {string} prev
 * @param {(from: string, to: string) => Promise<void>} [rename]
 */
async function swapStorage(live, incoming, prev, rename = renameWithRetry) {
  const hadLive = fs.existsSync(live);
  if (hadLive) await rename(live, prev);
  try {
    await rename(incoming, live);
  } catch (e) {
    if (hadLive) await rename(prev, live);
    throw e;
  }
  return async () => {
    await rename(live, incoming);
    if (hadLive) await rename(prev, live);
  };
}

/** @param {string} dir */
function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => NAME_RE.test(n)).sort().reverse().map((n) => {
    const st = fs.statSync(path.join(dir, n));
    return { name: n, path: path.join(dir, n), size: st.size, mtime: st.mtime, hasSidecar: fs.existsSync(path.join(dir, n + ".sha256")) };
  });
}

module.exports = { stamp, createBackup, verifyBackup, restoreBackup, swapStorage, renameWithRetry, readArchiveVersion, pruneBackups, copyOffsite, listBackups, checkDump, MANIFEST_FORMAT, NAME_RE };
