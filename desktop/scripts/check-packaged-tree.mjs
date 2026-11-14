// Asserts that every runtime file of the assembled app tree made it into the packaged
// application unchanged in name (electron-builder applies default exclusions to resources).
//
//   node desktop/scripts/check-packaged-tree.mjs desktop/build/server desktop/dist/win-unpacked/resources/server
import fs from "node:fs";
import path from "node:path";

//   node desktop/scripts/check-packaged-tree.mjs --write-list <app tree> <list.txt>
//   node desktop/scripts/check-packaged-tree.mjs --from-list <list.txt> <installed tree>
const args = process.argv.slice(2);
if (args[0] === "--from-list") {
  const list = fs.readFileSync(args[1], "utf8").split(/\r?\n/).filter(Boolean);
  const missing = list.filter((r) => !fs.existsSync(path.join(args[2], ...r.split("/"))));
  console.log(`checked ${list.length} runtime files`);
  if (missing.length) { console.error(`missing in installed app (${missing.length}):\n  ${missing.slice(0, 50).join("\n  ")}`); process.exit(1); }
  console.log("installed app tree complete");
  process.exit(0);
}
const writeList = args[0] === "--write-list";
const [src, dst] = writeList ? args.slice(1) : args;
if (!src || !dst) { console.error("usage: check-packaged-tree.mjs <app tree> <packaged tree>"); process.exit(2); }
const RUNTIME = /\.(js|cjs|mjs|json|node|dll|woff2?|wasm|html|css)$/i;
const missing = [];
let n = 0;
const walk = (d, rel) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(d, e.name), r);
    else if (RUNTIME.test(e.name)) {
      n++;
      if (writeList) { all.push(r); continue; }
      if (!fs.existsSync(path.join(dst, ...r.split("/")))) missing.push(r);
    }
  }
};
const all = [];
walk(src, "");
if (writeList) { fs.writeFileSync(dst, all.join("\n") + "\n"); console.log(`listed ${all.length} runtime files`); process.exit(0); }
console.log(`checked ${n} runtime files`);
if (missing.length) {
  console.error(`missing in packaged app (${missing.length}):\n  ${missing.slice(0, 50).join("\n  ")}`);
  process.exit(1);
}
console.log("packaged app tree complete");
