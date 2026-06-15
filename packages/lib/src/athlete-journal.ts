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
  ATHLETE_JOURNAL_MOODS,
  ATHLETE_JOURNAL_TAGS,
  COLLECTIONS,
  type AthleteJournalEntry,
  type AthleteJournalMood,
  type AthleteJournalTag,
} from "@wrestlewell/types/index";

export type AthleteJournalEntryInput = {
  teamId: string;
  wrestlerId: string;
  createdByUserId: string;
  title: string;
  body: string;
  mood: AthleteJournalMood;
  practiceDate: string;
  tags: AthleteJournalTag[];
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

function normalizeMood(value: unknown): AthleteJournalMood {
  return ATHLETE_JOURNAL_MOODS.includes(value as AthleteJournalMood)
    ? (value as AthleteJournalMood)
    : "Okay";
}

function normalizeTags(value: unknown): AthleteJournalTag[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value.filter((tag): tag is AthleteJournalTag =>
        ATHLETE_JOURNAL_TAGS.includes(tag as AthleteJournalTag)
      )
    )
  );
}

function buildJournalPayload(input: AthleteJournalEntryInput) {
  return {
    teamId: input.teamId.trim(),
    wrestlerId: input.wrestlerId.trim(),
    createdByUserId: input.createdByUserId.trim(),
    title: input.title.trim(),
    body: input.body.trim(),
    mood: normalizeMood(input.mood),
    practiceDate: input.practiceDate.trim(),
    tags: normalizeTags(input.tags),
    coachVisible: input.coachVisible === true,
  };
}

export function normalizeJournalEntry(
  id: string,
  value: Record<string, unknown>
): AthleteJournalEntry {
  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    wrestlerId: typeof value.wrestlerId === "string" ? value.wrestlerId : "",
    createdByUserId:
      typeof value.createdByUserId === "string" ? value.createdByUserId : "",
    title: typeof value.title === "string" ? value.title : "",
    body: typeof value.body === "string" ? value.body : "",
    mood: normalizeMood(value.mood),
    practiceDate: typeof value.practiceDate === "string" ? value.practiceDate : "",
    tags: normalizeTags(value.tags),
    coachVisible: value.coachVisible === true,
    createdAt: normalizeDateValue(value.createdAt),
    updatedAt: normalizeDateValue(value.updatedAt),
  };
}

export async function createJournalEntry(
  db: Firestore,
  input: AthleteJournalEntryInput
): Promise<string> {
  const journalRef = await addDoc(collection(db, COLLECTIONS.ATHLETE_JOURNAL_ENTRIES), {
    ...buildJournalPayload(input),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return journalRef.id;
}

export async function updateJournalEntry(
  db: Firestore,
  entryId: string,
  input: AthleteJournalEntryInput
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.ATHLETE_JOURNAL_ENTRIES, entryId), {
    ...buildJournalPayload(input),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteJournalEntry(
  db: Firestore,
  entryId: string
): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.ATHLETE_JOURNAL_ENTRIES, entryId));
}

export async function listMyJournalEntries(
  db: Firestore,
  args: { teamId: string; wrestlerId: string; createdByUserId: string }
): Promise<AthleteJournalEntry[]> {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.ATHLETE_JOURNAL_ENTRIES),
      where("teamId", "==", args.teamId),
      where("wrestlerId", "==", args.wrestlerId),
      where("createdByUserId", "==", args.createdByUserId)
    )
  );

  return snapshot.docs
    .map((entryDoc) =>
      normalizeJournalEntry(entryDoc.id, entryDoc.data() as Record<string, unknown>)
    )
    .sort((a, b) => {
      if (a.practiceDate !== b.practiceDate) {
        return b.practiceDate.localeCompare(a.practiceDate);
      }

      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

export async function listCoachVisibleJournalEntriesForTeam(
  db: Firestore,
  teamId: string
): Promise<AthleteJournalEntry[]> {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.ATHLETE_JOURNAL_ENTRIES),
      where("teamId", "==", teamId),
      where("coachVisible", "==", true)
    )
  );

  return snapshot.docs
    .map((entryDoc) =>
      normalizeJournalEntry(entryDoc.id, entryDoc.data() as Record<string, unknown>)
    )
    .sort((a, b) => {
      if (a.practiceDate !== b.practiceDate) {
        return b.practiceDate.localeCompare(a.practiceDate);
      }

      return b.updatedAt.localeCompare(a.updatedAt);
    });
}
