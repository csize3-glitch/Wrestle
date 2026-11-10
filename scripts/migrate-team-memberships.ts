import {
  applicationDefault,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "wrestle-well-2";

type FirestoreRecord = Record<string, unknown>;

type MigrationAction = {
  sourceDocumentId: string;
  destinationDocumentId: string;
  teamId: string;
  userId: string;
  legacyRole: "coach" | "parent" | "athlete";
  membershipRole:
    | "owner"
    | "head_coach"
    | "assistant_coach"
    | "athlete"
    | "parent";
  status: "active";
  activeTeamId: string;
  destinationExists: boolean;
};

function readString(
  value: FirestoreRecord,
  field: string
): string {
  return typeof value[field] === "string"
    ? (value[field] as string).trim()
    : "";
}

function makeTeamMembershipId(
  teamId: string,
  userId: string
): string {
  return `${teamId}_${userId}`;
}

function normalizeLegacyRole(
  value: unknown
): "coach" | "parent" | "athlete" {
  if (value === "coach" || value === "parent") {
    return value;
  }

  return "athlete";
}

function getMembershipRole(
  legacyRole: "coach" | "parent" | "athlete",
  isOwner: boolean
): MigrationAction["membershipRole"] {
  if (isOwner) {
    return "owner";
  }

  if (legacyRole === "coach") {
    return "assistant_coach";
  }

  if (legacyRole === "parent") {
    return "parent";
  }

  return "athlete";
}

async function main(): Promise<void> {
  if (process.argv.includes("--apply")) {
    throw new Error(
      "Apply mode is intentionally disabled. This version is dry-run only."
    );
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
      projectId: PROJECT_ID,
    });
  }

  const db = getFirestore();

  const [
    usersSnapshot,
    teamsSnapshot,
    membershipsSnapshot,
  ] = await Promise.all([
    db.collection("users").get(),
    db.collection("teams").get(),
    db.collection("team_members").get(),
  ]);

  const users = new Map(
    usersSnapshot.docs.map((document) => [
      document.id,
      document.data() as FirestoreRecord,
    ])
  );

  const teams = new Map(
    teamsSnapshot.docs.map((document) => [
      document.id,
      document.data() as FirestoreRecord,
    ])
  );

  const existingMembershipIds = new Set(
    membershipsSnapshot.docs.map(
      (document) => document.id
    )
  );

  const actions: MigrationAction[] = [];
  const skippedInvalid: string[] = [];
  const conflicts: string[] = [];

  for (const document of membershipsSnapshot.docs) {
    const membership =
      document.data() as FirestoreRecord;

    const teamId = readString(
      membership,
      "teamId"
    );

    const userId = readString(
      membership,
      "userId"
    );

    if (!teamId || !userId) {
      skippedInvalid.push(
        `${document.id}: missing teamId or userId`
      );
      continue;
    }

    const user = users.get(userId);
    const team = teams.get(teamId);

    if (!user || !team) {
      skippedInvalid.push(
        `${document.id}: missing related user or team`
      );
      continue;
    }

    const destinationDocumentId =
      makeTeamMembershipId(teamId, userId);

    if (document.id === destinationDocumentId) {
      continue;
    }

    const legacyRole = normalizeLegacyRole(
      membership.role
    );

    const ownerUserId = readString(
      team,
      "ownerUserId"
    );

    const isOwner = ownerUserId === userId;

    const currentTeamId = readString(
      user,
      "currentTeamId"
    );

    const existingActiveTeamId = readString(
      user,
      "activeTeamId"
    );

    const activeTeamId =
      existingActiveTeamId ||
      currentTeamId ||
      teamId;

    const destinationExists =
      existingMembershipIds.has(
        destinationDocumentId
      );

    if (destinationExists) {
      conflicts.push(
        `${document.id} -> ${destinationDocumentId}`
      );
    }

    actions.push({
      sourceDocumentId: document.id,
      destinationDocumentId,
      teamId,
      userId,
      legacyRole,
      membershipRole: getMembershipRole(
        legacyRole,
        isOwner
      ),
      status: "active",
      activeTeamId,
      destinationExists,
    });
  }

  console.log(
    "\n=== WrestleWell membership migration dry run ===\n"
  );

  console.log("Source inventory");
  console.log(
    "Users:",
    usersSnapshot.size
  );
  console.log(
    "Teams:",
    teamsSnapshot.size
  );
  console.log(
    "Membership documents:",
    membershipsSnapshot.size
  );

  console.log("\nPlanned changes");
  console.log(
    "Deterministic membership copies:",
    actions.length
  );
  console.log(
    "User activeTeamId updates:",
    new Set(
      actions.map((action) => action.userId)
    ).size
  );
  console.log(
    "Existing destination conflicts:",
    conflicts.length
  );
  console.log(
    "Skipped invalid records:",
    skippedInvalid.length
  );

  console.log("\nPlanned membership copies");

  for (const action of actions) {
    console.log(
      [
        `- ${action.sourceDocumentId}`,
        `  -> ${action.destinationDocumentId}`,
        `  role=${action.membershipRole}`,
        `  status=${action.status}`,
        `  destinationExists=${action.destinationExists}`,
      ].join("\n")
    );
  }

  if (conflicts.length > 0) {
    console.log("\nConflicts");

    for (const conflict of conflicts) {
      console.log(`- ${conflict}`);
    }
  }

  if (skippedInvalid.length > 0) {
    console.log("\nSkipped records");

    for (const skipped of skippedInvalid) {
      console.log(`- ${skipped}`);
    }
  }

  console.log(
    "\nDry run complete. No Firestore writes were performed."
  );
}

main().catch((error: unknown) => {
  console.error("\nMembership migration dry run failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});
