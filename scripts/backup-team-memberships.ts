import {
  applicationDefault,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ID = "wrestle-well-2";

function serializeValue(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return {
      __firestoreType: "timestamp",
      value: (
        value as { toDate: () => Date }
      ).toDate().toISOString(),
    };
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        serializeValue(entry),
      ])
    );
  }

  return value;
}

async function readCollection(
  collectionName: string
): Promise<Record<string, unknown>[]> {
  const db = getFirestore();
  const snapshot = await db.collection(collectionName).get();

  return snapshot.docs.map((document) => ({
    id: document.id,
    data: serializeValue(document.data()),
  }));
}

async function main(): Promise<void> {
  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
      projectId: PROJECT_ID,
    });
  }

  const [users, teams, teamMembers] = await Promise.all([
    readCollection("users"),
    readCollection("teams"),
    readCollection("team_members"),
  ]);

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const filename =
    `firestore-membership-backup-${timestamp}.json`;

  const outputPath = path.resolve(
    process.cwd(),
    filename
  );

  const backup = {
    metadata: {
      projectId: PROJECT_ID,
      createdAt: new Date().toISOString(),
      collections: [
        "users",
        "teams",
        "team_members",
      ],
      readOnlySnapshot: true,
    },
    users,
    teams,
    teamMembers,
  };

  fs.writeFileSync(
    outputPath,
    JSON.stringify(backup, null, 2) + "\n",
    {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    }
  );

  console.log("Local Firestore snapshot created:");
  console.log(outputPath);
  console.log("");
  console.log("Users:", users.length);
  console.log("Teams:", teams.length);
  console.log("Memberships:", teamMembers.length);
  console.log("");
  console.log(
    "No Firestore writes were performed."
  );
}

main().catch((error: unknown) => {
  console.error("Snapshot failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});
