import {
  doc,
  collection,
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
  type PracticeSession,
  type WrestlerProfile,
} from "@wrestlewell/types/index";

export type CalendarEventRecord = CalendarEvent & {
  practicePlanTitle?: string;
  practicePlanStyle?: string;
  totalMinutes?: number;
};

function normalizeCalendarEvent(
  id: string,
  value: Record<string, unknown>
): CalendarEventRecord {
  const totalSeconds =
    typeof value.totalSeconds === "number"
      ? value.totalSeconds
      : typeof value.totalMinutes === "number"
        ? Math.round(value.totalMinutes * 60)
        : 0;

  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    practicePlanId: typeof value.practicePlanId === "string" ? value.practicePlanId : "",
    assignmentType:
      value.assignmentType === "group" || value.assignmentType === "custom"
        ? value.assignmentType
        : "team",
    groupId: typeof value.groupId === "string" ? value.groupId : undefined,
    groupName: typeof value.groupName === "string" ? value.groupName : undefined,
    assignedWrestlerIds: Array.isArray(value.assignedWrestlerIds)
      ? value.assignedWrestlerIds.filter((entry): entry is string => typeof entry === "string")
      : [],
    date: typeof value.date === "string" ? value.date : "",
    startTime: typeof value.startTime === "string" ? value.startTime : undefined,
    endTime: typeof value.endTime === "string" ? value.endTime : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined,
    status: value.status === "completed" ? "completed" : "scheduled",
    completedPracticeSessionId:
      typeof value.completedPracticeSessionId === "string"
        ? value.completedPracticeSessionId
        : undefined,
    completedAt: normalizeDateValue(value.completedAt),
    completedBy: typeof value.completedBy === "string" ? value.completedBy : undefined,
    attendanceCounts:
      value.attendanceCounts && typeof value.attendanceCounts === "object"
        ? {
            present:
              typeof (value.attendanceCounts as Record<string, unknown>).present === "number"
                ? ((value.attendanceCounts as Record<string, unknown>).present as number)
                : 0,
            absent:
              typeof (value.attendanceCounts as Record<string, unknown>).absent === "number"
                ? ((value.attendanceCounts as Record<string, unknown>).absent as number)
                : 0,
            late:
              typeof (value.attendanceCounts as Record<string, unknown>).late === "number"
                ? ((value.attendanceCounts as Record<string, unknown>).late as number)
                : 0,
            injured:
              typeof (value.attendanceCounts as Record<string, unknown>).injured === "number"
                ? ((value.attendanceCounts as Record<string, unknown>).injured as number)
                : 0,
            excused:
              typeof (value.attendanceCounts as Record<string, unknown>).excused === "number"
                ? ((value.attendanceCounts as Record<string, unknown>).excused as number)
                : 0,
            not_sure:
              typeof (value.attendanceCounts as Record<string, unknown>).not_sure === "number"
                ? ((value.attendanceCounts as Record<string, unknown>).not_sure as number)
                : 0,
            not_checked_in:
              typeof (value.attendanceCounts as Record<string, unknown>).not_checked_in ===
              "number"
                ? ((value.attendanceCounts as Record<string, unknown>).not_checked_in as number)
                : 0,
          }
        : undefined,
    postPracticeNotesPreview:
      typeof value.postPracticeNotesPreview === "string"
        ? value.postPracticeNotesPreview
        : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    totalSeconds,
    practicePlanTitle:
      typeof value.practicePlanTitle === "string" ? value.practicePlanTitle : undefined,
    practicePlanStyle:
      typeof value.practicePlanStyle === "string" ? value.practicePlanStyle : undefined,
    totalMinutes:
      typeof value.totalMinutes === "number" ? value.totalMinutes : Math.round(totalSeconds / 60),
  };
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

function compactUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => typeof entry !== "undefined")
  ) as Partial<T>;
}

type CalendarEventViewer =
  | string
  | Pick<WrestlerProfile, "id" | "trainingGroupIds" | "primaryTrainingGroupId">
  | null
  | undefined;

export function calendarEventMatchesWrestler(
  event: Pick<CalendarEventRecord, "assignmentType" | "assignedWrestlerIds" | "groupId">,
  wrestler?: CalendarEventViewer
) {
  const assignedIds = event.assignedWrestlerIds || [];
  const assignmentType = event.assignmentType || "";

  if (assignmentType === "team") {
    return true;
  }

  if (!assignmentType && assignedIds.length === 0 && !event.groupId) {
    return true;
  }

  if (!wrestler) {
    return false;
  }

  const wrestlerId = typeof wrestler === "string" ? wrestler : wrestler.id;

  if (assignmentType === "custom") {
    return assignedIds.includes(wrestlerId);
  }

  if (assignmentType === "group") {
    if (assignedIds.includes(wrestlerId)) {
      return true;
    }

    if (typeof wrestler === "string") {
      return false;
    }

    return (
      event.groupId === wrestler.primaryTrainingGroupId ||
      Boolean(wrestler.trainingGroupIds?.includes(event.groupId || ""))
    );
  }

  return assignedIds.includes(wrestlerId);
}

export async function listCalendarEvents(
  db: Firestore,
  teamId: string,
  wrestler?: CalendarEventViewer
): Promise<CalendarEventRecord[]> {
  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.CALENDAR_EVENTS), where("teamId", "==", teamId))
  );

  const rows = snapshot.docs.map((eventDoc) =>
      normalizeCalendarEvent(eventDoc.id, eventDoc.data() as Record<string, unknown>)
    );

  if (typeof wrestler === "undefined") {
    return rows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }

  return rows
    .filter((event) => calendarEventMatchesWrestler(event, wrestler))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

export async function completeCalendarPracticeEvent(
  db: Firestore,
  input: {
    calendarEventId: string;
    practiceSessionId: string;
    completedBy: string;
    attendanceCounts?: PracticeSession["attendanceCounts"];
    postPracticeNotesPreview?: string;
  }
) {
  await updateDoc(
    doc(db, COLLECTIONS.CALENDAR_EVENTS, input.calendarEventId),
    compactUndefined({
      status: "completed",
      completedPracticeSessionId: input.practiceSessionId,
      completedAt: serverTimestamp(),
      completedBy: input.completedBy,
      attendanceCounts: input.attendanceCounts,
      postPracticeNotesPreview: input.postPracticeNotesPreview?.trim()
        ? input.postPracticeNotesPreview.trim().slice(0, 240)
        : "",
      updatedAt: serverTimestamp(),
    })
  );
}
