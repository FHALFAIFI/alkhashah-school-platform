// Asserts that every runtime file of the assembled app tree made it into the packaged
// application unchanged in name (electron-builder applies default exclusions to resources).
//
//   node desktop/scripts/check-packaged-tree.mjs desktop/build/server desktop/dist/win-unpacked/resources/server
import fs from "node:fs";
import path from "node:path";

const [src, dst] = process.argv.slice(2);
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
      if (!fs.existsSync(path.join(dst, ...r.split("/")))) missing.push(r);
    }
  }
};
walk(src, "");
console.log(`checked ${n} runtime files`);
if (missing.length) {
  console.error(`missing in packaged app (${missing.length}):\n  ${missing.slice(0, 50).join("\n  ")}`);
  process.exit(1);
}
console.log("packaged app tree complete");
