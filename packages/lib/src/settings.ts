import { doc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore";
import { COLLECTIONS, type NotificationPreferences } from "@wrestlewell/types/index";

export async function updateUserNotificationPreferences(
  db: Firestore,
  userId: string,
  preferences: NotificationPreferences
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.USERS, userId), {
    notificationPreferences: preferences,
    updatedAt: serverTimestamp(),
  });
}

export async function markNotificationsSeenRemote(
  db: Firestore,
  userId: string,
  isoDate: string
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.USERS, userId), {
    lastSeenNotificationsAt: isoDate,
    updatedAt: serverTimestamp(),
  });
}

export async function updateTeamBranding(
  db: Firestore,
  teamId: string,
  args: { name: string; logoUrl?: string }
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.TEAMS, teamId), {
    name: args.name.trim(),
    logoUrl: args.logoUrl?.trim() || "",
    updatedAt: serverTimestamp(),
  });
}
