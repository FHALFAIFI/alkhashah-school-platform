import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  if (!row) return fallback;
  return row.value as T;
}

export async function setSetting(key: string, value: unknown, updatedBy?: string) {
  await db
    .insert(settings)
    .values({ key, value: value as object, updatedBy })
    .onConflictDoUpdate({ target: settings.key, set: { value: value as object, updatedAt: new Date(), updatedBy } });
}
