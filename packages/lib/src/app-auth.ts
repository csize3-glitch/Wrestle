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
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import {
  COLLECTIONS,
  type AppUser,
  type NotificationPreferences,
  type Team,
  type TeamMember,
  type UserRole,
  type VarkProfile,
  type VarkStyle,
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
  if (value === "coach" || value === "athlete" || value === "parent") {
    return value;
  }

  return "athlete";
}

function normalizeVarkStyle(value: unknown): VarkStyle | "" {
  if (
    value === "visual" ||
    value === "auditory" ||
    value === "readingWriting" ||
    value === "kinesthetic"
  ) {
    return value;
  }

  return "";
}

function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    announcements: record.announcements !== false,
    tournamentAlerts: record.tournamentAlerts !== false,
    practiceReminders: record.practiceReminders !== false,
  };
}

function normalizeVarkProfile(value: unknown): VarkProfile | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  return {
    visual: typeof record.visual === "number" ? record.visual : 0,
    auditory: typeof record.auditory === "number" ? record.auditory : 0,
    readingWriting: typeof record.readingWriting === "number" ? record.readingWriting : 0,
    kinesthetic: typeof record.kinesthetic === "number" ? record.kinesthetic : 0,
    primaryStyle: normalizeVarkStyle(record.primaryStyle),
    secondaryStyle: normalizeVarkStyle(record.secondaryStyle),
    isMultimodal: record.isMultimodal === true,
    completedAt: typeof record.completedAt === "string" ? record.completedAt : "",
  };
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
    linkedWrestlerIds: Array.isArray(value.linkedWrestlerIds)
      ? value.linkedWrestlerIds.filter((entry): entry is string => typeof entry === "string")
      : undefined,
    notificationPreferences: normalizeNotificationPreferences(value.notificationPreferences),
    lastSeenNotificationsAt:
      typeof value.lastSeenNotificationsAt === "string" ? value.lastSeenNotificationsAt : undefined,
    varkCompleted: value.varkCompleted === true,
    varkProfile: normalizeVarkProfile(value.varkProfile),
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
    logoUrl: typeof value.logoUrl === "string" ? value.logoUrl : undefined,
    practiceCheckInEnabled: value.practiceCheckInEnabled !== false,
    parentCheckInEnabled: value.parentCheckInEnabled !== false,
    athleteCheckInEnabled: value.athleteCheckInEnabled !== false,
    coachCanLockAttendance: value.coachCanLockAttendance !== false,
    coachCanOverrideAttendance: value.coachCanOverrideAttendance !== false,
    attendanceRequiredForCloseout: value.attendanceRequiredForCloseout === true,
    showAttendanceToAthletes: value.showAttendanceToAthletes !== false,
    showAttendanceToParents: value.showAttendanceToParents !== false,
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

function createDefaultVarkFields(role: UserRole): {
  varkCompleted: boolean;
  varkProfile: VarkProfile;
} {
  const isAthlete = role === "athlete";

  return {
    varkCompleted: !isAthlete,
    varkProfile: {
      visual: 0,
      auditory: 0,
      readingWriting: 0,
      kinesthetic: 0,
      primaryStyle: "",
      secondaryStyle: "",
      isMultimodal: false,
      completedAt: "",
    },
  };
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
        logoUrl: "",
        practiceCheckInEnabled: true,
        parentCheckInEnabled: true,
        athleteCheckInEnabled: true,
        coachCanLockAttendance: true,
        coachCanOverrideAttendance: true,
        attendanceRequiredForCloseout: false,
        showAttendanceToAthletes: true,
        showAttendanceToParents: true,
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

  const varkFields = createDefaultVarkFields(args.role);

  batch.set(userRef, {
    email: args.email.trim().toLowerCase(),
    displayName: args.displayName.trim(),
    role: args.role,
    currentTeamId: teamId || "",
    notificationPreferences: {
      announcements: true,
      tournamentAlerts: true,
      practiceReminders: true,
    },
    lastSeenNotificationsAt: "",
    ...varkFields,
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
