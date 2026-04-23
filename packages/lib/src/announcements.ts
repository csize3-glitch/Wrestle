import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS, type TeamAnnouncement } from "@wrestlewell/types/index";

export type TeamAnnouncementInput = {
  teamId: string;
  title: string;
  body: string;
  createdBy: string;
};

function normalizeDate(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  return "";
}

function normalizeAnnouncement(
  id: string,
  value: Record<string, unknown>
): TeamAnnouncement {
  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    title: typeof value.title === "string" ? value.title : "",
    body: typeof value.body === "string" ? value.body : "",
    createdBy: typeof value.createdBy === "string" ? value.createdBy : "",
    createdAt: normalizeDate(value.createdAt),
    updatedAt: normalizeDate(value.updatedAt),
  };
}

export async function listTeamAnnouncements(
  db: Firestore,
  teamId: string
): Promise<TeamAnnouncement[]> {
  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.TEAM_ANNOUNCEMENTS), where("teamId", "==", teamId))
  );

  return snapshot.docs
    .map((docSnapshot) =>
      normalizeAnnouncement(docSnapshot.id, docSnapshot.data() as Record<string, unknown>)
    )
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function createTeamAnnouncement(
  db: Firestore,
  input: TeamAnnouncementInput
): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.TEAM_ANNOUNCEMENTS), {
    teamId: input.teamId,
    title: input.title.trim(),
    body: input.body.trim(),
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return ref.id;
}
