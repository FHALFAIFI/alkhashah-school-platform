// Static native-dependency audit for the bundled Windows binaries.
//
//   node desktop/scripts/check-pe-deps.mjs <dir> [<dir> …]
//
// Parses the PE import and delay-import tables of every .exe/.dll/.node under the given
// directories and fails if any imported DLL is neither (a) next to the importing file,
// (b) a DLL of a bundled directory listed via --search, nor (c) part of Windows itself.
// The Visual C++ runtime (vcruntime140*, msvcp140*, concrt140) is deliberately NOT treated
// as part of Windows: a clean Windows install may lack it, so it must be shipped app-locally.
// This is what lets a GitHub runner — which has the VC++ runtime installed — still prove
// that the installer works on a clean machine.
import fs from "node:fs";
import path from "node:path";

const SYSTEM = new Set([
  "kernel32.dll", "kernelbase.dll", "ntdll.dll", "user32.dll", "gdi32.dll", "gdiplus.dll", "advapi32.dll", "shell32.dll",
  "shlwapi.dll", "ole32.dll", "oleaut32.dll", "comctl32.dll", "comdlg32.dll", "ws2_32.dll", "wsock32.dll", "mswsock.dll",
  "crypt32.dll", "bcrypt.dll", "bcryptprimitives.dll", "ncrypt.dll", "secur32.dll", "sspicli.dll", "netapi32.dll", "iphlpapi.dll",
  "dnsapi.dll", "winmm.dll", "version.dll", "userenv.dll", "psapi.dll", "dbghelp.dll", "setupapi.dll", "rpcrt4.dll",
  "wldap32.dll", "normaliz.dll", "imm32.dll", "winhttp.dll", "wininet.dll", "urlmon.dll", "uxtheme.dll", "dwmapi.dll",
  "d3d11.dll", "d3d12.dll", "dxgi.dll", "d3d9.dll", "dwrite.dll", "d2d1.dll", "opengl32.dll", "glu32.dll", "msimg32.dll",
  "usp10.dll", "powrprof.dll", "propsys.dll", "wtsapi32.dll", "hid.dll", "cfgmgr32.dll", "dhcpcsvc.dll", "winspool.drv",
  "mpr.dll", "oleacc.dll", "uiautomationcore.dll", "credui.dll", "cryptbase.dll", "ntdsapi.dll", "authz.dll", "msvcrt.dll",
  "ucrtbase.dll", "mf.dll", "mfplat.dll", "mfreadwrite.dll", "mfuuid.dll", "dxva2.dll", "esent.dll", "wevtapi.dll",
  "ncrypt.dll", "fwpuclnt.dll", "rstrtmgr.dll", "wintrust.dll", "pdh.dll", "shcore.dll", "dcomp.dll", "dbgeng.dll",
  "windowscodecs.dll", "netutils.dll", "srvcli.dll", "wer.dll", "comsvcs.dll", "xinput1_4.dll", "dinput8.dll",
  "mscms.dll", "dhcpcsvc6.dll", "winusb.dll", "virtdisk.dll", "sensapi.dll", "msdmo.dll", "ksuser.dll", "avrt.dll",
  "audioses.dll", "mmdevapi.dll", "dsound.dll", "msacm32.dll", "mfcore.dll", "evr.dll", "d3dcompiler_47.dll",
  "fontsub.dll", "bthprops.cpl", "wsnmp32.dll", "icmp.dll", "tdh.dll", "webauthn.dll", "ndfapi.dll", "nsi.dll", "winsta.dll",
]);
const isApiSet = (n) => /^(api|ext)-ms-win-/i.test(n);

function rvaToOffset(sections, rva) {
  for (const s of sections) if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawSize)) return rva - s.va + s.raw;
  return -1;
}
function cstr(buf, off) {
  const end = buf.indexOf(0, off);
  return buf.toString("latin1", off, end < 0 ? off + 256 : end);
}

