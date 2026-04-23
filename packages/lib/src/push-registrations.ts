import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@wrestlewell/types/index";

export type PushRegistrationInput = {
  userId: string;
  teamId: string;
  platform: string;
  expoPushToken?: string;
  devicePushToken?: string;
  deviceName?: string;
  permissionsStatus?: string;
};

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
