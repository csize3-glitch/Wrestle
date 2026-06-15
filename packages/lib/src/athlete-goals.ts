import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import {
  ATHLETE_GOAL_SESSION_NAMES,
  ATHLETE_GOAL_STATUSES,
  ATHLETE_GOAL_TYPES,
  COLLECTIONS,
  type AthleteGoal,
  type AthleteGoalSessionName,
  type AthleteGoalStatus,
  type AthleteGoalType,
} from "@wrestlewell/types/index";

export type AthleteGoalInput = {
  teamId: string;
  wrestlerId: string;
  createdByUserId: string;
  type: AthleteGoalType;
  title: string;
  description?: string;
  status: AthleteGoalStatus;
  sessionName?: AthleteGoalSessionName;
  seasonYear?: number;
  practiceEventId?: string;
  practiceAttendanceId?: string;
  coachVisible: boolean;
};

function normalizeDateValue(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return "";
    }
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    return new Date((value as { seconds: number }).seconds * 1000).toISOString();
  }

  return "";
}

function normalizeGoalType(value: unknown): AthleteGoalType {
  return ATHLETE_GOAL_TYPES.includes(value as AthleteGoalType)
    ? (value as AthleteGoalType)
    : "session";
}

function normalizeGoalStatus(value: unknown): AthleteGoalStatus {
  return ATHLETE_GOAL_STATUSES.includes(value as AthleteGoalStatus)
    ? (value as AthleteGoalStatus)
    : "active";
}

function normalizeSessionName(value: unknown): AthleteGoalSessionName | undefined {
  return ATHLETE_GOAL_SESSION_NAMES.includes(value as AthleteGoalSessionName)
    ? (value as AthleteGoalSessionName)
    : undefined;
}

function buildGoalPayload(input: AthleteGoalInput) {
  return {
    teamId: input.teamId.trim(),
    wrestlerId: input.wrestlerId.trim(),
    createdByUserId: input.createdByUserId.trim(),
    type: normalizeGoalType(input.type),
    title: input.title.trim(),
    description: input.description?.trim() || "",
    status: normalizeGoalStatus(input.status),
    sessionName: normalizeSessionName(input.sessionName) || "",
    seasonYear: typeof input.seasonYear === "number" ? input.seasonYear : null,
    practiceEventId: input.practiceEventId?.trim() || "",
    practiceAttendanceId: input.practiceAttendanceId?.trim() || "",
    coachVisible: input.coachVisible === true,
  };
}

export function normalizeAthleteGoal(
  id: string,
  value: Record<string, unknown>
): AthleteGoal {
  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    wrestlerId: typeof value.wrestlerId === "string" ? value.wrestlerId : "",
    createdByUserId:
      typeof value.createdByUserId === "string" ? value.createdByUserId : "",
    type: normalizeGoalType(value.type),
    title: typeof value.title === "string" ? value.title : "",
    description:
      typeof value.description === "string" ? value.description : undefined,
    status: normalizeGoalStatus(value.status),
    sessionName: normalizeSessionName(value.sessionName),
    seasonYear: typeof value.seasonYear === "number" ? value.seasonYear : undefined,
    practiceEventId:
      typeof value.practiceEventId === "string" ? value.practiceEventId : undefined,
    practiceAttendanceId:
      typeof value.practiceAttendanceId === "string"
        ? value.practiceAttendanceId
        : undefined,
    coachVisible: value.coachVisible === true,
    createdAt: normalizeDateValue(value.createdAt),
    updatedAt: normalizeDateValue(value.updatedAt),
    completedAt: normalizeDateValue(value.completedAt),
  };
}

export function getCurrentGoalSession(date = new Date()): {
  sessionName: AthleteGoalSessionName;
  seasonYear: number;
} {
  const month = date.getMonth();
  const year = date.getFullYear();

  if (month >= 2 && month <= 4) {
    return { sessionName: "Spring", seasonYear: year };
  }

  if (month >= 5 && month <= 7) {
    return { sessionName: "Summer", seasonYear: year };
  }

  if (month >= 8 && month <= 10) {
    return { sessionName: "Fall", seasonYear: year };
  }

  return {
    sessionName: "Winter",
    seasonYear: month <= 1 ? year : year + 1,
  };
}

