import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS, type MatSideSummary, type WrestlerProfile } from "@wrestlewell/types/index";

export type MatSideSummaryInput = {
  quickReminders: string[];
  warmupChecklist: string[];
  strengths: string[];
  weaknesses: string[];
  gamePlan: string[];
  recentNotes: string[];
};

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

export function emptyMatSideSummary(wrestlerId: string): MatSideSummary {
  return {
    wrestlerId,
    quickReminders: [],
    warmupChecklist: [],
    strengths: [],
    weaknesses: [],
    gamePlan: [],
    recentNotes: [],
    updatedAt: "",
  };
}

export function mergeMatSideSummaryWithProfile(
  wrestler: WrestlerProfile,
  summary: MatSideSummary | null
): MatSideSummary {
  const baseSummary = summary ?? emptyMatSideSummary(wrestler.id);

  return {
    ...baseSummary,
    wrestlerId: wrestler.id,
    warmupChecklist:
      baseSummary.warmupChecklist.length > 0 ? baseSummary.warmupChecklist : wrestler.warmupRoutine,
    strengths: baseSummary.strengths.length > 0 ? baseSummary.strengths : wrestler.strengths,
    weaknesses: baseSummary.weaknesses.length > 0 ? baseSummary.weaknesses : wrestler.weaknesses,
    gamePlan: baseSummary.gamePlan.length > 0 ? baseSummary.gamePlan : wrestler.keyAttacks,
    quickReminders:
      baseSummary.quickReminders.length > 0
        ? baseSummary.quickReminders
        : [wrestler.coachNotes || ""].filter(Boolean),
  };
}

export async function getMatSideSummary(
  db: Firestore,
  wrestlerId: string
): Promise<MatSideSummary | null> {
  const summarySnapshot = await getDoc(doc(db, COLLECTIONS.MAT_SIDE_SUMMARIES, wrestlerId));

  if (!summarySnapshot.exists()) {
    return null;
  }

  const data = summarySnapshot.data() as Record<string, unknown>;

  return {
    wrestlerId,
    quickReminders: ensureStringArray(data.quickReminders),
    warmupChecklist: ensureStringArray(data.warmupChecklist),
    strengths: ensureStringArray(data.strengths),
    weaknesses: ensureStringArray(data.weaknesses),
    gamePlan: ensureStringArray(data.gamePlan),
    recentNotes: ensureStringArray(data.recentNotes),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
  };
}

export async function upsertMatSideSummary(
  db: Firestore,
  wrestlerId: string,
  input: MatSideSummaryInput
): Promise<void> {
  await setDoc(
    doc(db, COLLECTIONS.MAT_SIDE_SUMMARIES, wrestlerId),
    {
      wrestlerId,
      quickReminders: input.quickReminders,
      warmupChecklist: input.warmupChecklist,
      strengths: input.strengths,
      weaknesses: input.weaknesses,
      gamePlan: input.gamePlan,
      recentNotes: input.recentNotes,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function removeMatSideSummary(db: Firestore, wrestlerId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.MAT_SIDE_SUMMARIES, wrestlerId));
}
