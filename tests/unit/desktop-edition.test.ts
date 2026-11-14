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
