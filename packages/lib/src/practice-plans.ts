import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import {
  COLLECTIONS,
  type PracticePlan,
  type WrestlerProfile,
} from "@wrestlewell/types/index";

export type PracticePlanBlockRecord = {
  id: string;
  practicePlanId: string;
  blockType: "library" | "text";
  libraryItemId?: string;
  title: string;
  style?: string;
  category?: string;
  subcategory?: string;
  format?: string;
  durationMinutes: number;
  durationSeconds: number;
  videoUrl?: string;
  notes?: string;
  orderIndex: number;
};

export type PracticePlanDetail = {
  plan: PracticePlan;
  blocks: PracticePlanBlockRecord[];
};

type PracticeAssignmentViewer =
  | string
  | Pick<WrestlerProfile, "id" | "trainingGroupIds" | "primaryTrainingGroupId">
  | null
  | undefined;

function wrestlerMatchesGroup(
  wrestler: Pick<WrestlerProfile, "trainingGroupIds" | "primaryTrainingGroupId">,
  groupId?: string
) {
  if (!groupId) return false;
  return (
    wrestler.primaryTrainingGroupId === groupId ||
    Boolean(wrestler.trainingGroupIds?.includes(groupId))
  );
}

export function practicePlanMatchesAssignment(
  plan: Pick<PracticePlan, "assignmentType" | "assignedWrestlerIds" | "groupId">,
  wrestler?: PracticeAssignmentViewer
) {
  if (plan.assignmentType === "group") {
    if (!wrestler || typeof wrestler === "string") {
      return false;
    }

    return wrestlerMatchesGroup(wrestler, plan.groupId);
  }

  const wrestlerId = typeof wrestler === "string" ? wrestler : wrestler?.id;
  const assignedIds = plan.assignedWrestlerIds || [];
  if (assignedIds.length === 0) {
    return true;
  }

  return Boolean(wrestlerId && assignedIds.includes(wrestlerId));
}

function normalizePracticePlan(id: string, value: Record<string, unknown>): PracticePlan {
  const totalSeconds =
    typeof value.totalSeconds === "number"
      ? value.totalSeconds
      : typeof value.totalMinutes === "number"
        ? Math.round(value.totalMinutes * 60)
        : 0;
  return {
    id,
    teamId: typeof value.teamId === "string" ? value.teamId : "",
    title: typeof value.title === "string" ? value.title : "",
    assignmentType:
      value.assignmentType === "group" || value.assignmentType === "custom"
        ? value.assignmentType
        : "team",
    groupId: typeof value.groupId === "string" ? value.groupId : undefined,
    groupName: typeof value.groupName === "string" ? value.groupName : undefined,
    assignedWrestlerIds: Array.isArray(value.assignedWrestlerIds)
      ? value.assignedWrestlerIds.filter((entry): entry is string => typeof entry === "string")
      : [],
    style:
      value.style === "Freestyle" || value.style === "Folkstyle" || value.style === "Greco-Roman"
        ? value.style
        : "Mixed",
    level: typeof value.level === "string" ? value.level : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
    totalMinutes:
      typeof value.totalMinutes === "number" ? value.totalMinutes : Math.round(totalSeconds / 60),
    totalSeconds,
    createdBy: typeof value.createdBy === "string" ? value.createdBy : "",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function normalizePracticeBlock(
  id: string,
  value: Record<string, unknown>
): PracticePlanBlockRecord {
  const durationSeconds =
    typeof value.durationSeconds === "number"
      ? value.durationSeconds
      : typeof value.durationMinutes === "number"
        ? Math.round(value.durationMinutes * 60)
        : 0;
  return {
    id,
    practicePlanId: typeof value.practicePlanId === "string" ? value.practicePlanId : "",
    blockType: value.blockType === "text" ? "text" : "library",
    libraryItemId: typeof value.libraryItemId === "string" ? value.libraryItemId : undefined,
    title: typeof value.title === "string" ? value.title : "",
    style: typeof value.style === "string" ? value.style : undefined,
    category: typeof value.category === "string" ? value.category : undefined,
    subcategory: typeof value.subcategory === "string" ? value.subcategory : undefined,
    format: typeof value.format === "string" ? value.format : undefined,
    durationMinutes:
      typeof value.durationMinutes === "number"
        ? value.durationMinutes
        : Math.max(1, Math.round(durationSeconds / 60)),
    durationSeconds,
    videoUrl: typeof value.videoUrl === "string" ? value.videoUrl : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined,
    orderIndex: typeof value.orderIndex === "number" ? value.orderIndex : 0,
  };
}

export async function listPracticePlans(
  db: Firestore,
  teamId: string,
  wrestler?: PracticeAssignmentViewer
): Promise<PracticePlan[]> {
  const snapshot = await getDocs(
    query(collection(db, COLLECTIONS.PRACTICE_PLANS), where("teamId", "==", teamId))
  );

  return snapshot.docs
    .map((planDoc) =>
      normalizePracticePlan(planDoc.id, planDoc.data() as Record<string, unknown>)
    )
    .filter((plan) => practicePlanMatchesAssignment(plan, wrestler))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getPracticePlanDetail(
  db: Firestore,
  teamId: string,
  planId: string,
  wrestler?: PracticeAssignmentViewer
): Promise<PracticePlanDetail | null> {
  const planSnapshot = await getDoc(doc(db, COLLECTIONS.PRACTICE_PLANS, planId));
  if (!planSnapshot.exists()) {
    return null;
  }

  const plan = normalizePracticePlan(planSnapshot.id, planSnapshot.data() as Record<string, unknown>);
  if (plan.teamId !== teamId) {
    return null;
  }

  if (!practicePlanMatchesAssignment(plan, wrestler)) {
    return null;
  }

  const blocksSnapshot = await getDocs(
    query(collection(db, COLLECTIONS.PRACTICE_BLOCKS), where("practicePlanId", "==", planId))
  );

  const blocks = blocksSnapshot.docs
    .map((blockDoc) =>
      normalizePracticeBlock(blockDoc.id, blockDoc.data() as Record<string, unknown>)
    )
    .sort((a, b) => a.orderIndex - b.orderIndex);

  return { plan, blocks };
}
