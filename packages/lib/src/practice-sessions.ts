import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS, type PracticeSession } from "@wrestlewell/types/index";

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

function normalizePracticeSession(id: string, value: Record<string, unknown>): PracticeSession {
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
