/**
 * v2.5.0 codemod — D-053 second half: every client form that owns a Server-Action result and
 * stays on the page refreshes that page itself once the result settles.
 *
 * Pairs with `codemod-d053-revalidate.mjs`: actions no longer invalidate anything, so the
 * refresh has to come from the client, after the action response has been consumed.
 * `tests/unit/no-revalidate-in-actions.test.ts` pins both halves.
 *
 * Inserts `useRefreshOnSuccess(<state>);` after each `useActionState(...)` binding, plus the
 * import, skipping bindings that already have it.
 *
 * Usage:  node scripts/codemod-d053-refresh.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

/** Forms whose action always redirects (or that carry no success state) need no refresh. */
const SKIP = new Set(["src/app/(auth)/login/login-form.tsx"]);

const files = execSync('grep -rl "useActionState" src/', { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !SKIP.has(f) && !f.endsWith("form-reset.ts"));

const IMPORT = 'import { useRefreshOnSuccess } from "@/components/form-reset";';

let touched = 0;
for (const file of files) {
  let src = readFileSync(file, "utf8");
  const before = src;
  const lines = src.split("\n");
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const m = /^(\s*)const \[([A-Za-z0-9_]+)(?:,[^\]]*)?\] = useActionState/.exec(lines[i]);
    if (!m) continue;
    const [, indent, stateName] = m;

    // walk to the end of the (possibly multi-line) binding statement
    let depth = 0;
    let j = i;
    for (;;) {
      for (const ch of lines[j]) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
      }
      if (depth <= 0) break;
      j++;
      out.push(lines[j]);
    }
    i = j;

    const next = (lines[j + 1] ?? "") + (lines[j + 2] ?? "");
    if (next.includes(`useRefreshOnSuccess(${stateName})`)) continue;
    out.push(`${indent}// D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة`);
    out.push(`${indent}useRefreshOnSuccess(${stateName});`);
  }

  src = out.join("\n");

  if (src !== before && !src.includes(IMPORT)) {
    // put the import after the last existing import line
    const importLines = [...src.matchAll(/^import .*$/gm)];
    const last = importLines.at(-1);
    src = src.slice(0, last.index + last[0].length) + "\n" + IMPORT + src.slice(last.index + last[0].length);
  }
  // a file may have carried a local duplicate of the hook — the shared one wins
  src = src.replace(
    /\n\/\*\*[^*]*(?:\*(?!\/)[^*]*)*\*\/\nfunction useRefreshOnSuccess\(state: ActionState\) \{[\s\S]*?\n\}\n/,
    "\n",
  );
  src = src.replace(/\nfunction useRefreshOnSuccess\(state: ActionState\) \{[\s\S]*?\n\}\n/, "\n");

  if (src !== before) {
    writeFileSync(file, src);
    touched++;
    console.log(`  ${file}`);
  }
}
console.log(`\nfiles updated: ${touched}`);
