import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import {
  COLLECTIONS,
  type AppUser,
  type Team,
  type TeamMember,
  type UserRole,
} from "@wrestlewell/types/index";

export type AuthAccountInput = {
  displayName: string;
  email: string;
  password: string;
  role: UserRole;
  teamName?: string;
  teamCode?: string;
  coachInviteCode?: string;
};

export type AccountSetupInput = {
  displayName: string;
  role: UserRole;
  teamName?: string;
  teamCode?: string;
  coachInviteCode?: string;
};

function normalizeRole(value: unknown): UserRole {
  return value === "coach" ? "coach" : "athlete";
}

function normalizeTeamCode(value?: string) {
  return value?.trim().toUpperCase().replace(/\s+/g, "") || "";
}

function createTeamCode(seed: string) {
  const slug = seed
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6)
    .padEnd(3, "X");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${slug}-${suffix}`;
}

function createCoachInviteCode(seed: string) {
  const slug = seed
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4)
    .padEnd(3, "X");
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `COACH-${slug}-${suffix}`;
}

function normalizeAppUser(id: string, value: Record<string, unknown>): AppUser {
  return {
    id,
    email: typeof value.email === "string" ? value.email : "",
    displayName: typeof value.displayName === "string" ? value.displayName : "",
    role: normalizeRole(value.role),
    currentTeamId: typeof value.currentTeamId === "string" ? value.currentTeamId : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function normalizeTeam(id: string, value: Record<string, unknown>): Team {
  return {
    id,
    name: typeof value.name === "string" ? value.name : "",
    teamCode: typeof value.teamCode === "string" ? value.teamCode : "",
    coachInviteCode:
      typeof value.coachInviteCode === "string" ? value.coachInviteCode : undefined,
    ownerUserId: typeof value.ownerUserId === "string" ? value.ownerUserId : "",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

export async function getAppUser(db: Firestore, userId: string): Promise<AppUser | null> {
  const userSnapshot = await getDoc(doc(db, COLLECTIONS.USERS, userId));
  if (!userSnapshot.exists()) {
    return null;
  }

  return normalizeAppUser(userSnapshot.id, userSnapshot.data() as Record<string, unknown>);
}

export async function getTeam(db: Firestore, teamId: string): Promise<Team | null> {
  const teamSnapshot = await getDoc(doc(db, COLLECTIONS.TEAMS, teamId));
  if (!teamSnapshot.exists()) {
    return null;
  }

  return normalizeTeam(teamSnapshot.id, teamSnapshot.data() as Record<string, unknown>);
}

async function findTeamByCode(db: Firestore, teamCode: string): Promise<Team | null> {
  const normalizedCode = normalizeTeamCode(teamCode);
  if (!normalizedCode) {
    return null;
  }

  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.TEAMS), where("teamCode", "==", normalizedCode))
  );

  const teamDoc = snapshot.docs[0];
  if (!teamDoc) {
    return null;
  }

  return normalizeTeam(teamDoc.id, teamDoc.data() as Record<string, unknown>);
}

async function findTeamByCoachInviteCode(
  db: Firestore,
  coachInviteCode: string
): Promise<Team | null> {
  const normalizedCode = normalizeTeamCode(coachInviteCode);
  if (!normalizedCode) {
    return null;
  }

  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.TEAMS), where("coachInviteCode", "==", normalizedCode))
  );

  const teamDoc = snapshot.docs[0];
  if (!teamDoc) {
    return null;
  }

  return normalizeTeam(teamDoc.id, teamDoc.data() as Record<string, unknown>);
}

async function createAccountRecords(
  db: Firestore,
  args: {
    uid: string;
    email: string;
    displayName: string;
    role: UserRole;
    teamName?: string;
    teamCode?: string;
    coachInviteCode?: string;
  }
): Promise<void> {
  const userRef = doc(db, COLLECTIONS.USERS, args.uid);
  const batch = writeBatch(db);

  let teamId: string | undefined;

  if (args.role === "coach") {
    const matchedTeam = await findTeamByCoachInviteCode(db, args.coachInviteCode || "");

    if (args.coachInviteCode && !matchedTeam) {
      throw new Error("Coach invite code not found. Ask your head coach for the current invite code.");
    }

    if (matchedTeam) {
      teamId = matchedTeam.id;
    } else {
      const teamRef = doc(collection(db, COLLECTIONS.TEAMS));
      const resolvedTeamName = args.teamName?.trim() || `${args.displayName.trim() || "Coach"} Team`;
      teamId = teamRef.id;

      batch.set(teamRef, {
        name: resolvedTeamName,
        teamCode: normalizeTeamCode(args.teamCode) || createTeamCode(resolvedTeamName),
        coachInviteCode: createCoachInviteCode(resolvedTeamName),
        ownerUserId: args.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } satisfies Omit<Team, "id" | "createdAt" | "updatedAt"> & Record<string, unknown>);
    }
  } else {
    const matchedTeam = await findTeamByCode(db, args.teamCode || "");
    if (args.teamCode && !matchedTeam) {
      throw new Error("Team code not found. Ask your coach for the current team code.");
    }
    teamId = matchedTeam?.id;
  }

  batch.set(userRef, {
    email: args.email.trim().toLowerCase(),
    displayName: args.displayName.trim(),
    role: args.role,
    currentTeamId: teamId || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } satisfies Omit<AppUser, "id" | "createdAt" | "updatedAt"> & Record<string, unknown>);

  if (teamId) {
    const memberRef = doc(collection(db, COLLECTIONS.TEAM_MEMBERS));
    batch.set(memberRef, {
      teamId,
      userId: args.uid,
      role: args.role,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } satisfies Omit<TeamMember, "id" | "createdAt" | "updatedAt"> & Record<string, unknown>);
  }

  await batch.commit();
}

export async function registerAccount(
  auth: Auth,
  db: Firestore,
  input: AuthAccountInput
): Promise<void> {
  const credential = await createUserWithEmailAndPassword(auth, input.email.trim(), input.password);

  await createAccountRecords(db, {
    uid: credential.user.uid,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    teamName: input.teamName,
    teamCode: input.teamCode,
    coachInviteCode: input.coachInviteCode,
  });
}

export async function signInAccount(auth: Auth, email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function completeAccountSetup(
  db: Firestore,
  args: { uid: string; email: string } & AccountSetupInput
): Promise<void> {
  await createAccountRecords(db, {
    uid: args.uid,
    email: args.email,
    displayName: args.displayName,
    role: args.role,
    teamName: args.teamName,
    teamCode: args.teamCode,
    coachInviteCode: args.coachInviteCode,
  });
}

export async function signOutAccount(auth: Auth): Promise<void> {
  await signOut(auth);
}
