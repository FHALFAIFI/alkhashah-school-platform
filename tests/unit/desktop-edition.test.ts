/**
 * Windows desktop edition (desktop/) — pure-logic checks that run on any OS.
 * Process lifecycle (PostgreSQL, server, backup/restore) is covered by
 * desktop/tests/lifecycle-harness.cjs and the Windows CI workflow.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { JOB_FAILED, JOB_PENDING, JOB_RUNNING } from "@/lib/reports/instances/jobs";
import { pdftoppmCommand } from "@/lib/pdf-to-image";

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, "..", "..");
const enc = require(path.join(root, "desktop/lib/crypto-enc.js"));
const tar = require(path.join(root, "desktop/lib/tar.js"));
const secrets = require(path.join(root, "desktop/lib/secrets.js"));
const paths = require(path.join(root, "desktop/lib/paths.js"));
const ports = require(path.join(root, "desktop/lib/ports.js"));
const backup = require(path.join(root, "desktop/lib/backup.js"));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "desktop-test-"));
const hasOpenssl = (() => { try { execFileSync("openssl", ["version"]); return true; } catch { return false; } })();

describe("backup encryption is byte-compatible with the Mac/Linux openssl scripts", () => {
  it.skipIf(!hasOpenssl)("desktop-encrypted file decrypts with `openssl enc -d … -pbkdf2 -iter 200000`", async () => {
    const d = tmp();
    const plain = path.join(d, "p.bin");
    fs.writeFileSync(plain, Buffer.from("نسخة احتياطية تجريبية ".repeat(500)));
    await enc.encryptFile(plain, path.join(d, "c.enc"), "pass-phrase-123");
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-in", path.join(d, "c.enc"), "-out", path.join(d, "o.bin"), "-pass", "env:BP"], { env: { ...process.env, BP: "pass-phrase-123" } });
    expect(fs.readFileSync(path.join(d, "o.bin")).equals(fs.readFileSync(plain))).toBe(true);
  });

  it.skipIf(!hasOpenssl)("openssl-encrypted file (as backup-lib.sh writes it) decrypts in the desktop edition", async () => {
    const d = tmp();
    const plain = path.join(d, "p.bin");
    fs.writeFileSync(plain, Buffer.from("x".repeat(70000)));
    execFileSync("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-salt", "-in", plain, "-out", path.join(d, "c.enc"), "-pass", "env:BP"], { env: { ...process.env, BP: "k" } });
    await enc.decryptFile(path.join(d, "c.enc"), path.join(d, "o.bin"), "k");
    expect(fs.readFileSync(path.join(d, "o.bin")).equals(fs.readFileSync(plain))).toBe(true);
  });

  it("a wrong key is reported as BAD_KEY_OR_CORRUPT, never as garbage output", async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "p"), "secret data");
    await enc.encryptFile(path.join(d, "p"), path.join(d, "c"), "right");
    await expect(enc.decryptFile(path.join(d, "c"), path.join(d, "o"), "wrong")).rejects.toMatchObject({ code: "BAD_KEY_OR_CORRUPT" });
    expect(fs.existsSync(path.join(d, "o"))).toBe(false);
  });
});

describe("tar writer/reader", () => {
  async function roundTrip(entries: { archivePath: string; file?: string; dir?: boolean }[]) {
    const chunks: Buffer[] = [];
    for await (const c of tar.tarStream(entries)) chunks.push(c);
    return Buffer.concat(chunks);
  }

  it("round-trips files including long and Arabic names, with hashes", async () => {
    const d = tmp();
    const long = "a".repeat(120) + ".txt";
    fs.writeFileSync(path.join(d, long), "long");
    fs.writeFileSync(path.join(d, "مرفق.txt"), "عربي");
    fs.writeFileSync(path.join(d, "zeros.bin"), Buffer.alloc(1024));
    const t = await roundTrip([
      { archivePath: "storage", dir: true },
      { archivePath: `storage/${long}`, file: path.join(d, long) },
      { archivePath: "storage/مرفق.txt", file: path.join(d, "مرفق.txt") },
      { archivePath: "storage/zeros.bin", file: path.join(d, "zeros.bin") },
    ]);
    const out = tmp();
    const { files } = await tar.extractTar(Readable.from([t]), out, () => true);
    expect(fs.readFileSync(path.join(out, "storage", long), "utf8")).toBe("long");
    expect(fs.readFileSync(path.join(out, "storage", "مرفق.txt"), "utf8")).toBe("عربي");
    expect(fs.readFileSync(path.join(out, "storage", "zeros.bin")).length).toBe(1024);
    expect(files.size).toBe(3);
  });

  it.skipIf(process.platform === "win32")("output is readable by the system tar (as restore.sh uses it)", async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "f.txt"), "hello");
    const t = await roundTrip([{ archivePath: "storage", dir: true }, { archivePath: "storage/" + "b".repeat(150) + ".txt", file: path.join(d, "f.txt") }]);
    fs.writeFileSync(path.join(d, "a.tar"), t);
    const listing = execFileSync("tar", ["-tf", path.join(d, "a.tar")]).toString();
    expect(listing).toContain("b".repeat(150) + ".txt");
  });

  it.skipIf(process.platform === "win32")("reads GNU-tar archives with long names (Mac/Linux weekly backups)", async () => {
    const d = tmp();
    const deep = path.join(d, "storage", "x".repeat(60), "y".repeat(60));
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, "z".repeat(40) + ".pdf"), "%PDF-1.4");
    execFileSync("tar", ["-cf", path.join(d, "g.tar"), "--format=gnu", "-C", d, "storage"]);
    const out = tmp();
    await tar.extractTar(Readable.from([fs.readFileSync(path.join(d, "g.tar"))]), out, () => true);
    expect(fs.readFileSync(path.join(out, "storage", "x".repeat(60), "y".repeat(60), "z".repeat(40) + ".pdf"), "utf8")).toBe("%PDF-1.4");
  });

  it("rejects path traversal, absolute paths and drive letters", () => {
    expect(tar.safeName("../evil")).toBeNull();
    expect(tar.safeName("storage/../../evil")).toBeNull();
    expect(tar.safeName("/etc/passwd")).toBeNull();
    expect(tar.safeName("C:/Windows/x")).toBeNull();
    expect(tar.safeName("storage\\..\\x")).toBeNull();
    expect(tar.safeName("./storage/a/b.pdf")).toBe("storage/a/b.pdf");
  });

  it("refuses to write an archive member that escapes the destination", async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "f"), "x");
    const t = await roundTrip([{ archivePath: "../escape.txt", file: path.join(d, "f") }]);
    await expect(tar.extractTar(Readable.from([t]), tmp(), () => true)).rejects.toThrow(/unsafe path/);
  });

  it("detects truncation", async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "f"), "x".repeat(5000));
    const t = await roundTrip([{ archivePath: "db.dump", file: path.join(d, "f") }]);
    await expect(tar.extractTar(Readable.from([t.subarray(0, 2048)]), tmp(), () => true)).rejects.toThrow(/truncated/);
  });
});

describe("secrets and recovery key", () => {
  it("generates strong distinct secrets and reloads them unchanged", () => {
    const d = tmp();
    const f = path.join(d, "secrets.bin");
    const a = secrets.loadOrCreateSecrets(f, secrets.plainProtector());
    const b = secrets.loadOrCreateSecrets(f, secrets.plainProtector());
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.secrets).toEqual(a.secrets);
    expect(new Set([a.secrets.pgSuperPassword, a.secrets.pgAppPassword, a.secrets.backupKey]).size).toBe(3);
    expect(a.secrets.backupKey.length).toBeGreaterThanOrEqual(40);
  });

  it("recovery-key file round-trips and also accepts a pasted bare key", () => {
    const text = secrets.recoveryKeyText("AbC_123-xyz_KEY_value", "2026-11-14");
    expect(text).toContain("مفتاح استعادة");
    expect(secrets.parseRecoveryKey(text)).toBe("AbC_123-xyz_KEY_value");
    expect(secrets.parseRecoveryKey("  AbC_123-xyz_KEY_value \n")).toBe("AbC_123-xyz_KEY_value");
    expect(secrets.parseRecoveryKey("short")).toBeNull();
  });
});

describe("paths and ports", () => {
  it("data lives under %LOCALAPPDATA%\\FathersApp on Windows", () => {
    expect(paths.defaultDataRoot({ platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" } })).toBe("C:\\Users\\u\\AppData\\Local\\FathersApp");
    expect(paths.hasNonAscii("C:\\Users\\فهد\\AppData")).toBe(true);
    expect(paths.hasNonAscii("C:\\Users\\fahad\\AppData")).toBe(false);
  });

  it("full backups use the weekly/full-*.tar.gz.enc naming the pilot-status card and restore.sh expect", () => {
    const l = paths.dataLayout("/x");
    expect(l.backupsFull).toBe(path.join("/x", "backups", "weekly"));
    expect(backup.NAME_RE.test("full-20261114-101500.tar.gz.enc")).toBe(true);
    expect(backup.NAME_RE.test("full-20261114-101500-pre-restore.tar.gz.enc")).toBe(true);
    expect(backup.NAME_RE.test("db-20261114-101500.dump.enc")).toBe(false);
  });

  it("retention removes only the oldest of our own backups (and their sidecars)", () => {
    const d = tmp();
    const names = ["full-20260101-000000.tar.gz.enc", "full-20260102-000000.tar.gz.enc", "full-20260103-000000.tar.gz.enc"];
    for (const n of names) { fs.writeFileSync(path.join(d, n), "x"); fs.writeFileSync(path.join(d, n + ".sha256"), "y"); }
    fs.writeFileSync(path.join(d, "unrelated.txt"), "keep");
    expect(backup.pruneBackups(d, 2)).toEqual([names[0]]);
    expect(fs.readdirSync(d).sort()).toEqual([names[1], names[1] + ".sha256", names[2], names[2] + ".sha256", "unrelated.txt"].sort());
  });

  it("falls back to a free loopback port when the preferred one is taken", async () => {
    const net = await import("node:net");
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const taken = (srv.address() as { port: number }).port;
    const picked = await ports.pickPort(taken);
    expect(picked).not.toBe(taken);
    expect(await ports.isPortFree(picked)).toBe(true);
    srv.close();
  });
});

describe("cross-file contracts", () => {
  it("the server entry's job-status constants equal jobs.ts (drain must see the same states)", () => {
    const entry = fs.readFileSync(path.join(root, "desktop/server/desktop-server-entry.cjs"), "utf8");
    expect(entry).toContain(`const JOB_PENDING = "${JOB_PENDING}"`);
    expect(entry).toContain(`const JOB_RUNNING = "${JOB_RUNNING}"`);
    expect(entry).toContain(`const JOB_FAILED = "${JOB_FAILED}"`);
  });

  it("pdftoppm: PATH lookup by default (Mac/Linux unchanged), bundled path when POPPLER_BIN_DIR is set", () => {
    expect(pdftoppmCommand({} as unknown as NodeJS.ProcessEnv, "linux")).toBe("pdftoppm");
    expect(pdftoppmCommand({ POPPLER_BIN_DIR: "/opt/poppler/bin" } as unknown as NodeJS.ProcessEnv, "linux")).toBe(path.join("/opt/poppler/bin", "pdftoppm"));
    expect(pdftoppmCommand({ POPPLER_BIN_DIR: "/opt/poppler/bin" } as unknown as NodeJS.ProcessEnv, "win32").endsWith("pdftoppm.exe")).toBe(true);
  });

  it("installer hook only stops PostgreSQL that belongs to a Father's App install, and never kills", () => {
    const nsh = fs.readFileSync(path.join(root, "desktop/resources/installer.nsh"), "utf8");
    const enc = /-EncodedCommand ([A-Za-z0-9+/=]+)/.exec(nsh)?.[1];
    expect(enc).toBeTruthy();
    const ps = Buffer.from(enc!, "base64").toString("utf16le");
    expect(ps).toContain("Join-Path $install 'FathersApp.exe'");
    expect(ps).toContain("stop -D $data -m fast -w");
    expect(ps).not.toMatch(/Stop-Process|taskkill|Kill\(/i);
    const source = fs.readFileSync(path.join(root, "desktop/resources/stop-owned-postgres.ps1"), "utf8").replace(/\r\n/g, "\n");
    const flattened = source.split("\n").filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/^ +/, "")).join(";").replace(/\{;/g, "{ ").replace(/;\}/g, " }").replace(/;;+/g, ";");
    expect(ps).toBe(flattened);
  });

  it("desktop package version tracks the application version", () => {
    const app = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const desk = JSON.parse(fs.readFileSync(path.join(root, "desktop/package.json"), "utf8"));
    expect(desk.version).toBe(app.version);
  });

  it("standalone output is opt-in, so the Docker production build is unchanged", () => {
    const cfg = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
    expect(cfg).toMatch(/process\.env\.NEXT_OUTPUT === "standalone"/);
    expect(cfg).toMatch(/\.\.\.\(standalone\s*\?/);
  });
});

describe("release-candidate safety logic", () => {
  const readiness = require(path.join(root, "desktop/lib/readiness.js"));

  it("version comparison: pre-release < release < newer; unknown versions disable the guard", () => {
    expect(readiness.compareVersions("2.6.0-0", "2.6.0")).toBe(-1);
    expect(readiness.compareVersions("2.6.0", "2.6.0")).toBe(0);
    expect(readiness.compareVersions("2.10.0", "2.9.9")).toBe(1);
    expect(readiness.compareVersions("2.5.0", "2.6.0")).toBe(-1);
    expect(readiness.compareVersions(undefined, "2.6.0")).toBeNull();
    expect(readiness.compareVersions("harness", "2.6.0")).toBeNull();
  });

  it("backup readiness keeps nagging until key is off-device and off-device copies keep succeeding", () => {
    const now = Date.parse("2026-11-15T00:00:00Z");
    const codes = (state: object, settings: object) => readiness.backupReadiness({ state, settings, now, dataRoot: "C:\\x" }).map((i: { code: string }) => i.code);
    expect(codes({}, {})).toEqual(["recovery-key-missing", "offsite-missing"]);
    expect(codes({ recoveryKeyExportedAt: "x", recoveryKeyOnSameDrive: true }, { offsiteDir: "E:\\b" })).toEqual(["recovery-key-same-drive", "offsite-stale"]);
    expect(codes({ recoveryKeyExportedAt: "x", lastOffsiteError: "offsite-unavailable" }, { offsiteDir: "E:\\b" })).toEqual(["offsite-failing"]);
    expect(codes({ recoveryKeyExportedAt: "x", lastOffsiteOkAt: "2026-11-14T00:00:00Z", lastBackupAt: "2026-11-14T00:00:00Z", bootstrapped: true }, { offsiteDir: "E:\\b" })).toEqual([]);
    expect(codes({ recoveryKeyExportedAt: "x", lastOffsiteOkAt: "2026-11-14T00:00:00Z", lastBackupAt: "2026-11-01T00:00:00Z", bootstrapped: true }, { offsiteDir: "E:\\b" })).toEqual(["backup-stale"]);
    expect(codes({ recoveryKeyExportedAt: "x", lastOffsiteOkAt: "2026-11-14T00:00:00Z", lastBackupError: "disk full" }, { offsiteDir: "E:\\b" })).toEqual(["backup-failing"]);
    for (const i of readiness.backupReadiness({ state: {}, settings: {}, now, dataRoot: "C:\\x" })) expect(i.ar).toMatch(/[\u0600-\u06ff]/);
  });

  it("same-volume detection on Windows paths (drive letters and UNC shares)", () => {
    expect(readiness.sameVolume("C:\\Users\\u\\AppData\\Local\\FathersApp", "c:/Users/u/Documents", "win32")).toBe(true);
    expect(readiness.sameVolume("C:\\Users\\u", "E:\\backup", "win32")).toBe(false);
    expect(readiness.sameVolume("\\\\nas\\share\\a", "\\\\NAS\\share\\b", "win32")).toBe(true);
    expect(readiness.sameVolume("\\\\nas\\share\\a", "C:\\a", "win32")).toBe(false);
  });

  it("secrets are redacted from text bound for logs", () => {
    const out = readiness.redactSecrets("ERROR: x LINE 1: create role madrasa password 'Abc''defgh123' -- AbcSecretValue", ["AbcSecretValue"]);
    expect(out).not.toContain("defgh123");
    expect(out).not.toContain("AbcSecretValue");
  });

  it("storage swap is fully reverted when the second rename fails (Windows file lock)", async () => {
    const d = tmp();
    const live = path.join(d, "storage"), incoming = path.join(d, "incoming"), prev = path.join(d, "storage.prev");
    fs.mkdirSync(live); fs.writeFileSync(path.join(live, "old.txt"), "old");
    fs.mkdirSync(incoming); fs.writeFileSync(path.join(incoming, "new.txt"), "new");
    let calls = 0;
    const flaky = async (from: string, to: string) => {
      calls++;
      if (calls === 2) throw Object.assign(new Error("locked"), { code: "EBUSY" });
      fs.renameSync(from, to);
    };
    await expect(backup.swapStorage(live, incoming, prev, flaky)).rejects.toThrow("locked");
    expect(fs.readFileSync(path.join(live, "old.txt"), "utf8")).toBe("old");
    expect(fs.existsSync(path.join(incoming, "new.txt"))).toBe(true);
    expect(fs.existsSync(prev)).toBe(false);
  });

  it("storage swap revert function restores the previous storage after a later (database) failure", async () => {
    const d = tmp();
    const live = path.join(d, "storage"), incoming = path.join(d, "incoming"), prev = path.join(d, "storage.prev");
    fs.mkdirSync(live); fs.writeFileSync(path.join(live, "old.txt"), "old");
    fs.mkdirSync(incoming); fs.writeFileSync(path.join(incoming, "new.txt"), "new");
    const revert = await backup.swapStorage(live, incoming, prev);
    expect(fs.existsSync(path.join(live, "new.txt"))).toBe(true);
    await revert();
    expect(fs.readFileSync(path.join(live, "old.txt"), "utf8")).toBe("old");
    expect(fs.existsSync(path.join(incoming, "new.txt"))).toBe(true);
  });

  it("archive version is read from package.json (server backups) or the desktop manifest", () => {
    const d = tmp();
    expect(backup.readArchiveVersion(d)).toBeNull();
    fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify({ appVersion: "2.6.0" }));
    expect(backup.readArchiveVersion(d)).toBe("2.6.0");
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ version: "2.5.0" }));
    expect(backup.readArchiveVersion(d)).toBe("2.5.0");
  });

  it("packaged builds ignore runtime-path overrides; the server never logs failing statements", () => {
    const paths2 = require(path.join(root, "desktop/lib/paths.js"));
    const r = paths2.resourceLayout("/opt/res", { env: {}, platform: "win32" });
    expect(r.node).toBe(path.join("/opt/res", "node", "node.exe"));
    const pgSrc = fs.readFileSync(path.join(root, "desktop/lib/postgres.js"), "utf8");
    expect(pgSrc).toContain("log_min_error_statement = panic");
    const mainSrc = fs.readFileSync(path.join(root, "desktop/main/main.js"), "utf8");
    expect(mainSrc).toMatch(/if \(app\.isPackaged\) return process\.resourcesPath;/);
    expect(mainSrc).toContain("allowDevOverrides: !app.isPackaged");
    const builder = fs.readFileSync(path.join(root, "desktop/electron-builder.yml"), "utf8");
    expect(builder).toMatch(/runAsNode: false/);
    expect(builder).toMatch(/enableNodeOptionsEnvironmentVariable: false/);
    expect(builder).toMatch(/onlyLoadAppFromAsar: true/);
  });
});

describe("Arabic user guide wording", () => {
  const guide = fs.readFileSync(path.join(root, "desktop/guide/دليل-الاستخدام.html"), "utf8");
  it("makes no absolute safety guarantees about power loss, shutdown or logs", () => {
    expect(guide).not.toContain("لا يُفسد البيانات");
    expect(guide).not.toContain("والمنصة مفتوحة آمن");
    expect(guide).not.toContain("(لا يحتوي كلمات مرور)");
    expect(guide).toContain("لا يمكن ضمان ذلك");
  });
  it("tells the user how to verify the installer checksum and where to keep the recovery key", () => {
    expect(guide).toContain("Get-FileHash");
    expect(guide).toContain("قناة مختلفة");
    expect(guide).toContain("لا تحفظ المفتاح والنسخ معاً");
    expect(guide).toContain("Smart App Control");
  });
});
