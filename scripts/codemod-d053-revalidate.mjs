/**
 * v2.5.0 codemod — D-053: remove every `revalidatePath` / `revalidateOtherPaths` call from
 * the application layer.
 *
 * Why this exists as a codemod rather than 200 hand edits: the rule is mechanical and must be
 * applied everywhere at once, and `tests/unit/no-revalidate-in-actions.test.ts` pins it
 * afterwards so it cannot come back one file at a time. The reasoning is documented in
 * `src/lib/revalidate.ts` and `docs/DECISIONS.md` (D-049 → D-053).
 *
 * Usage:  node scripts/codemod-d053-revalidate.mjs "src/app"
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const root = process.argv[2] ?? "src/app";
const files = execSync(`grep -rl "revalidatePath\\|revalidateOtherPaths" "${root}"`, { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

let totalRemoved = 0;
for (const file of files) {
  let src = readFileSync(file, "utf8");
  const before = src;
  let removed = 0;

  for (const fn of ["revalidatePath", "revalidateOtherPaths"]) {
    for (;;) {
      // A call used as a statement: it starts a line (after indentation) and is not an import.
      const re = new RegExp(`^([ \\t]*)${fn}\\(`, "m");
      const m = re.exec(src);
      if (!m) break;
      const start = m.index;
      let i = start + m[0].length;
      let depth = 1;
      let quote = null;
      while (i < src.length && depth > 0) {
        const ch = src[i];
        if (quote) {
          if (ch === "\\") i++;
          else if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
        else if (ch === "(") depth++;
        else if (ch === ")") depth--;
        i++;
      }
      while (i < src.length && (src[i] === ";" || src[i] === " ")) i++;
      if (src[i] === "\n") i++;
      src = src.slice(0, start) + src.slice(i);
      removed++;
    }
  }

  // Drop imports that nothing references any more.
  if (!/revalidatePath\b/.test(src.replace(/^import .*revalidatePath.*$/gm, ""))) {
    src = src.replace(/^import \{ revalidatePath \} from "next\/cache";\n/m, "");
    src = src.replace(/^import \{ revalidatePath, (.*) \} from "next\/cache";\n/m, 'import { $1 } from "next/cache";\n');
  }
  if (!/revalidateOtherPaths\b/.test(src.replace(/^import .*revalidateOtherPaths.*$/gm, ""))) {
    src = src.replace(/^import \{ revalidateOtherPaths \} from "@\/lib\/revalidate";\n/m, "");
  }

  if (src !== before) {
    writeFileSync(file, src);
    totalRemoved += removed;
    console.log(`${String(removed).padStart(3)}  ${file}`);
  }
}
console.log(`\ntotal statements removed: ${totalRemoved}`);
