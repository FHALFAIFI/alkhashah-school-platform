/**
 * Idempotent, additive seed for the pilot-feedback RBAC permissions.
 * Adds `feedback.create` + `feedback.manage` and grants them to the principal and
 * sysadmin roles. Touches no existing business data. Safe to run on the real DB
 * after the additive feedback migration.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx src/db/seed-feedback-rbac.ts
 */
import { seedFeedbackRbac } from "@/lib/feedback/service";
import { pool } from "@/db";

async function main() {
  await seedFeedbackRbac();
  console.log("Feedback RBAC permissions seeded (feedback.create, feedback.manage).");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