/** @returns {string[] | null} imported DLL names, or null if not a PE file */
export function peImports(file) {
  const b = fs.readFileSync(file);
  if (b.length < 64 || b.readUInt16LE(0) !== 0x5a4d) return null;
  const pe = b.readUInt32LE(0x3c);
  if (b.readUInt32LE(pe) !== 0x4550) return null;
  const nSections = b.readUInt16LE(pe + 6);
  const optSize = b.readUInt16LE(pe + 20);
  const opt = pe + 24;
  const magic = b.readUInt16LE(opt);
  const dd = opt + (magic === 0x20b ? 112 : 96);
  const secTable = opt + optSize;
  const sections = [];
  for (let i = 0; i < nSections; i++) {
    const s = secTable + i * 40;
    sections.push({ vsize: b.readUInt32LE(s + 8), va: b.readUInt32LE(s + 12), rawSize: b.readUInt32LE(s + 16), raw: b.readUInt32LE(s + 20) });
  }
  const names = new Set();
  const impRva = b.readUInt32LE(dd + 8);
  if (impRva) {
    let off = rvaToOffset(sections, impRva);
    for (let guard = 0; off >= 0 && guard < 4096; guard++, off += 20) {
      const nameRva = b.readUInt32LE(off + 12);
      if (!nameRva && !b.readUInt32LE(off)) break;
      const no = rvaToOffset(sections, nameRva);
      if (no >= 0) names.add(cstr(b, no));
    }
  }
  const delayRva = b.readUInt32LE(dd + 13 * 8);
  if (delayRva) {
    let off = rvaToOffset(sections, delayRva);
    for (let guard = 0; off >= 0 && guard < 4096; guard++, off += 32) {
      const nameRva = b.readUInt32LE(off + 4);
      if (!nameRva) break;
      const no = rvaToOffset(sections, nameRva);
      if (no >= 0) names.add(cstr(b, no));
    }
  }
  return [...names];
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(exe|dll|node)$/i.test(e.name)) out.push(p);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-pe-deps.mjs")) {
  const args = process.argv.slice(2);
  const search = [];
  let nodeHost = null;
  const roots = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--search") search.push(args[++i]);
    else if (args[i] === "--node-host") nodeHost = args[++i];
    else roots.push(args[i]);
  }
  if (!roots.length) { console.error("usage: check-pe-deps.mjs <dir>… [--search <dir>]"); process.exit(2); }
  const extra = new Set(search.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).map((n) => n.toLowerCase()) : [])));
  const problems = [];
  let files = 0;
  for (const root of roots) {
    for (const f of walk(root)) {
      const imports = peImports(f);
      if (!imports) continue;
      files++;
      const local = new Set(fs.readdirSync(path.dirname(f)).map((n) => n.toLowerCase()));
      // Modules loaded into a host process also resolve against what the host already loaded:
      // PostgreSQL extension DLLs (…/pgsql/lib) run inside postgres.exe from …/pgsql/bin, and
      // Node addons run inside node.exe, whose directory is searched first.
      const hostDirs = [];
      const parts = f.split(/[\\/]/);
      const li = parts.lastIndexOf("lib");
      if (li > 0 && parts[li - 1] === "pgsql") hostDirs.push([...parts.slice(0, li), "bin"].join(path.sep));
      if (/\.node$/i.test(f) && nodeHost) hostDirs.push(nodeHost);
      for (const h of hostDirs) if (fs.existsSync(h)) for (const n of fs.readdirSync(h)) local.add(n.toLowerCase());
      for (const dll of imports) {
        const n = dll.toLowerCase();
        if (local.has(n) || extra.has(n) || SYSTEM.has(n) || isApiSet(n)) continue;
        // Node addons resolve symbols from the host executable
        if (/\.node$/i.test(f) && (n === "node.exe" || n === "node.dll")) continue;
        if (n === "postgres.exe" && hostDirs.length) continue;
        problems.push(`${path.relative(process.cwd(), f)} → ${dll}`);
      }
    }
  }
  console.log(`checked ${files} PE files`);
  if (problems.length) {
    console.error(`unresolved DLL imports (${problems.length}):\n  ` + problems.join("\n  "));
    process.exit(1);
  }
  console.log("all DLL imports resolve to bundled files or Windows system DLLs");
}
