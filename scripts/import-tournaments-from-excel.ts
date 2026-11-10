import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "../packages/types/src/index";

function initFirebaseAdmin() {
  if (getApps().length) return getFirestore();

  initializeApp({
    credential: applicationDefault(),
    projectId: "wrestle-well-2",
  });

  return getFirestore();
}

function makeTournamentId(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function importTournamentsFromWorkbook(workbookPath: string) {
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Workbook not found: ${workbookPath}`);
  }

  const db = initFirebaseAdmin();
  const workbook = XLSX.readFile(workbookPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  if (!sheet) {
    throw new Error("Workbook has no sheets.");
  }

  const rows = XLSX.utils.sheet_to_json<[string, string]>(sheet, {
    header: 1,
    defval: "",
  });

  const nowIso = new Date().toISOString();
  const batch = db.batch();
  let importedCount = 0;

  for (const [name, registrationUrl] of rows.slice(1)) {
    if (!name || !registrationUrl) continue;

    const ref = db.collection(COLLECTIONS.TOURNAMENTS).doc(makeTournamentId(name));
    batch.set(
      ref,
      {
        name: String(name).trim(),
        registrationUrl: String(registrationUrl).trim(),
        source: "excel_import",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      { merge: true }
    );
    importedCount++;
  }

  await batch.commit();
  console.log(`Imported ${importedCount} tournaments.`);
}

async function main() {
  const workbookArg = process.argv[2];
  if (!workbookArg) {
    throw new Error(
      "Usage: node --import tsx scripts/import-tournaments-from-excel.ts <file>"
    );
  }

  await importTournamentsFromWorkbook(path.resolve(workbookArg));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
