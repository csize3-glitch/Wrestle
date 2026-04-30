import {
  collection,
  getDocs,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS, type CalendarEvent } from "@wrestlewell/types/index";

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

export async function listCalendarEvents(
  db: Firestore,
  teamId: string,
  wrestlerId?: string | null
): Promise<CalendarEventRecord[]> {
  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.CALENDAR_EVENTS), where("teamId", "==", teamId))
  );

  return snapshot.docs
    .map((eventDoc) =>
      normalizeCalendarEvent(eventDoc.id, eventDoc.data() as Record<string, unknown>)
    )
    .filter((event) => {
      const assignedIds = event.assignedWrestlerIds || [];
      if (assignedIds.length === 0) {
        return true;
      }
      return Boolean(wrestlerId && assignedIds.includes(wrestlerId));
    })
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}
