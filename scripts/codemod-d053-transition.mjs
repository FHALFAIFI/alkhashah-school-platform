/**
 * v2.5.0 codemod — D-053 third part: buttons that call a Server Action inside a
 * `useTransition` have no returned state for `useRefreshOnSuccess` to watch, and used to rely
 * on `revalidatePath` inside the action. Those calls are gone, so each such component
 * refreshes once its transition finishes (`useRefreshAfterTransition`, D-049 rule 3 — after
 * `pending` clears, never inside the transition).
 *
 * Usage:  node scripts/codemod-d053-transition.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

/** Components that already refresh correctly after the transition settles. */
const SKIP = new Set([
  "src/app/(app)/committees/[id]/task-distribution-ui.tsx",
  "src/app/(app)/building/inspections/templates/template-controls.tsx",
  "src/components/form-reset.ts",
]);

const files = execSync('grep -rl "useTransition()" src/app src/components', { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !SKIP.has(f));

const IMPORT = 'import { useRefreshAfterTransition } from "@/components/form-reset";';

let touched = 0;
for (const file of files) {
  let src = readFileSync(file, "utf8");
  const before = src;
  const lines = src.split("\n");
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const m = /^(\s*)const \[([A-Za-z0-9_]+), [A-Za-z0-9_]+\] = useTransition\(\);/.exec(lines[i]);
    if (!m) continue;
    const [, indent, pendingVar] = m;
    if ((lines[i + 1] ?? "").includes(`useRefreshAfterTransition(${pendingVar})`)) continue;
    out.push(`${indent}// D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار`);
    out.push(`${indent}useRefreshAfterTransition(${pendingVar});`);
  }

  src = out.join("\n");
  if (src !== before) {
    if (src.includes('from "@/components/form-reset"')) {
      // fold into the existing import rather than adding a second one
      src = src.replace(
        /^import \{ ([^}]*) \} from "@\/components\/form-reset";$/m,
        (all, names) =>
          names.includes("useRefreshAfterTransition")
            ? all
            : `import { ${names.trim()}, useRefreshAfterTransition } from "@/components/form-reset";`,
      );
    } else {
      const importLines = [...src.matchAll(/^import .*$/gm)];
      const last = importLines.at(-1);
      src = src.slice(0, last.index + last[0].length) + "\n" + IMPORT + src.slice(last.index + last[0].length);
    }
    writeFileSync(file, src);
    touched++;
    console.log(`  ${file}`);
  }
}
console.log(`\nfiles updated: ${touched}`);
