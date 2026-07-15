/**
 * بذرة هندسة المبنى: نسخ مسودة أولية للأدوار الأربعة والموقع الخارجي +
 * استيراد صور المصدر (من pptx والمخطط الجوي من PDF) خلفياتٍ خاصة قابلة للتبديل.
 * idempotent — يتخطى ما هو موجود.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { eq, and } from "drizzle-orm";
import { db, pool } from "./index";
import { floors, floorGeometryVersions, floorBackgrounds, storedFiles } from "./schema";
import {
  groundFloorGeometry, firstFloorGeometry, secondFloorGeometry, thirdFloorGeometry, siteGeometry,
} from "./seed-data/floor-geometry";
import { storage } from "@/lib/storage";

const REF_DIR = path.resolve("reference_files");

async function storeBackground(buf: Buffer, name: string, mime: string): Promise<string> {
  const relPath = path.join("backgrounds", name);
  const existing = await db.select().from(storedFiles).where(eq(storedFiles.storagePath, relPath));
  if (existing.length > 0) return existing[0].id;
  await storage.put(relPath, buf);
  const [f] = await db
    .insert(storedFiles)
    .values({
      originalName: name,
      mime,
      size: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
      storagePath: relPath,
      scope: "backgrounds",
    })
    .returning();
  return f.id;
}

async function seedFloorGeometry(floorKey: string, geometry: unknown) {
  const [floor] = await db.select().from(floors).where(eq(floors.key, floorKey));
  if (!floor) throw new Error(`الدور غير موجود: ${floorKey}`);
  const existing = await db
    .select()
    .from(floorGeometryVersions)
    .where(eq(floorGeometryVersions.floorId, floor.id));
  if (existing.length > 0) return floor;
  await db.insert(floorGeometryVersions).values({
    floorId: floor.id,
    version: 1,
    geometry: geometry as object,
    status: "مسودة",
    note: "رسم أولي منقول من الملفات المصدرية — يقارن مع الخلفية ويصحح قبل النشر",
  });
  console.log(`هندسة أولية: ${floorKey}`);
  return floor;
}

async function seedBackgrounds() {
  // خلفيات الأدوار من pptx
  const pptxPath = path.join(REF_DIR, "مخطط المبنى.pptx");
  if (existsSync(pptxPath)) {
    const zip = new AdmZip(pptxPath);
    const floorImageMap: [string, string][] = [
      ["ground", "ppt/media/image1.jpg"],
      ["first", "ppt/media/image2.jpg"],
      ["second", "ppt/media/image3.jpg"],
      ["third", "ppt/media/image4.jpg"],
    ];
    for (const [floorKey, entryName] of floorImageMap) {
      const entry = zip.getEntry(entryName);
      if (!entry) continue;
      const [floor] = await db.select().from(floors).where(eq(floors.key, floorKey));
      if (!floor) continue;
      const existing = await db.select().from(floorBackgrounds).where(eq(floorBackgrounds.floorId, floor.id));
      if (existing.length > 0) continue;
      const fileId = await storeBackground(entry.getData(), `floor-${floorKey}-source.jpg`, "image/jpeg");
      await db.insert(floorBackgrounds).values({
        floorId: floor.id,
        fileId,
        transform: { x: 0, y: 0, scale: 0.035, rotation: 0, opacity: 0.55, visible: true },
        label: "صورة المخطط المصدرية (من ملف العرض)",
      });
      console.log(`خلفية: ${floorKey}`);
    }
  } else {
    console.warn("ملف مخطط المبنى.pptx غير موجود — تخطيت خلفيات الأدوار");
  }

  // الخلفية الجوية للموقع من PDF (تصيير الصفحة الأولى)
  const sitePdfPath = path.join(REF_DIR, "أبو فهد_041337.pdf");
  if (existsSync(sitePdfPath)) {
    const [siteFloor] = await db.select().from(floors).where(eq(floors.key, "site"));
    const existing = siteFloor
      ? await db.select().from(floorBackgrounds).where(eq(floorBackgrounds.floorId, siteFloor.id))
      : [];
    if (siteFloor && existing.length === 0) {
      const { pdfFirstPageToPng } = await import("@/lib/pdf-to-image");
      const png = await pdfFirstPageToPng(readFileSync(sitePdfPath));
      if (png) {
        const fileId = await storeBackground(png, "site-aerial-source.png", "image/png");
        await db.insert(floorBackgrounds).values({
          floorId: siteFloor.id,
          fileId,
          transform: { x: 0, y: 0, scale: 0.03, rotation: 0, opacity: 0.6, visible: true },
          label: "المخطط الجوي المصدري (قابل للاستبدال)",
        });
        console.log("خلفية: site");
      } else {
        console.warn("تعذر تصيير المخطط الجوي — يمكن رفع خلفية بديلة من المحرر");
      }
    }
  }
}

async function main() {
  await seedFloorGeometry("ground", groundFloorGeometry);
  await seedFloorGeometry("first", firstFloorGeometry);
  await seedFloorGeometry("second", secondFloorGeometry);
  await seedFloorGeometry("third", thirdFloorGeometry);
  await seedFloorGeometry("site", siteGeometry);
  await seedBackgrounds();
  console.log("اكتملت بذرة الهندسة والخلفيات.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
