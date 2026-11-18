import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "wrestle-well-2";

type FirestoreRecord = Record<string, unknown>;

function readString(
  value: FirestoreRecord,
  field: string
): string {
  return typeof value[field] === "string"
    ? (value[field] as string).trim()
    : "";
}

function membershipKey(
  teamId: string,
  userId: string
): string {
  return `${teamId}_${userId}`;
}

async function main(): Promise<void> {
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

  const memberships = membershipsSnapshot.docs.map(
    (document) => ({
      id: document.id,
      data: document.data() as FirestoreRecord,
    })
  );

  const membershipsByPair = new Map<
    string,
    string[]
  >();

  const membershipsByUser = new Map<
    string,
    string[]
  >();

  const orphanMembershipUsers: string[] = [];
  const orphanMembershipTeams: string[] = [];
  const invalidMemberships: string[] = [];
  const nonDeterministicMembershipIds: string[] = [];

  for (const membership of memberships) {
    const teamId = readString(
      membership.data,
      "teamId"
    );

    const userId = readString(
      membership.data,
      "userId"
    );

    if (!teamId || !userId) {
      invalidMemberships.push(membership.id);
      continue;
    }

    const pairKey = membershipKey(teamId, userId);

    const pairDocuments =
      membershipsByPair.get(pairKey) || [];

    pairDocuments.push(membership.id);
    membershipsByPair.set(
      pairKey,
      pairDocuments
    );

    const userMemberships =
      membershipsByUser.get(userId) || [];

    userMemberships.push(teamId);
    membershipsByUser.set(
      userId,
      userMemberships
    );

    if (!users.has(userId)) {
      orphanMembershipUsers.push(
        `${membership.id} -> user ${userId}`
      );
    }

    if (!teams.has(teamId)) {
      orphanMembershipTeams.push(
        `${membership.id} -> team ${teamId}`
      );
    }

    if (membership.id !== pairKey) {
      nonDeterministicMembershipIds.push(
        `${membership.id} -> ${pairKey}`
      );
    }
  }

  const duplicateMemberships = Array.from(
    membershipsByPair.entries()
  ).filter(([, documentIds]) => {
    return documentIds.length > 1;
  });

  const usersMissingCurrentMembership: string[] = [];
  const usersWithDifferentActiveTeam: string[] = [];

  for (const [userId, user] of users) {
    const currentTeamId = readString(
      user,
      "currentTeamId"
    );

    const activeTeamId = readString(
      user,
      "activeTeamId"
    );

    if (currentTeamId) {
      const pairKey = membershipKey(
        currentTeamId,
        userId
      );

      if (!membershipsByPair.has(pairKey)) {
        usersMissingCurrentMembership.push(
          `${userId} -> team ${currentTeamId}`
        );
      }
    }

    if (
      activeTeamId &&
      currentTeamId &&
      activeTeamId !== currentTeamId
    ) {
      usersWithDifferentActiveTeam.push(
        `${userId}: active=${activeTeamId}, current=${currentTeamId}`
      );
    }
  }

  const ownersMissingMembership: string[] = [];

  for (const [teamId, team] of teams) {
    const ownerUserId = readString(
      team,
      "ownerUserId"
    );

    if (!ownerUserId) {
      ownersMissingMembership.push(
        `${teamId} -> missing ownerUserId`
      );
      continue;
    }

    const pairKey = membershipKey(
      teamId,
      ownerUserId
    );

    if (!membershipsByPair.has(pairKey)) {
      ownersMissingMembership.push(
        `${teamId} -> owner ${ownerUserId}`
      );
    }
  }

  const usersWithMultipleMemberships =
    Array.from(membershipsByUser.entries())
      .filter(([, teamIds]) => {
        return new Set(teamIds).size > 1;
      })
      .map(([userId, teamIds]) => {
        return {
          userId,
          teamIds: Array.from(new Set(teamIds)),
        };
      });

  console.log("\n=== WrestleWell membership audit ===\n");

  console.log("Inventory");
  console.log("Users:", users.size);
  console.log("Teams:", teams.size);
  console.log(
    "Membership documents:",
    memberships.length
  );

  console.log("\nMigration preview");
  console.log(
    "Memberships needing deterministic copies:",
    nonDeterministicMembershipIds.length
  );
  console.log(
    "Users already on multiple teams:",
    usersWithMultipleMemberships.length
  );

  console.log("\nData-quality checks");
  console.log(
    "Duplicate user/team memberships:",
    duplicateMemberships.length
  );
  console.log(
    "Invalid memberships:",
    invalidMemberships.length
  );
  console.log(
    "Memberships with missing users:",
    orphanMembershipUsers.length
  );
  console.log(
    "Memberships with missing teams:",
    orphanMembershipTeams.length
  );
  console.log(
    "Users missing current-team membership:",
    usersMissingCurrentMembership.length
  );
  console.log(
    "Owners missing team membership:",
    ownersMissingMembership.length
  );
  console.log(
    "Users with different active/current teams:",
    usersWithDifferentActiveTeam.length
  );

  function printSection(
    title: string,
    values: unknown[]
  ): void {
    if (values.length === 0) {
      return;
    }

    console.log(`\n${title}`);

    for (const value of values) {
      console.log(
        typeof value === "string"
          ? `- ${value}`
          : `- ${JSON.stringify(value)}`
      );
    }
  }

  printSection(
    "Duplicate memberships",
    duplicateMemberships.map(
      ([pairKey, documentIds]) =>
        `${pairKey}: ${documentIds.join(", ")}`
    )
  );

  printSection(
    "Invalid membership documents",
    invalidMemberships
  );

  printSection(
    "Memberships with missing users",
    orphanMembershipUsers
  );

  printSection(
    "Memberships with missing teams",
    orphanMembershipTeams
  );

  printSection(
    "Users missing current-team memberships",
    usersMissingCurrentMembership
  );

  printSection(
    "Owners missing memberships",
    ownersMissingMembership
  );

  printSection(
    "Existing multi-team users",
    usersWithMultipleMemberships
  );

  printSection(
    "Different active/current team values",
    usersWithDifferentActiveTeam
  );

  console.log(
    "\nAudit complete. No Firestore writes were performed."
  );
}

main().catch((error: unknown) => {
  console.error("\nMembership audit failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});
