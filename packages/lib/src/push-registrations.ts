import { collection, doc, getDocs, query, serverTimestamp, setDoc, where, type Firestore } from "firebase/firestore";
import { COLLECTIONS, type DevicePushRegistration, type NotificationPreferences, type UserRole } from "@wrestlewell/types/index";

export type PushRegistrationInput = {
  userId: string;
  teamId: string;
  userRole?: UserRole;
  notificationPreferences?: NotificationPreferences;
  platform: string;
  expoPushToken?: string;
  devicePushToken?: string;
  deviceName?: string;
  permissionsStatus?: string;
};

function normalizeNotificationPreferences(value: unknown): NotificationPreferences | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return {
    announcements: record.announcements !== false,
    tournamentAlerts: record.tournamentAlerts !== false,
    practiceReminders: record.practiceReminders !== false,
  };
}

function normalizeRegistration(id: string, value: Record<string, unknown>): DevicePushRegistration {
  return {
    id,
    userId: typeof value.userId === "string" ? value.userId : "",
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    userRole: value.userRole === "coach" || value.userRole === "athlete" ? value.userRole : undefined,
    notificationPreferences: normalizeNotificationPreferences(value.notificationPreferences),
    platform: typeof value.platform === "string" ? value.platform : "",
    expoPushToken: typeof value.expoPushToken === "string" ? value.expoPushToken : undefined,
    devicePushToken: typeof value.devicePushToken === "string" ? value.devicePushToken : undefined,
    deviceName: typeof value.deviceName === "string" ? value.deviceName : undefined,
    permissionsStatus: typeof value.permissionsStatus === "string" ? value.permissionsStatus : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function makeRegistrationId(input: Pick<PushRegistrationInput, "userId" | "platform">) {
  return `${input.userId}_${input.platform}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
}

export async function upsertPushRegistration(
  db: Firestore,
  input: PushRegistrationInput
): Promise<string> {
  const id = makeRegistrationId(input);

  await setDoc(
    doc(db, COLLECTIONS.DEVICE_PUSH_REGISTRATIONS, id),
    {
      userId: input.userId,
      teamId: input.teamId,
      userRole: input.userRole || "",
      notificationPreferences: input.notificationPreferences || {},
      platform: input.platform,
      expoPushToken: input.expoPushToken || "",
      devicePushToken: input.devicePushToken || "",
      deviceName: input.deviceName || "",
      permissionsStatus: input.permissionsStatus || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return id;
}

export async function listPushRegistrations(
  db: Firestore,
  teamId: string
): Promise<DevicePushRegistration[]> {
  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.DEVICE_PUSH_REGISTRATIONS), where("teamId", "==", teamId))
  );

  return snapshot.docs.map((docSnapshot) =>
    normalizeRegistration(docSnapshot.id, docSnapshot.data() as Record<string, unknown>)
  );
}
