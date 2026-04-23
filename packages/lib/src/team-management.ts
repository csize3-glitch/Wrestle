import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  where,
  type Firestore,
} from "firebase/firestore";
import {
  COLLECTIONS,
  type TeamMember,
  type TeamMemberRecord,
  type UserRole,
} from "@wrestlewell/types/index";

function normalizeTeamMember(id: string, value: Record<string, unknown>): TeamMember {
  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    userId: typeof value.userId === "string" ? value.userId : "",
    role: value.role === "coach" ? "coach" : "athlete",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

export async function listTeamMembers(
  db: Firestore,
  args: { teamId: string; ownerUserId?: string }
): Promise<TeamMemberRecord[]> {
  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.TEAM_MEMBERS), where("teamId", "==", args.teamId))
  );

  const members = snapshot.docs.map((memberDoc) =>
    normalizeTeamMember(memberDoc.id, memberDoc.data() as Record<string, unknown>)
  );

  const userSnapshots = await Promise.all(
    members.map((member) => getDoc(doc(db, COLLECTIONS.USERS, member.userId)))
  );

  return members
    .map((member, index) => {
      const userSnapshot = userSnapshots[index];
      const userData = userSnapshot.exists()
        ? (userSnapshot.data() as Record<string, unknown>)
        : {};

      return {
        ...member,
        displayName:
          typeof userData.displayName === "string" && userData.displayName.trim()
            ? userData.displayName
            : "Unnamed team member",
        email: typeof userData.email === "string" ? userData.email : "",
        currentTeamId:
          typeof userData.currentTeamId === "string" ? userData.currentTeamId : undefined,
        isOwner: args.ownerUserId === member.userId,
      } satisfies TeamMemberRecord;
    })
    .sort((a, b) => {
      if (a.isOwner !== b.isOwner) {
        return a.isOwner ? -1 : 1;
      }

      if (a.role !== b.role) {
        return a.role === "coach" ? -1 : 1;
      }

      return a.displayName.localeCompare(b.displayName);
    });
}

export async function updateTeamMemberRole(
  db: Firestore,
  member: TeamMemberRecord,
  role: UserRole
): Promise<void> {
  const batch = writeBatch(db);

  batch.update(doc(db, COLLECTIONS.TEAM_MEMBERS, member.id), {
    role,
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, COLLECTIONS.USERS, member.userId), {
    role,
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function removeTeamMember(
  db: Firestore,
  member: TeamMemberRecord
): Promise<void> {
  const batch = writeBatch(db);

  batch.delete(doc(db, COLLECTIONS.TEAM_MEMBERS, member.id));
  batch.update(doc(db, COLLECTIONS.USERS, member.userId), {
    currentTeamId: "",
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function updateTeamName(
  db: Firestore,
  teamId: string,
  name: string
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.TEAMS, teamId), {
    name: name.trim(),
    updatedAt: serverTimestamp(),
  });
}

export async function regenerateCoachInviteCode(
  db: Firestore,
  teamId: string
): Promise<string> {
  const nextCode = `COACH-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()}`;

  await updateDoc(doc(db, COLLECTIONS.TEAMS, teamId), {
    coachInviteCode: nextCode,
    updatedAt: serverTimestamp(),
  });

  return nextCode;
}

export async function regenerateTeamCode(db: Firestore, teamId: string): Promise<string> {
  const nextCode = `${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;

  await updateDoc(doc(db, COLLECTIONS.TEAMS, teamId), {
    teamCode: nextCode,
    updatedAt: serverTimestamp(),
  });

  return nextCode;
}
