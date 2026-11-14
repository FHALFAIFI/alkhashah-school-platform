// Downloads, verifies (SHA-256) and lays out the third-party Windows runtimes listed in
// desktop/binaries.manifest.json into desktop/vendor/.
//
//   node desktop/scripts/fetch-binaries.mjs                  # fetch + verify + extract all
//   node desktop/scripts/fetch-binaries.mjs --discover ID    # print url+sha256 of the first
//                                                            # reachable candidate (pinning aid)
//   node desktop/scripts/fetch-binaries.mjs --vc-runtime DIR # copy app-local VC++ runtime DLLs
//                                                            # from a Microsoft.VC143.CRT folder
//
// A missing or mismatching pin is a hard failure. Writes vendor/BINARIES.lock.json
// (provenance: url, version, archive hash, per-file hashes of every shipped executable/DLL).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(desktop, "binaries.manifest.json"), "utf8"));
const cache = path.join(desktop, ".cache", "downloads");
const vendor = path.join(desktop, "vendor");
const args = process.argv.slice(2);

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status}: ${url}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest + ".part"));
  fs.renameSync(dest + ".part", dest);
}

function sha256(file) {
  const h = createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(1 << 20);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest("hex");
}

function unzip(zip, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") {
    // bsdtar ships with Windows 10+ and extracts zip archives
    execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", dir], { stdio: "inherit" });
  } else {
    execFileSync("unzip", ["-q", zip, "-d", dir], { stdio: "inherit" });
  }
}

if (args[0] === "--discover") {
  const item = manifest.items.find((i) => i.id === args[1]);
  if (!item) throw new Error(`unknown item ${args[1]}`);
  for (const url of item.candidates ?? [item.url]) {
    const head = await fetch(url, { method: "HEAD", redirect: "follow" }).catch(() => null);
    console.log(`${head?.status ?? "ERR"} ${url}`);
    if (head?.ok) {
      fs.mkdirSync(cache, { recursive: true });
      const dest = path.join(cache, path.basename(new URL(url).pathname));
      await download(url, dest);
      console.log(`DISCOVERED url=${url}`);
      console.log(`DISCOVERED sha256=${sha256(dest)}`);
      console.log(`DISCOVERED bytes=${fs.statSync(dest).size}`);
      process.exit(0);
    }
  }
  console.error("no candidate reachable");
  process.exit(1);
}

if (args[0] === "--vc-runtime") {
  const src = args[1];
  if (!src || !fs.existsSync(src)) throw new Error("pass the Microsoft.VC143.CRT directory");
  const lockFile = path.join(vendor, "BINARIES.lock.json");
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  lock.vcRuntime = { source: src, files: {} };
  for (const target of manifest.vcRuntime.targets) {
    for (const dll of manifest.vcRuntime.dlls) {
      const from = path.join(src, dll);
      if (!fs.existsSync(from)) continue;
      const to = path.join(vendor, target, dll);
      if (fs.existsSync(to)) continue; // the vendor already ships its own copy — keep it
      fs.copyFileSync(from, to);
      lock.vcRuntime.files[`${target}/${dll}`] = sha256(to);
    }
  }
  fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2));
  console.log(`app-local VC++ runtime deployed: ${Object.keys(lock.vcRuntime.files).length} files`);
  process.exit(0);
}

const only = args.filter((a) => !a.startsWith("--"));
fs.mkdirSync(cache, { recursive: true });
const lock = { generatedAt: new Date().toISOString(), items: {} };
for (const item of manifest.items) {
  if (only.length && !only.includes(item.id)) continue;
  if (!item.url || !/^[0-9a-f]{64}$/.test(item.sha256 ?? "")) {
    throw new Error(`${item.id}: url/sha256 not pinned in binaries.manifest.json — run --discover ${item.id} on a trusted machine and pin it`);
  }
  const archive = path.join(cache, path.basename(new URL(item.url).pathname));
  if (!fs.existsSync(archive) || sha256(archive) !== item.sha256) {
    console.log(`downloading ${item.id} ${item.version}…`);
    await download(item.url, archive);
  }
  const got = sha256(archive);
  if (got !== item.sha256) {
    fs.rmSync(archive, { force: true });
    throw new Error(`${item.id}: SHA-256 mismatch (expected ${item.sha256}, got ${got}) — refusing`);
  }
  console.log(`verified ${item.id} ${got}`);
  const ex = path.join(desktop, ".cache", "extract", item.id);
  unzip(archive, ex);
  // PostgreSQL zips sometimes wrap everything in one extra folder; locate the mapping roots
  for (const m of item.layout) {
    const from = path.join(ex, m.from);
    if (!fs.existsSync(from)) throw new Error(`${item.id}: archive has no ${m.from}`);
    const to = path.join(vendor, m.to);
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, {
      recursive: true,
      filter: (p) => !(item.exclude ?? []).some((x) => path.basename(p).toLowerCase() === x.toLowerCase().replace("*", "") || (x.endsWith("*") && path.basename(p).toLowerCase().startsWith(x.slice(0, -1).toLowerCase()))),
    });
  }
  for (const mk of item.markers ?? []) {
    fs.mkdirSync(path.dirname(path.join(vendor, mk)), { recursive: true });
    fs.writeFileSync(path.join(vendor, mk), "");
  }
  const files = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(exe|dll|node)$/i.test(e.name)) files[path.relative(vendor, p).split(path.sep).join("/")] = sha256(p);
    }
  };
  for (const m of item.layout) {
    const to = path.join(vendor, m.to);
    if (fs.statSync(to).isDirectory()) walk(to);
    else if (/\.(exe|dll)$/i.test(to)) files[m.to] = sha256(to);
  }
  lock.items[item.id] = { name: item.name, version: item.version, url: item.url, sha256: item.sha256, license: item.license, sourceUrl: item.sourceUrl, files };
}
fs.mkdirSync(vendor, { recursive: true });
const lockFile = path.join(vendor, "BINARIES.lock.json");
const prev = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, "utf8")) : { items: {} };
fs.writeFileSync(lockFile, JSON.stringify({ ...prev, ...lock, items: { ...prev.items, ...lock.items } }, null, 2));
console.log(`vendor tree ready: ${vendor}`);
