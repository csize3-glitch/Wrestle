import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import {
  COLLECTIONS,
  type MatSideSummary,
  type StyleMatSidePlans,
  type StyleMatSideSection,
  type WrestlerProfile,
  type WrestlingStyle,
} from "@wrestlewell/types/index";
import { WRESTLING_STYLES } from "./wrestlers";

export type MatSideSummaryInput = {
  quickReminders: string[];
  warmupChecklist: string[];
  strengths: string[];
  weaknesses: string[];
  gamePlan: string[];
  recentNotes: string[];
  stylePlans?: StyleMatSidePlans;
};

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function ensureStyleMatSideSection(value: unknown): StyleMatSideSection | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    quickReminders: ensureStringArray(record.quickReminders),
    focusPoints: ensureStringArray(record.focusPoints),
    gamePlan: ensureStringArray(record.gamePlan),
    recentNotes: ensureStringArray(record.recentNotes),
  };
}

function ensureStyleMatSidePlans(value: unknown): StyleMatSidePlans | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const nextPlans: StyleMatSidePlans = {};

  for (const style of WRESTLING_STYLES) {
    const section = ensureStyleMatSideSection(record[style]);
    if (section) {
      nextPlans[style] = section;
    }
  }

  return Object.keys(nextPlans).length > 0 ? nextPlans : undefined;
}

function mergeStylePlanFromProfile(wrestler: WrestlerProfile, style: WrestlingStyle): StyleMatSideSection {
  const profile = wrestler.styleProfiles?.[style];

  return {
    quickReminders: profile?.coachNotes ? [profile.coachNotes] : [],
    focusPoints: profile?.goals || [],
    gamePlan: profile?.keyAttacks || [],
    recentNotes: [],
  };
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
    stylePlans: undefined,
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
    stylePlans:
      baseSummary.stylePlans && Object.keys(baseSummary.stylePlans).length > 0
        ? baseSummary.stylePlans
        : Object.fromEntries(
            wrestler.styles.map((style) => [style, mergeStylePlanFromProfile(wrestler, style)])
          ),
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
    stylePlans: ensureStyleMatSidePlans(data.stylePlans),
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
      stylePlans: input.stylePlans || {},
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function removeMatSideSummary(db: Firestore, wrestlerId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.MAT_SIDE_SUMMARIES, wrestlerId));
}
