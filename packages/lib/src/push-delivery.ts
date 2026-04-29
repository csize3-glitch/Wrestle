import type { Firestore } from "firebase/firestore";
import type { NotificationPreferences, UserRole } from "@wrestlewell/types/index";
import { listPushRegistrations } from "./push-registrations";

type PushPreferenceKey = keyof NotificationPreferences;

export type TeamPushDeliveryInput = {
  teamId: string;
  title: string;
  body: string;
  audienceRole?: UserRole;
  targetUserIds?: string[];
  excludeUserIds?: string[];
  preferenceKey?: PushPreferenceKey;
};

type ExpoPushMessage = {
  to: string;
  sound: "default";
  title: string;
  body: string;
};

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

function chunk<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function sendExpoPushBatch(messages: ExpoPushMessage[]) {
  const response = await fetch(EXPO_PUSH_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Expo push send failed: ${response.status} ${errorText}`);
  }
}

export async function sendTeamPushDelivery(
  db: Firestore,
  input: TeamPushDeliveryInput
): Promise<{ delivered: number }> {
  const registrations = await listPushRegistrations(db, input.teamId);
  const allowedTargets = input.targetUserIds ? new Set(input.targetUserIds) : null;
  const blockedTargets = new Set(input.excludeUserIds || []);

  const messages = registrations
    .filter((registration) => registration.expoPushToken)
    .filter((registration) => !input.audienceRole || registration.userRole === input.audienceRole)
    .filter((registration) => !allowedTargets || allowedTargets.has(registration.userId))
    .filter((registration) => !blockedTargets.has(registration.userId))
    .filter((registration) => {
      if (!input.preferenceKey) {
        return true;
      }

      const preferences = registration.notificationPreferences;
      if (!preferences) {
        return true;
      }

      return preferences[input.preferenceKey] !== false;
    })
    .map(
      (registration) =>
        ({
          to: registration.expoPushToken as string,
          sound: "default",
          title: input.title,
          body: input.body,
        }) satisfies ExpoPushMessage
    );

  if (messages.length === 0) {
    return { delivered: 0 };
  }

  for (const batch of chunk(messages, 100)) {
    await sendExpoPushBatch(batch);
  }

  return { delivered: messages.length };
}
