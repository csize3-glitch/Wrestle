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
  orderBy,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS, type TrainingGroup } from "@wrestlewell/types/index";

export type TrainingGroupInput = {
  teamId: string;
  name: string;
  description?: string;
  sortOrder: number;
  active?: boolean;
};

function normalizeTrainingGroup(id: string, value: Record<string, unknown>): TrainingGroup {
  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    name: typeof value.name === "string" ? value.name : "",
    description: typeof value.description === "string" ? value.description : undefined,
    sortOrder: typeof value.sortOrder === "number" ? value.sortOrder : 0,
    active: typeof value.active === "boolean" ? value.active : true,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function buildTrainingGroupPayload(input: TrainingGroupInput) {
  return {
    teamId: input.teamId,
    name: input.name.trim(),
    description: input.description?.trim() || "",
    sortOrder: input.sortOrder,
    active: input.active ?? true,
  };
}

export async function listTrainingGroups(db: Firestore, teamId: string): Promise<TrainingGroup[]> {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.TRAINING_GROUPS),
      where("teamId", "==", teamId),
      orderBy("sortOrder", "asc")
    )
  );

  return snapshot.docs
    .map((groupDoc) =>
      normalizeTrainingGroup(groupDoc.id, groupDoc.data() as Record<string, unknown>)
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export async function createTrainingGroup(
  db: Firestore,
  input: TrainingGroupInput
): Promise<string> {
  const groupRef = await addDoc(collection(db, COLLECTIONS.TRAINING_GROUPS), {
    ...buildTrainingGroupPayload(input),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return groupRef.id;
}

export async function updateTrainingGroup(
  db: Firestore,
  groupId: string,
  input: Partial<TrainingGroupInput>
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.TRAINING_GROUPS, groupId), {
    ...(input.teamId ? { teamId: input.teamId } : {}),
    ...(typeof input.name === "string" ? { name: input.name.trim() } : {}),
    ...(typeof input.description === "string" ? { description: input.description.trim() } : {}),
    ...(typeof input.sortOrder === "number" ? { sortOrder: input.sortOrder } : {}),
    ...(typeof input.active === "boolean" ? { active: input.active } : {}),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTrainingGroup(db: Firestore, groupId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.TRAINING_GROUPS, groupId));
}
