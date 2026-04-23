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
import { COLLECTIONS, type WrestlerProfile, type WrestlingStyle } from "@wrestlewell/types/index";

export type WrestlerInput = {
  teamId: string;
  ownerUserId?: string;
  firstName: string;
  lastName: string;
  age?: number;
  grade?: string;
  weightClass?: string;
  schoolOrClub?: string;
  photoUrl?: string;
  styles: WrestlingStyle[];
  strengths: string[];
  weaknesses: string[];
  warmupRoutine: string[];
  keyAttacks: string[];
  keyDefense: string[];
  goals: string[];
  coachNotes?: string;
};

export const WRESTLING_STYLES: WrestlingStyle[] = [
  "Freestyle",
  "Folkstyle",
  "Greco-Roman",
];

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function ensureStyles(value: unknown): WrestlingStyle[] {
  return ensureStringArray(value).filter((item): item is WrestlingStyle =>
    WRESTLING_STYLES.includes(item as WrestlingStyle)
  );
}

function normalizeWrestlerRecord(id: string, value: Record<string, unknown>): WrestlerProfile {
  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    ownerUserId: typeof value.ownerUserId === "string" ? value.ownerUserId : undefined,
    firstName: typeof value.firstName === "string" ? value.firstName : "",
    lastName: typeof value.lastName === "string" ? value.lastName : "",
    photoUrl: typeof value.photoUrl === "string" ? value.photoUrl : undefined,
    age: typeof value.age === "number" ? value.age : undefined,
    grade: typeof value.grade === "string" ? value.grade : undefined,
    weightClass: typeof value.weightClass === "string" ? value.weightClass : undefined,
    schoolOrClub: typeof value.schoolOrClub === "string" ? value.schoolOrClub : undefined,
    styles: ensureStyles(value.styles),
    strengths: ensureStringArray(value.strengths),
    weaknesses: ensureStringArray(value.weaknesses),
    warmupRoutine: ensureStringArray(value.warmupRoutine),
    keyAttacks: ensureStringArray(value.keyAttacks),
    keyDefense: ensureStringArray(value.keyDefense),
    goals: ensureStringArray(value.goals),
    coachNotes: typeof value.coachNotes === "string" ? value.coachNotes : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function buildWrestlerPayload(input: WrestlerInput) {
  return {
    teamId: input.teamId,
    ownerUserId: input.ownerUserId?.trim() || "",
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    photoUrl: input.photoUrl?.trim() || "",
    age: typeof input.age === "number" ? input.age : null,
    grade: input.grade?.trim() || "",
    weightClass: input.weightClass?.trim() || "",
    schoolOrClub: input.schoolOrClub?.trim() || "",
    styles: input.styles,
    strengths: input.strengths,
    weaknesses: input.weaknesses,
    warmupRoutine: input.warmupRoutine,
    keyAttacks: input.keyAttacks,
    keyDefense: input.keyDefense,
    goals: input.goals,
    coachNotes: input.coachNotes?.trim() || "",
  };
}

export async function listWrestlers(db: Firestore, teamId?: string): Promise<WrestlerProfile[]> {
  const snapshot = await getDocs(
    teamId
      ? query(collection(db, COLLECTIONS.WRESTLERS), where("teamId", "==", teamId))
      : collection(db, COLLECTIONS.WRESTLERS)
  );

  return snapshot.docs
    .map((wrestlerDoc) =>
      normalizeWrestlerRecord(wrestlerDoc.id, wrestlerDoc.data() as Record<string, unknown>)
    )
    .sort((a, b) => {
      const lastNameCompare = a.lastName.localeCompare(b.lastName);
      if (lastNameCompare !== 0) {
        return lastNameCompare;
      }

      return a.firstName.localeCompare(b.firstName);
    });
}

export async function createWrestler(db: Firestore, input: WrestlerInput): Promise<string> {
  const wrestlerRef = await addDoc(collection(db, COLLECTIONS.WRESTLERS), {
    ...buildWrestlerPayload(input),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return wrestlerRef.id;
}

export async function updateWrestler(
  db: Firestore,
  wrestlerId: string,
  input: WrestlerInput
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.WRESTLERS, wrestlerId), {
    ...buildWrestlerPayload(input),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteWrestler(db: Firestore, wrestlerId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.MAT_SIDE_SUMMARIES, wrestlerId));
  await deleteDoc(doc(db, COLLECTIONS.WRESTLERS, wrestlerId));
}
