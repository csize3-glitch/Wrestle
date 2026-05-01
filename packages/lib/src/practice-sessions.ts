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
  type PracticeSessionFollowUp,
  type PracticeSessionWrestlerNote,
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

function normalizeWrestlerNote(value: unknown): PracticeSessionWrestlerNote | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const note = value as Record<string, unknown>;
  const wrestlerId = typeof note.wrestlerId === "string" ? note.wrestlerId : "";
  const wrestlerName = typeof note.wrestlerName === "string" ? note.wrestlerName : "";
  const text = typeof note.note === "string" ? note.note : "";

  if (!wrestlerId || !wrestlerName || !text.trim()) {
    return null;
  }

  return {
    wrestlerId,
    wrestlerName,
    note: text,
    tags: ensureStringArray(note.tags),
    visibility:
      note.visibility === "athlete_visible" || note.visibility === "parent_visible"
        ? note.visibility
        : "coach_only",
    createdAt: normalizeDateValue(note.createdAt),
    createdBy: typeof note.createdBy === "string" ? note.createdBy : "",
  };
}

function normalizeWrestlerNotes(value: unknown): PracticeSessionWrestlerNote[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeWrestlerNote(entry))
    .filter((entry): entry is PracticeSessionWrestlerNote => Boolean(entry));
}

function normalizeFollowUp(value: unknown): PracticeSessionFollowUp | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const followUp = value as Record<string, unknown>;
  const id = typeof followUp.id === "string" ? followUp.id : "";
  const title = typeof followUp.title === "string" ? followUp.title : "";

  if (!id || !title.trim()) {
    return null;
  }

  return {
    id,
    wrestlerId: typeof followUp.wrestlerId === "string" ? followUp.wrestlerId : undefined,
    wrestlerName:
      typeof followUp.wrestlerName === "string" ? followUp.wrestlerName : undefined,
    title,
    details: typeof followUp.details === "string" ? followUp.details : undefined,
    category: typeof followUp.category === "string" ? followUp.category : "technique",
    status: followUp.status === "done" ? "done" : "open",
    dueDate: typeof followUp.dueDate === "string" ? followUp.dueDate : undefined,
    createdAt: normalizeDateValue(followUp.createdAt),
    createdBy: typeof followUp.createdBy === "string" ? followUp.createdBy : "",
    completedAt: normalizeDateValue(followUp.completedAt),
  };
}

function normalizeFollowUps(value: unknown): PracticeSessionFollowUp[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeFollowUp(entry))
    .filter((entry): entry is PracticeSessionFollowUp => Boolean(entry));
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
  const wrestlerNotes = normalizeWrestlerNotes(value.wrestlerNotes);
  const followUps = normalizeFollowUps(value.followUps);
  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    practicePlanId: typeof value.practicePlanId === "string" ? value.practicePlanId : "",
    calendarEventId:
      typeof value.calendarEventId === "string" ? value.calendarEventId : undefined,
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
    wrestlerNotes,
    followUps,
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

export async function listPracticeSessionsForWrestler(
  db: Firestore,
  teamId: string,
  wrestlerId: string
): Promise<PracticeSession[]> {
  const sessions = await listPracticeSessions(db, teamId);
  return sessions.filter(
    (session) =>
      session.wrestlerNotes?.some((note) => note.wrestlerId === wrestlerId) ||
      session.followUps?.some((followUp) => followUp.wrestlerId === wrestlerId) ||
      session.attendance?.some((entry) => entry.wrestlerId === wrestlerId)
  );
}
