import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS, type TeamNotification, type UserRole } from "@wrestlewell/types/index";

export type TeamNotificationInput = {
  teamId: string;
  audienceRole?: UserRole;
  title: string;
  body: string;
  type: TeamNotification["type"];
  createdBy: string;
  tournamentId?: string;
  tournamentEntryId?: string;
  wrestlerId?: string;
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

function normalizeTeamNotification(
  id: string,
  value: Record<string, unknown>
): TeamNotification {
  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    audienceRole:
      value.audienceRole === "coach" || value.audienceRole === "athlete"
        ? value.audienceRole
        : undefined,
    title: typeof value.title === "string" ? value.title : "",
    body: typeof value.body === "string" ? value.body : "",
    type: value.type === "tournament_registration" ? "tournament_registration" : "system",
    createdBy: typeof value.createdBy === "string" ? value.createdBy : "",
    tournamentId: typeof value.tournamentId === "string" ? value.tournamentId : undefined,
    tournamentEntryId:
      typeof value.tournamentEntryId === "string" ? value.tournamentEntryId : undefined,
    wrestlerId: typeof value.wrestlerId === "string" ? value.wrestlerId : undefined,
    createdAt: normalizeDate(value.createdAt),
    updatedAt: normalizeDate(value.updatedAt),
  };
}

export async function listTeamNotifications(
  db: Firestore,
  teamId: string,
  audienceRole?: UserRole
): Promise<TeamNotification[]> {
  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.TEAM_NOTIFICATIONS), where("teamId", "==", teamId))
  );

  return snapshot.docs
    .map((docSnapshot) =>
      normalizeTeamNotification(docSnapshot.id, docSnapshot.data() as Record<string, unknown>)
    )
    .filter((item) => !audienceRole || !item.audienceRole || item.audienceRole === audienceRole)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function createTeamNotification(
  db: Firestore,
  input: TeamNotificationInput
): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.TEAM_NOTIFICATIONS), {
    teamId: input.teamId,
    audienceRole: input.audienceRole || "",
    title: input.title.trim(),
    body: input.body.trim(),
    type: input.type,
    createdBy: input.createdBy,
    tournamentId: input.tournamentId || "",
    tournamentEntryId: input.tournamentEntryId || "",
    wrestlerId: input.wrestlerId || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return ref.id;
}
