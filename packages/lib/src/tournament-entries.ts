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
import { COLLECTIONS, type TournamentEntry, type WrestlingStyle } from "@wrestlewell/types/index";

export type TournamentEntryInput = {
  teamId: string;
  tournamentId: string;
  wrestlerId: string;
  wrestlerName: string;
  style?: WrestlingStyle;
  weightClass?: string;
  status?: TournamentEntry["status"];
  notes?: string;
};

function normalizeTournamentEntry(
  id: string,
  value: Record<string, unknown>
): TournamentEntry {
  const status =
    value.status === "confirmed"
      ? "confirmed"
      : value.status === "submitted"
        ? "submitted"
        : "planned";

  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    tournamentId: typeof value.tournamentId === "string" ? value.tournamentId : "",
    wrestlerId: typeof value.wrestlerId === "string" ? value.wrestlerId : "",
    wrestlerName: typeof value.wrestlerName === "string" ? value.wrestlerName : "",
    style: typeof value.style === "string" ? (value.style as WrestlingStyle) : undefined,
    weightClass: typeof value.weightClass === "string" ? value.weightClass : undefined,
    status,
    notes: typeof value.notes === "string" ? value.notes : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

export async function listTournamentEntries(
  db: Firestore,
  args: { teamId: string; tournamentId: string }
): Promise<TournamentEntry[]> {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.TOURNAMENT_ENTRIES),
      where("teamId", "==", args.teamId),
      where("tournamentId", "==", args.tournamentId)
    )
  );

  return snapshot.docs
    .map((entryDoc) =>
      normalizeTournamentEntry(entryDoc.id, entryDoc.data() as Record<string, unknown>)
    )
    .sort((a, b) => a.wrestlerName.localeCompare(b.wrestlerName));
}

export async function createTournamentEntry(
  db: Firestore,
  input: TournamentEntryInput
): Promise<string> {
  const entryRef = await addDoc(collection(db, COLLECTIONS.TOURNAMENT_ENTRIES), {
    teamId: input.teamId,
    tournamentId: input.tournamentId,
    wrestlerId: input.wrestlerId,
    wrestlerName: input.wrestlerName.trim(),
    style: input.style || "",
    weightClass: input.weightClass?.trim() || "",
    status: input.status || "planned",
    notes: input.notes?.trim() || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return entryRef.id;
}

export async function updateTournamentEntry(
  db: Firestore,
  entryId: string,
  input: TournamentEntryInput
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.TOURNAMENT_ENTRIES, entryId), {
    teamId: input.teamId,
    tournamentId: input.tournamentId,
    wrestlerId: input.wrestlerId,
    wrestlerName: input.wrestlerName.trim(),
    style: input.style || "",
    weightClass: input.weightClass?.trim() || "",
    status: input.status || "planned",
    notes: input.notes?.trim() || "",
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTournamentEntry(db: Firestore, entryId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.TOURNAMENT_ENTRIES, entryId));
}

export async function updateTournamentEntryStatus(
  db: Firestore,
  entry: TournamentEntry,
  status: TournamentEntry["status"]
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.TOURNAMENT_ENTRIES, entry.id), {
    teamId: entry.teamId,
    tournamentId: entry.tournamentId,
    wrestlerId: entry.wrestlerId,
    wrestlerName: entry.wrestlerName.trim(),
    style: entry.style || "",
    weightClass: entry.weightClass?.trim() || "",
    status,
    notes: entry.notes?.trim() || "",
    updatedAt: serverTimestamp(),
  });
}
