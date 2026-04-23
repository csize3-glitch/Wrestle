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
import { COLLECTIONS, type WrestlerMatch, type WrestlingStyle } from "@wrestlewell/types/index";

export type WrestlerMatchInput = {
  teamId: string;
  wrestlerId: string;
  eventName: string;
  opponentName: string;
  result: WrestlerMatch["result"];
  style: WrestlingStyle;
  weightClass?: string;
  matchDate: string;
  score?: string;
  method?: string;
  notes?: string;
};

function normalizeMatch(id: string, value: Record<string, unknown>): WrestlerMatch {
  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    wrestlerId: typeof value.wrestlerId === "string" ? value.wrestlerId : "",
    eventName: typeof value.eventName === "string" ? value.eventName : "",
    opponentName: typeof value.opponentName === "string" ? value.opponentName : "",
    result: value.result === "loss" ? "loss" : "win",
    style: (typeof value.style === "string" ? value.style : "Folkstyle") as WrestlingStyle,
    weightClass: typeof value.weightClass === "string" ? value.weightClass : undefined,
    matchDate: typeof value.matchDate === "string" ? value.matchDate : "",
    score: typeof value.score === "string" ? value.score : undefined,
    method: typeof value.method === "string" ? value.method : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

export async function listWrestlerMatches(
  db: Firestore,
  args: { teamId: string; wrestlerId: string }
): Promise<WrestlerMatch[]> {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.WRESTLER_MATCHES),
      where("teamId", "==", args.teamId),
      where("wrestlerId", "==", args.wrestlerId)
    )
  );

  return snapshot.docs
    .map((matchDoc) => normalizeMatch(matchDoc.id, matchDoc.data() as Record<string, unknown>))
    .sort((a, b) => b.matchDate.localeCompare(a.matchDate));
}

export async function createWrestlerMatch(
  db: Firestore,
  input: WrestlerMatchInput
): Promise<string> {
  const matchRef = await addDoc(collection(db, COLLECTIONS.WRESTLER_MATCHES), {
    teamId: input.teamId,
    wrestlerId: input.wrestlerId,
    eventName: input.eventName.trim(),
    opponentName: input.opponentName.trim(),
    result: input.result,
    style: input.style,
    weightClass: input.weightClass?.trim() || "",
    matchDate: input.matchDate,
    score: input.score?.trim() || "",
    method: input.method?.trim() || "",
    notes: input.notes?.trim() || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return matchRef.id;
}

export async function updateWrestlerMatch(
  db: Firestore,
  matchId: string,
  input: WrestlerMatchInput
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.WRESTLER_MATCHES, matchId), {
    teamId: input.teamId,
    wrestlerId: input.wrestlerId,
    eventName: input.eventName.trim(),
    opponentName: input.opponentName.trim(),
    result: input.result,
    style: input.style,
    weightClass: input.weightClass?.trim() || "",
    matchDate: input.matchDate,
    score: input.score?.trim() || "",
    method: input.method?.trim() || "",
    notes: input.notes?.trim() || "",
    updatedAt: serverTimestamp(),
  });
}

export async function deleteWrestlerMatch(db: Firestore, matchId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.WRESTLER_MATCHES, matchId));
}
