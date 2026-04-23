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
import { COLLECTIONS, type Tournament } from "@wrestlewell/types/index";

export type TournamentInput = {
  teamId: string;
  name: string;
  registrationUrl: string;
  eventDate?: string;
  notes?: string;
  weighInTime?: string;
  arrivalTime?: string;
  travelChecklist?: string[];
  coachChecklist?: string[];
  coachEventNotes?: string;
  source?: Tournament["source"];
};

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function normalizeTournament(id: string, value: Record<string, unknown>): Tournament {
  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    name: typeof value.name === "string" ? value.name : "",
    registrationUrl: typeof value.registrationUrl === "string" ? value.registrationUrl : "",
    eventDate: typeof value.eventDate === "string" ? value.eventDate : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined,
    weighInTime: typeof value.weighInTime === "string" ? value.weighInTime : undefined,
    arrivalTime: typeof value.arrivalTime === "string" ? value.arrivalTime : undefined,
    travelChecklist: ensureStringArray(value.travelChecklist),
    coachChecklist: ensureStringArray(value.coachChecklist),
    coachEventNotes:
      typeof value.coachEventNotes === "string" ? value.coachEventNotes : undefined,
    source: value.source === "manual" ? "manual" : "excel_import",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

export async function listTournaments(db: Firestore, teamId?: string): Promise<Tournament[]> {
  const tournamentMap = new Map<string, Tournament>();

  const globalSnapshot = await getDocs(
    query(collection(db, COLLECTIONS.TOURNAMENTS), where("source", "==", "excel_import"))
  );

  for (const tournamentDoc of globalSnapshot.docs) {
    const tournament = normalizeTournament(
      tournamentDoc.id,
      tournamentDoc.data() as Record<string, unknown>
    );
    tournamentMap.set(tournament.id, tournament);
  }

  if (teamId) {
    const teamSnapshot = await getDocs(
      query(collection(db, COLLECTIONS.TOURNAMENTS), where("teamId", "==", teamId))
    );

    for (const tournamentDoc of teamSnapshot.docs) {
      const tournament = normalizeTournament(
        tournamentDoc.id,
        tournamentDoc.data() as Record<string, unknown>
      );
      tournamentMap.set(tournament.id, tournament);
    }
  }

  return Array.from(tournamentMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createTournament(db: Firestore, input: TournamentInput): Promise<string> {
  const tournamentRef = await addDoc(collection(db, COLLECTIONS.TOURNAMENTS), {
    teamId: input.teamId,
    name: input.name.trim(),
    registrationUrl: input.registrationUrl.trim(),
    eventDate: input.eventDate?.trim() || "",
    notes: input.notes?.trim() || "",
    weighInTime: input.weighInTime?.trim() || "",
    arrivalTime: input.arrivalTime?.trim() || "",
    travelChecklist: input.travelChecklist || [],
    coachChecklist: input.coachChecklist || [],
    coachEventNotes: input.coachEventNotes?.trim() || "",
    source: input.source || "manual",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return tournamentRef.id;
}

export async function updateTournament(
  db: Firestore,
  tournamentId: string,
  input: TournamentInput
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.TOURNAMENTS, tournamentId), {
    teamId: input.teamId,
    name: input.name.trim(),
    registrationUrl: input.registrationUrl.trim(),
    eventDate: input.eventDate?.trim() || "",
    notes: input.notes?.trim() || "",
    weighInTime: input.weighInTime?.trim() || "",
    arrivalTime: input.arrivalTime?.trim() || "",
    travelChecklist: input.travelChecklist || [],
    coachChecklist: input.coachChecklist || [],
    coachEventNotes: input.coachEventNotes?.trim() || "",
    source: input.source || "manual",
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTournament(db: Firestore, tournamentId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.TOURNAMENTS, tournamentId));
}
