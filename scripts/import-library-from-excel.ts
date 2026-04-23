import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "../packages/types/src/index";
import { SHEET_TO_STYLE, buildLibraryItemFromRow, type ImportedExcelRow } from "../packages/lib/src/import-map";

function initFirebaseAdmin() {
  if (getApps().length) return getFirestore();

  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.resolve(process.cwd(), "service-account.json");

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Missing service account file: ${serviceAccountPath}`);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

  initializeApp({
    credential: cert(serviceAccount),
  });

  return getFirestore();
}

async function importLibraryFromWorkbook(workbookPath: string) {
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Workbook not found: ${workbookPath}`);
  }

  const db = initFirebaseAdmin();
  const workbook = XLSX.readFile(workbookPath);
  const nowIso = new Date().toISOString();
  const items = [];

  for (const sheetName of workbook.SheetNames) {
    const style = SHEET_TO_STYLE[sheetName];
    if (!style) continue;

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<ImportedExcelRow>(sheet, { defval: "" });

    for (const row of rows) {
      const item = buildLibraryItemFromRow(row, style, nowIso);
      if (item) items.push(item);
    }
  }

  const deduped = new Map(items.map((item) => [item.id, item]));
  const finalItems = Array.from(deduped.values());

  let batch = db.batch();
  let count = 0;

  for (const item of finalItems) {
    const ref = db.collection(COLLECTIONS.LIBRARY_ITEMS).doc(item.id);
    batch.set(ref, item, { merge: true });
    count++;

    if (count === 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  console.log(`Imported ${finalItems.length} library items.`);
}

async function main() {
  const workbookArg = process.argv[2];
  if (!workbookArg) {
    throw new Error("Usage: pnpm import:library or npx tsx scripts/import-library-from-excel.ts <file>");
  }

  await importLibraryFromWorkbook(path.resolve(workbookArg));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});