function sortGoals(entries: AthleteGoal[]) {
  return entries.sort((a, b) => {
    const statusRank = (status: AthleteGoalStatus) =>
      status === "active" ? 0 : status === "completed" ? 1 : 2;

    const rankCompare = statusRank(a.status) - statusRank(b.status);
    if (rankCompare !== 0) {
      return rankCompare;
    }

    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export async function createAthleteGoal(
  db: Firestore,
  input: AthleteGoalInput
): Promise<string> {
  const goalRef = await addDoc(collection(db, COLLECTIONS.ATHLETE_GOALS), {
    ...buildGoalPayload(input),
    completedAt: input.status === "completed" ? serverTimestamp() : null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return goalRef.id;
}

export async function updateAthleteGoal(
  db: Firestore,
  goalId: string,
  input: AthleteGoalInput
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.ATHLETE_GOALS, goalId), {
    ...buildGoalPayload(input),
    completedAt: input.status === "completed" ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });
}

export async function completeAthleteGoal(
  db: Firestore,
  goalId: string
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.ATHLETE_GOALS, goalId), {
    status: "completed",
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function archiveAthleteGoal(
  db: Firestore,
  goalId: string
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.ATHLETE_GOALS, goalId), {
    status: "archived",
    updatedAt: serverTimestamp(),
  });
}

export async function deleteAthleteGoal(
  db: Firestore,
  goalId: string
): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.ATHLETE_GOALS, goalId));
}

export async function listMyAthleteGoals(
  db: Firestore,
  args: { teamId: string; wrestlerId: string; createdByUserId: string }
): Promise<AthleteGoal[]> {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.ATHLETE_GOALS),
      where("teamId", "==", args.teamId),
      where("wrestlerId", "==", args.wrestlerId),
      where("createdByUserId", "==", args.createdByUserId)
    )
  );

  return sortGoals(
    snapshot.docs.map((goalDoc) =>
      normalizeAthleteGoal(goalDoc.id, goalDoc.data() as Record<string, unknown>)
    )
  );
}

export async function listAthleteGoalsForWrestler(
  db: Firestore,
  args: { teamId: string; wrestlerId: string }
): Promise<AthleteGoal[]> {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.ATHLETE_GOALS),
      where("teamId", "==", args.teamId),
      where("wrestlerId", "==", args.wrestlerId)
    )
  );

  return sortGoals(
    snapshot.docs.map((goalDoc) =>
      normalizeAthleteGoal(goalDoc.id, goalDoc.data() as Record<string, unknown>)
    )
  );
}

export async function listCoachVisibleGoalsForTeam(
  db: Firestore,
  teamId: string
): Promise<AthleteGoal[]> {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.ATHLETE_GOALS),
      where("teamId", "==", teamId),
      where("coachVisible", "==", true)
    )
  );

  return sortGoals(
    snapshot.docs.map((goalDoc) =>
      normalizeAthleteGoal(goalDoc.id, goalDoc.data() as Record<string, unknown>)
    )
  );
}

export function getActiveSessionGoal(
  goals: AthleteGoal[],
  session = getCurrentGoalSession()
): AthleteGoal | null {
  return (
    goals.find(
      (goal) =>
        goal.type === "session" &&
        goal.status === "active" &&
        goal.sessionName === session.sessionName &&
        goal.seasonYear === session.seasonYear
    ) || null
  );
}

export function getActiveYearGoal(
  goals: AthleteGoal[],
  year = new Date().getFullYear()
): AthleteGoal | null {
  return (
    goals.find(
      (goal) =>
        goal.type === "year" &&
        goal.status === "active" &&
        goal.seasonYear === year
    ) || null
  );
}

export function getPracticeCheckInGoalForAttendance(
  goals: AthleteGoal[],
  args: { practiceAttendanceId?: string; practiceEventId?: string }
): AthleteGoal | null {
  return (
    goals.find(
      (goal) =>
        goal.type === "practice_check_in" &&
        goal.status === "active" &&
        ((args.practiceAttendanceId &&
          goal.practiceAttendanceId === args.practiceAttendanceId) ||
          (args.practiceEventId && goal.practiceEventId === args.practiceEventId))
    ) || null
  );
}
