import {
  applicationDefault,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
  type DocumentReference,
} from "firebase-admin/firestore";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ID = "wrestle-well-2";
const REQUIRED_CONFIRMATION =
  "APPLY-WRESTLEWELL-MEMBERSHIP-MIGRATION";

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
  activeTeamId: string;
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

function verifyLocalBackup(): string {
  const backupFiles = fs
    .readdirSync(process.cwd())
    .filter((filename) => {
      return (
        filename.startsWith(
          "firestore-membership-backup-"
        ) && filename.endsWith(".json")
      );
    })
    .sort()
    .reverse();

  const newestBackup = backupFiles[0];

  if (!newestBackup) {
    throw new Error(
      "No local Firestore membership snapshot was found."
    );
  }

  const backupPath = path.resolve(
    process.cwd(),
    newestBackup
  );

  const backup = JSON.parse(
    fs.readFileSync(backupPath, "utf8")
  ) as {
    metadata?: {
      projectId?: string;
      readOnlySnapshot?: boolean;
    };
    users?: unknown[];
    teams?: unknown[];
    teamMembers?: unknown[];
  };

  if (
    backup.metadata?.projectId !== PROJECT_ID ||
    backup.metadata?.readOnlySnapshot !== true
  ) {
    throw new Error(
      "The newest snapshot does not match the expected project."
    );
  }

  if (
    backup.users?.length !== 10 ||
    backup.teams?.length !== 4 ||
    backup.teamMembers?.length !== 8
  ) {
    throw new Error(
      "The newest snapshot does not contain the expected 10 users, 4 teams, and 8 memberships."
    );
  }

  return backupPath;
}

async function buildMigrationPlan(): Promise<
  MigrationAction[]
> {
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

  if (
    usersSnapshot.size !== 10 ||
    teamsSnapshot.size !== 4 ||
    membershipsSnapshot.size !== 8
  ) {
    throw new Error(
      [
        "Firestore inventory changed since the audited dry run.",
        `Users=${usersSnapshot.size}`,
        `Teams=${teamsSnapshot.size}`,
        `Memberships=${membershipsSnapshot.size}`,
      ].join(" ")
    );
  }

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

  const actions: MigrationAction[] = [];

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
      throw new Error(
        `Invalid membership document: ${document.id}`
      );
    }

    const user = users.get(userId);
    const team = teams.get(teamId);

    if (!user || !team) {
      throw new Error(
        `Membership ${document.id} has a missing user or team.`
      );
    }

    const destinationDocumentId =
      makeTeamMembershipId(teamId, userId);

    if (document.id === destinationDocumentId) {
      throw new Error(
        "A deterministic membership already exists in the source inventory. Run the audit again."
      );
    }

    const legacyRole = normalizeLegacyRole(
      membership.role
    );

    const ownerUserId = readString(
      team,
      "ownerUserId"
    );

    const currentTeamId = readString(
      user,
      "currentTeamId"
    );

    const existingActiveTeamId = readString(
      user,
      "activeTeamId"
    );

    actions.push({
      sourceDocumentId: document.id,
      destinationDocumentId,
      teamId,
      userId,
      legacyRole,
      membershipRole: getMembershipRole(
        legacyRole,
        ownerUserId === userId
      ),
      activeTeamId:
        existingActiveTeamId ||
        currentTeamId ||
        teamId,
    });
  }

  if (actions.length !== 8) {
    throw new Error(
      `Expected exactly 8 migration actions, found ${actions.length}.`
    );
  }

  return actions;
}

async function applyMigration(
  actions: MigrationAction[]
): Promise<void> {
  const db = getFirestore();

  await db.runTransaction(async (transaction) => {
    const references = actions.map((action) => ({
      action,
      sourceRef: db
        .collection("team_members")
        .doc(action.sourceDocumentId),
      destinationRef: db
        .collection("team_members")
        .doc(action.destinationDocumentId),
      userRef: db
        .collection("users")
        .doc(action.userId),
      teamRef: db
        .collection("teams")
        .doc(action.teamId),
    }));

    const allReferences: DocumentReference[] = [];

    for (const entry of references) {
      allReferences.push(
        entry.sourceRef,
        entry.destinationRef,
        entry.userRef,
        entry.teamRef
      );
    }

    // Perform every transaction read before scheduling any write.
    const snapshots =
      await transaction.getAll(...allReferences);

    const validatedEntries = references.map(
      (entry, index) => {
        const offset = index * 4;

        const sourceSnapshot = snapshots[offset];
        const destinationSnapshot =
          snapshots[offset + 1];
        const userSnapshot = snapshots[offset + 2];
        const teamSnapshot = snapshots[offset + 3];

        if (
          !sourceSnapshot.exists ||
          !userSnapshot.exists ||
          !teamSnapshot.exists
        ) {
          throw new Error(
            `Required migration document disappeared for ${entry.action.sourceDocumentId}.`
          );
        }

        if (destinationSnapshot.exists) {
          throw new Error(
            `Destination already exists: ${entry.action.destinationDocumentId}`
          );
        }

        const sourceData =
          sourceSnapshot.data() as FirestoreRecord;

        if (
          readString(sourceData, "teamId") !==
            entry.action.teamId ||
          readString(sourceData, "userId") !==
            entry.action.userId
        ) {
          throw new Error(
            `Source membership changed: ${entry.action.sourceDocumentId}`
          );
        }

        return {
          ...entry,
          sourceData,
        };
      }
    );

    // All reads and validation are complete. Writes begin here.
    for (const entry of validatedEntries) {
      transaction.create(entry.destinationRef, {
        ...entry.sourceData,
        teamId: entry.action.teamId,
        userId: entry.action.userId,
        role: entry.action.legacyRole,
        membershipRole:
          entry.action.membershipRole,
        status: "active",
        joinedAt:
          entry.sourceData.createdAt ||
          FieldValue.serverTimestamp(),
        legacyDocumentId:
          entry.action.sourceDocumentId,
        migratedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.update(entry.userRef, {
        activeTeamId: entry.action.activeTeamId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
}

async function main(): Promise<void> {
  const applyRequested =
    process.argv.includes("--apply");

  const confirmationArgument =
    process.argv.find((argument) => {
      return argument.startsWith("--confirm=");
    });

  const confirmation =
    confirmationArgument?.slice(
      "--confirm=".length
    ) || "";

  if (!applyRequested) {
    throw new Error(
      "Apply mode was not requested. Use the tested dry-run script first."
    );
  }

  if (confirmation !== REQUIRED_CONFIRMATION) {
    throw new Error(
      [
        "Confirmation token missing or incorrect.",
        `Required token: ${REQUIRED_CONFIRMATION}`,
      ].join(" ")
    );
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
      projectId: PROJECT_ID,
    });
  }

  const backupPath = verifyLocalBackup();
  const actions = await buildMigrationPlan();

  console.log(
    "\nGuarded membership migration is ready."
  );
  console.log("Project:", PROJECT_ID);
  console.log("Verified snapshot:", backupPath);
  console.log(
    "Membership copies:",
    actions.length
  );
  console.log(
    "User activeTeamId updates:",
    new Set(
      actions.map((action) => action.userId)
    ).size
  );
  console.log(
    "Legacy memberships deleted: 0"
  );

  await applyMigration(actions);

  console.log(
    "\nMigration transaction committed successfully."
  );
  console.log(
    "No legacy membership documents were deleted."
  );
}

main().catch((error: unknown) => {
  console.error(
    "\nGuarded membership migration failed."
  );

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});
