import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import {
  COLLECTIONS,
  type CalendarEvent,
  type PracticeAttendanceRecord,
  type PracticeAttendanceStatus,
  type PracticeSessionAttendanceCounts,
  type WrestlerProfile,
} from "@wrestlewell/types/index";

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

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

function normalizeStatus(value: unknown): PracticeAttendanceStatus {
  switch (value) {
    case "present":
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

function normalizePracticeAttendance(
  id: string,
  value: Record<string, unknown>
): PracticeAttendanceRecord {
  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    calendarEventId:
      typeof value.calendarEventId === "string" ? value.calendarEventId : "",
    practicePlanId:
      typeof value.practicePlanId === "string" ? value.practicePlanId : "",
    date: typeof value.date === "string" ? value.date : "",
    assignmentType:
      value.assignmentType === "group" || value.assignmentType === "custom"
        ? value.assignmentType
        : "team",
    groupId: typeof value.groupId === "string" ? value.groupId : undefined,
    groupName:
      typeof value.groupName === "string" ? value.groupName : undefined,
    assignedWrestlerIds: ensureStringArray(value.assignedWrestlerIds),
    wrestlerId: typeof value.wrestlerId === "string" ? value.wrestlerId : "",
    wrestlerName:
      typeof value.wrestlerName === "string" ? value.wrestlerName : "",
    status: normalizeStatus(value.status),
    checkedInByUserId:
      typeof value.checkedInByUserId === "string"
        ? value.checkedInByUserId
        : undefined,
    checkedInByRole:
      value.checkedInByRole === "athlete" ||
      value.checkedInByRole === "parent" ||
      value.checkedInByRole === "coach"
        ? value.checkedInByRole
        : undefined,
    checkedInAt: normalizeDateValue(value.checkedInAt),
    coachUpdatedBy:
      typeof value.coachUpdatedBy === "string"
        ? value.coachUpdatedBy
        : undefined,
    coachUpdatedAt: normalizeDateValue(value.coachUpdatedAt),
    notes: typeof value.notes === "string" ? value.notes : undefined,
    createdAt: normalizeDateValue(value.createdAt),
    updatedAt: normalizeDateValue(value.updatedAt),
  };
}

export function resolveExpectedWrestlersForCalendarEvent(
  wrestlers: WrestlerProfile[],
  event: Pick<
    CalendarEvent,
    "assignmentType" | "groupId" | "assignedWrestlerIds"
  >
) {
  const assignmentType = event.assignmentType || "team";
  const assignedIds = event.assignedWrestlerIds || [];

  if (
    assignmentType === "team" ||
    (!event.assignmentType && !event.groupId && assignedIds.length === 0)
  ) {
    return wrestlers;
  }

  if (assignmentType === "group" && event.groupId) {
    const groupId = event.groupId;
    return wrestlers.filter(
      (wrestler) =>
        wrestler.primaryTrainingGroupId === groupId ||
        Boolean(wrestler.trainingGroupIds?.includes(groupId))
    );
  }

  return wrestlers.filter((wrestler) => assignedIds.includes(wrestler.id));
}

export function buildAttendanceCounts(
  attendance: Array<{ status: PracticeAttendanceStatus }>
): PracticeSessionAttendanceCounts {
  return attendance.reduce<PracticeSessionAttendanceCounts>(
    (totals, entry) => {
      totals[entry.status] += 1;
      return totals;
    },
    {
      present: 0,
      absent: 0,
      late: 0,
      injured: 0,
      excused: 0,
      not_sure: 0,
      not_checked_in: 0,
    }
  );
}

export async function listPracticeAttendanceForEvent(
  db: Firestore,
  teamId: string,
  calendarEventId: string,
  wrestlerId?: string
): Promise<PracticeAttendanceRecord[]> {
  const filters = [
    where("teamId", "==", teamId),
    where("calendarEventId", "==", calendarEventId),
  ];

  if (wrestlerId) {
    filters.push(where("wrestlerId", "==", wrestlerId));
  }

  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.PRACTICE_ATTENDANCE), ...filters)
  );

  return snapshot.docs
    .map((docSnapshot) =>
      normalizePracticeAttendance(
        docSnapshot.id,
        docSnapshot.data() as Record<string, unknown>
      )
    )
    .sort((a, b) => a.wrestlerName.localeCompare(b.wrestlerName));
}

type UpsertAttendanceInput = {
  teamId: string;
  calendarEventId: string;
  practicePlanId: string;
  date: string;
  assignmentType?: "team" | "group" | "custom";
  groupId?: string;
  groupName?: string;
  assignedWrestlerIds?: string[];
  wrestlerId: string;
  wrestlerName: string;
  status: PracticeAttendanceStatus;
  checkedInByUserId?: string;
  checkedInByRole?: "athlete" | "parent" | "coach";
  notes?: string;
};

export async function upsertPracticeAttendanceCheckIn(
  db: Firestore,
  input: UpsertAttendanceInput
) {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.PRACTICE_ATTENDANCE),
      where("teamId", "==", input.teamId),
      where("calendarEventId", "==", input.calendarEventId),
      where("wrestlerId", "==", input.wrestlerId)
    )
  );

  const existing = snapshot.docs[0];

  const payload = {
    teamId: input.teamId,
    calendarEventId: input.calendarEventId,
    practicePlanId: input.practicePlanId,
    date: input.date,
    assignmentType: input.assignmentType || "team",
    groupId: input.groupId || "",
    groupName: input.groupName || "",
    assignedWrestlerIds: input.assignedWrestlerIds || [],
    wrestlerId: input.wrestlerId,
    wrestlerName: input.wrestlerName,
    status: input.status,
    checkedInByUserId: input.checkedInByUserId || "",
    checkedInByRole: input.checkedInByRole || "athlete",
    checkedInAt: serverTimestamp(),
    notes: input.notes || "",
    updatedAt: serverTimestamp(),
  };

  if (existing) {
    await updateDoc(existing.ref, payload);
    return existing.id;
  }

  const created = await addDoc(collection(db, COLLECTIONS.PRACTICE_ATTENDANCE), {
    ...payload,
    createdAt: serverTimestamp(),
  });

  return created.id;
}

type CoachAttendanceUpdateInput = {
  attendanceId: string;
  status: PracticeAttendanceStatus;
  coachUpdatedBy: string;
  notes?: string;
};

export async function updatePracticeAttendanceByCoach(
  db: Firestore,
  input: CoachAttendanceUpdateInput
) {
  await updateDoc(doc(db, COLLECTIONS.PRACTICE_ATTENDANCE, input.attendanceId), {
    status: input.status,
    coachUpdatedBy: input.coachUpdatedBy,
    coachUpdatedAt: serverTimestamp(),
    notes: input.notes || "",
    updatedAt: serverTimestamp(),
  });
}