import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import {
  COLLECTIONS,
  type PracticeAttendanceStatus,
  type PracticeSession,
  type PracticeSessionAttendanceCounts,
  type PracticeSessionAttendanceEntry,
} from "@wrestlewell/types/index";

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

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeAttendanceStatus(value: unknown): PracticeAttendanceStatus {
  switch (value) {
    case "absent":
    case "late":
    case "injured":
    case "excused":
    case "not_sure":
    case "not_checked_in":
      return value;
    default:
      return "present";
  }
}

function normalizeAttendanceEntry(value: unknown): PracticeSessionAttendanceEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Record<string, unknown>;
  const wrestlerId = typeof entry.wrestlerId === "string" ? entry.wrestlerId : "";
  const wrestlerName = typeof entry.wrestlerName === "string" ? entry.wrestlerName : "";

  if (!wrestlerId || !wrestlerName) {
    return null;
  }

  return {
    wrestlerId,
    wrestlerName,
    status: normalizeAttendanceStatus(entry.status),
    notes: typeof entry.notes === "string" ? entry.notes : undefined,
    checkedInByUserId:
      typeof entry.checkedInByUserId === "string" ? entry.checkedInByUserId : undefined,
    checkedInByRole:
      entry.checkedInByRole === "athlete" ||
      entry.checkedInByRole === "parent" ||
      entry.checkedInByRole === "coach"
        ? entry.checkedInByRole
        : undefined,
    checkedInAt: normalizeDateValue(entry.checkedInAt),
    coachUpdatedBy:
      typeof entry.coachUpdatedBy === "string" ? entry.coachUpdatedBy : undefined,
    coachUpdatedAt: normalizeDateValue(entry.coachUpdatedAt),
  };
}

function normalizeAttendance(value: unknown): PracticeSessionAttendanceEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeAttendanceEntry(entry))
    .filter((entry): entry is PracticeSessionAttendanceEntry => Boolean(entry));
}

function normalizeAttendanceCounts(
  value: unknown,
  attendance: PracticeSessionAttendanceEntry[]
): PracticeSessionAttendanceCounts | undefined {
  if (value && typeof value === "object") {
    const counts = value as Record<string, unknown>;
    return {
      present: typeof counts.present === "number" ? counts.present : 0,
      absent: typeof counts.absent === "number" ? counts.absent : 0,
      late: typeof counts.late === "number" ? counts.late : 0,
      injured: typeof counts.injured === "number" ? counts.injured : 0,
      excused: typeof counts.excused === "number" ? counts.excused : 0,
      not_sure: typeof counts.not_sure === "number" ? counts.not_sure : 0,
      not_checked_in:
        typeof counts.not_checked_in === "number" ? counts.not_checked_in : 0,
    };
  }

  if (!attendance.length) {
    return undefined;
  }

  return attendance.reduce<PracticeSessionAttendanceCounts>(
    (totals, entry) => {
      totals[entry.status] += 1;
      return totals;
    },
    { present: 0, absent: 0, late: 0, injured: 0, excused: 0, not_sure: 0, not_checked_in: 0 }
  );
}

function normalizePracticeSession(id: string, value: Record<string, unknown>): PracticeSession {
  const attendance = normalizeAttendance(value.attendance);
  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    practicePlanId: typeof value.practicePlanId === "string" ? value.practicePlanId : "",
    practicePlanTitle:
      typeof value.practicePlanTitle === "string" ? value.practicePlanTitle : undefined,
    practicePlanStyle:
      typeof value.practicePlanStyle === "string" ? value.practicePlanStyle : undefined,
    totalSeconds: typeof value.totalSeconds === "number" ? value.totalSeconds : undefined,
    blockCount: typeof value.blockCount === "number" ? value.blockCount : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined,
    completedBy: typeof value.completedBy === "string" ? value.completedBy : undefined,
    completedByRole:
      typeof value.completedByRole === "string" ? value.completedByRole : undefined,
    completedAt: normalizeDateValue(value.completedAt),
    createdAt: normalizeDateValue(value.createdAt),
    updatedAt: normalizeDateValue(value.updatedAt),
    assignmentType:
      value.assignmentType === "group" || value.assignmentType === "custom"
        ? value.assignmentType
        : "team",
    groupId: typeof value.groupId === "string" ? value.groupId : undefined,
    groupName: typeof value.groupName === "string" ? value.groupName : undefined,
    assignedWrestlerIds: ensureStringArray(value.assignedWrestlerIds),
    attendance,
    attendanceCounts: normalizeAttendanceCounts(value.attendanceCounts, attendance),
  };
}

export async function listPracticeSessions(
  db: Firestore,
  teamId: string,
  startDate?: string,
  endDate?: string
): Promise<PracticeSession[]> {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.PRACTICE_SESSIONS),
      where("teamId", "==", teamId),
      orderBy("completedAt", "desc")
    )
  );

  return snapshot.docs
    .map((sessionDoc) =>
      normalizePracticeSession(sessionDoc.id, sessionDoc.data() as Record<string, unknown>)
    )
    .filter((session) => {
      const dateKey = (session.completedAt || session.createdAt).split("T")[0];
      if (!dateKey) return true;
      if (startDate && dateKey < startDate) return false;
      if (endDate && dateKey > endDate) return false;
      return true;
    });
}
