"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@wrestlewell/firebase/client";
import { listWrestlers } from "@wrestlewell/lib/index";
import { COLLECTIONS, type LibraryItem, type WrestlerProfile } from "@wrestlewell/types/index";
import { RequireAuth } from "../require-auth";
import { useAuthState } from "../auth-provider";
import { StatusBanner, type StatusMessage } from "../status-banner";

type PracticeBlock = {
  id: string;
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
  notes: string;
};

type PracticeBlockWithOrder = PracticeBlock & {
  orderIndex: number;
};

type SavedPracticePlan = {
  id: string;
  title: string;
  style: string;
  totalMinutes: number;
  totalSeconds?: number;
  assignedWrestlerIds?: string[];
};

type PlanSnapshot = {
  planId: string | null;
  title: string;
  style: string;
  blocks: string;
};

type ImportedPlan = {
  title: string;
  style: string;
  level: string;
  description: string;
  blocks: PracticeBlock[];
};

function createPlanSnapshot(args: {
  planId: string | null;
  title: string;
  style: string;
  blocks: PracticeBlock[];
}): PlanSnapshot {
  return {
    planId: args.planId,
    title: args.title.trim(),
    style: args.style,
    blocks: JSON.stringify(
      args.blocks.map((block) => ({
        blockType: block.blockType,
        libraryItemId: block.libraryItemId || "",
        title: block.title.trim(),
        style: block.style || "",
        category: block.category || "",
        subcategory: block.subcategory || "",
        format: block.format || "",
        durationMinutes: block.durationMinutes,
        durationSeconds: block.durationSeconds,
        videoUrl: block.videoUrl || "",
        notes: block.notes.trim(),
      }))
    ),
  };
}

function formatDurationLabel(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatAssignmentSummary(wrestlers: WrestlerProfile[], assignedIds: string[]) {
  if (assignedIds.length === 0) {
    return "Team-wide";
  }

  const names = assignedIds
    .map((id) => wrestlers.find((wrestler) => wrestler.id === id))
    .filter((wrestler): wrestler is WrestlerProfile => Boolean(wrestler))
    .map((wrestler) => `${wrestler.firstName} ${wrestler.lastName}`.trim());

  if (names.length === 0) {
    return `${assignedIds.length} assigned`;
  }

  if (names.length <= 2) {
    return names.join(", ");
  }

  return `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
}

function parseDurationInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes(":")) {
    const [minutesPart, secondsPart] = trimmed.split(":");
    const minutes = Number(minutesPart);
    const seconds = Number(secondsPart);

    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
      return null;
    }

    return Math.max(5, minutes * 60 + seconds);
  }

  const numericMinutes = Number(trimmed);
  if (!Number.isFinite(numericMinutes)) {
    return null;
  }

  return Math.max(5, Math.round(numericMinutes * 60));
}

function parseImportedPracticePlan(rawText: string): ImportedPlan {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let title = "";
  let style = "";
  let level = "";
  let description = "";
  const importedBlocks: PracticeBlock[] = [];

  lines.forEach((line, index) => {
    const lower = line.toLowerCase();

    if (lower.startsWith("practice plan:")) {
      title = line.split(":").slice(1).join(":").trim();
      return;
    }

    if (lower.startsWith("style:")) {
      style = line.split(":").slice(1).join(":").trim();
      return;
    }

    if (lower.startsWith("level:")) {
      level = line.split(":").slice(1).join(":").trim();
      return;
    }

    if (lower.startsWith("description:")) {
      description = line.split(":").slice(1).join(":").trim();
      return;
    }

    const parts = line.split("|").map((part) => part.trim());

    if (parts.length >= 3) {
      const titlePart = parts[0] || `Imported Block ${index + 1}`;
      const durationPart = parts[1] || "10:00";
      const notesPart = parts[2] || "";
      const videoPart = parts[3] || "";
      const durationSeconds = parseDurationInput(durationPart) || 600;

      importedBlocks.push({
        id: `import-${Date.now()}-${index}`,
        blockType: "text",
        title: titlePart,
        style: style || undefined,
        category: titlePart,
        durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
        durationSeconds,
        videoUrl: videoPart.startsWith("http") ? videoPart : undefined,
        notes: [notesPart, level ? `Level: ${level}` : "", description ? `Plan note: ${description}` : ""]
          .filter(Boolean)
          .join("\n"),
      });
    }
  });

  return {
    title,
    style,
    level,
    description,
    blocks: importedBlocks,
  };
}

function PracticePlansPageContent() {
  const { appUser, currentTeam, firebaseUser } = useAuthState();
  const searchParams = useSearchParams();
  const openPlanId = searchParams.get("open");

  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [savedPlans, setSavedPlans] = useState<SavedPracticePlan[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [search, setSearch] = useState("");
  const [styleFilter, setStyleFilter] = useState("");
  const [blocks, setBlocks] = useState<PracticeBlock[]>([]);
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [assignedWrestlerIds, setAssignedWrestlerIds] = useState<string[]>([]);
  const [planTitle, setPlanTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<ImportedPlan | null>(null);
  const [showImportHelp, setShowImportHelp] = useState(false);
  const [snapshot, setSnapshot] = useState<PlanSnapshot>(() =>
    createPlanSnapshot({
      planId: null,
      title: "",
      style: "",
      blocks: [],
    })
  );

  useEffect(() => {
    async function loadLibrary() {
      try {
        const q = query(collection(db, COLLECTIONS.LIBRARY_ITEMS), orderBy("title"));
        const snapshot = await getDocs(q);
        const rows = snapshot.docs.map((d) => d.data() as LibraryItem);
        setLibraryItems(rows);
      } catch (error) {
        console.error("Failed to load library items:", error);
      } finally {
        setLoadingLibrary(false);
      }
    }

    async function loadSavedPlans() {
      try {
        if (!currentTeam?.id) {
          setSavedPlans([]);
          return;
        }

        const q = query(
          collection(db, COLLECTIONS.PRACTICE_PLANS),
          where("teamId", "==", currentTeam.id)
        );
        const snapshot = await getDocs(q);
        const rows = snapshot.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<SavedPracticePlan, "id">),
          }))
          .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
        setSavedPlans(rows);
      } catch (error) {
        console.error("Failed to load saved plans:", error);
      } finally {
        setLoadingPlans(false);
      }
    }

    async function loadWrestlers() {
      try {
        if (!currentTeam?.id) {
          setWrestlers([]);
          return;
        }

        setWrestlers(await listWrestlers(db, currentTeam.id));
      } catch (error) {
        console.error("Failed to load wrestlers for practice plan assignments:", error);
      }
    }

    loadLibrary();
    loadSavedPlans();
    loadWrestlers();
  }, [currentTeam?.id]);

  const athleteOwnedWrestler =
    appUser?.role === "athlete" && firebaseUser
      ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) || null
      : null;

  const styles = useMemo(() => {
    return Array.from(new Set(libraryItems.map((item) => item.style))).sort();
  }, [libraryItems]);

  const filteredLibrary = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return libraryItems.filter((item) => {
      const matchesStyle = !styleFilter || item.style === styleFilter;
      const matchesSearch =
        !needle ||
        item.title.toLowerCase().includes(needle) ||
        item.category.toLowerCase().includes(needle) ||
        item.subcategory.toLowerCase().includes(needle) ||
        item.format.toLowerCase().includes(needle) ||
        item.notes.toLowerCase().includes(needle);

      return matchesStyle && matchesSearch;
    });
  }, [libraryItems, search, styleFilter]);

  const totalSeconds = blocks.reduce((sum, block) => sum + block.durationSeconds, 0);
  const totalMinutes = Math.round(totalSeconds / 60);
  const currentSnapshot = createPlanSnapshot({
    planId: activePlanId,
    title: planTitle,
    style: styleFilter,
    blocks,
  });
  const hasUnsavedChanges =
    currentSnapshot.planId !== snapshot.planId ||
    currentSnapshot.title !== snapshot.title ||
    currentSnapshot.style !== snapshot.style ||
    currentSnapshot.blocks !== snapshot.blocks;
  const selectedStyleLabel = styleFilter || "Mixed";
  const libraryCountLabel = `${filteredLibrary.length} of ${libraryItems.length} library items`;
  const isCoach = appUser?.role === "coach";
  const assignmentSummaryLabel = formatAssignmentSummary(wrestlers, assignedWrestlerIds);

  function addLibraryBlock(item: LibraryItem) {
    setBlocks((prev) => [
      ...prev,
      {
        id: `${item.id}-${prev.length + 1}-${Date.now()}`,
        blockType: "library",
        libraryItemId: item.id,
        title: item.title,
        style: item.style,
        category: item.category,
        subcategory: item.subcategory,
        format: item.format,
        durationMinutes: 10,
        durationSeconds: 600,
        videoUrl: item.videoUrl,
        notes: item.notes || "",
      },
    ]);
  }

  function addTextBlock() {
    setBlocks((prev) => [
      ...prev,
      {
        id: `text-${prev.length + 1}-${Date.now()}`,
        blockType: "text",
        title: "Custom Block",
        durationMinutes: 10,
        durationSeconds: 600,
        notes: "",
      },
    ]);
  }

  function previewImportedPlan() {
    const parsed = parseImportedPracticePlan(importText);

    if (!parsed.title && parsed.blocks.length === 0) {
      setStatusMessage({
        tone: "error",
        text: "Paste a practice plan with a title and at least one block using the format: Block Title | 10:00 | Notes",
      });
      return;
    }

    if (parsed.blocks.length === 0) {
      setStatusMessage({
        tone: "error",
        text: "No practice blocks found. Use lines like: Warm-up | 10:00 | Dynamic movement",
      });
      return;
    }

    setImportPreview(parsed);
    setStatusMessage({
      tone: "success",
      text: `Import preview ready with ${parsed.blocks.length} block${parsed.blocks.length === 1 ? "" : "s"}.`,
    });
  }

  function applyImportedPlan() {
    if (!importPreview) {
      return;
    }

    setActivePlanId(null);
    setPlanTitle(importPreview.title || "Imported Practice Plan");
    setStyleFilter(importPreview.style === "Mixed" ? "" : importPreview.style);
    setBlocks(importPreview.blocks);
    setAssignedWrestlerIds([]);
    setSnapshot(
      createPlanSnapshot({
        planId: null,
        title: "",
        style: "",
        blocks: [],
      })
    );

    setStatusMessage({
      tone: "success",
      text: "Imported plan applied. Review the timeline, make edits, then save the practice plan.",
    });
  }

  function updateDuration(id: string, value: string) {
    setBlocks((prev) =>
      prev.map((block) => {
        if (block.id !== id) {
          return block;
        }

        const durationSeconds = parseDurationInput(value);
        if (durationSeconds == null) {
          return block;
        }

        return {
          ...block,
          durationSeconds,
          durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
        };
      })
    );
  }

  function updateNotes(id: string, notes: string) {
    setBlocks((prev) =>
      prev.map((block) => (block.id === id ? { ...block, notes } : block))
    );
  }

  function updateTitle(id: string, title: string) {
    setBlocks((prev) =>
      prev.map((block) => (block.id === id ? { ...block, title } : block))
    );
  }

  function moveBlockUp(id: string) {
    setBlocks((prev) => {
      const index = prev.findIndex((block) => block.id === id);
      if (index <= 0) return prev;
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveBlockDown(id: string) {
    setBlocks((prev) => {
      const index = prev.findIndex((block) => block.id === id);
      if (index === -1 || index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((block) => block.id !== id));
  }

  function startNewPlan() {
    setActivePlanId(null);
    setPlanTitle("");
    setStyleFilter("");
    setBlocks([]);
    setAssignedWrestlerIds([]);
    setImportPreview(null);
    setSnapshot(
      createPlanSnapshot({
        planId: null,
        title: "",
        style: "",
        blocks: [],
      })
    );
  }

  async function refreshSavedPlans() {
    if (!currentTeam?.id) {
      setSavedPlans([]);
      return;
    }

    const q = query(
      collection(db, COLLECTIONS.PRACTICE_PLANS),
      where("teamId", "==", currentTeam.id)
    );

    const snapshot = await getDocs(q);
    const rows = snapshot.docs
      .map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SavedPracticePlan, "id">),
      }))
      .filter((plan) => {
        const assignedIds = plan.assignedWrestlerIds || [];
        if (appUser?.role !== "athlete") {
          return true;
        }
        if (assignedIds.length === 0) {
          return true;
        }
        return Boolean(athleteOwnedWrestler && assignedIds.includes(athleteOwnedWrestler.id));
      })
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    setSavedPlans(rows);
  }

  async function loadPlan(planId: string) {
    try {
      setLoadingPlanId(planId);

      const planRef = doc(db, COLLECTIONS.PRACTICE_PLANS, planId);
      const planSnapshot = await getDoc(planRef);

      if (!planSnapshot.exists()) {
        setStatusMessage({ tone: "error", text: "Practice plan not found." });
        return;
      }

      if (currentTeam?.id && (planSnapshot.data() as { teamId?: string }).teamId !== currentTeam.id) {
        setStatusMessage({ tone: "error", text: "This practice plan belongs to another team." });
        return;
      }

      const planData = planSnapshot.data() as Omit<SavedPracticePlan, "id">;
      const assignedIds = Array.isArray((planData as { assignedWrestlerIds?: unknown }).assignedWrestlerIds)
        ? ((planData as { assignedWrestlerIds?: unknown[] }).assignedWrestlerIds || []).filter(
            (value): value is string => typeof value === "string"
          )
        : [];

      if (
        appUser?.role === "athlete" &&
        assignedIds.length > 0 &&
        (!athleteOwnedWrestler || !assignedIds.includes(athleteOwnedWrestler.id))
      ) {
        setStatusMessage({ tone: "error", text: "This practice plan is assigned to other wrestlers." });
        return;
      }

      const blocksSnapshot = await getDocs(
        query(
          collection(db, COLLECTIONS.PRACTICE_BLOCKS),
          where("practicePlanId", "==", planId)
        )
      );

      const loadedBlocks: PracticeBlock[] = blocksSnapshot.docs
        .map((d): PracticeBlockWithOrder => {
          const data = d.data() as Record<string, unknown>;

          const durationSeconds =
            typeof data.durationSeconds === "number"
              ? data.durationSeconds
              : typeof data.durationMinutes === "number"
                ? data.durationMinutes * 60
                : 600;

          return {
            id: d.id,
            blockType: data.blockType === "text" ? "text" : "library",
            libraryItemId: typeof data.libraryItemId === "string" ? data.libraryItemId : undefined,
            title: typeof data.title === "string" ? data.title : "",
            style: typeof data.style === "string" ? data.style : undefined,
            category: typeof data.category === "string" ? data.category : undefined,
            subcategory: typeof data.subcategory === "string" ? data.subcategory : undefined,
            format: typeof data.format === "string" ? data.format : undefined,
            durationSeconds,
            durationMinutes:
              typeof data.durationMinutes === "number"
                ? data.durationMinutes
                : Math.max(1, Math.round(durationSeconds / 60)),
            videoUrl: typeof data.videoUrl === "string" ? data.videoUrl : undefined,
            notes: typeof data.notes === "string" ? data.notes : "",
            orderIndex: typeof data.orderIndex === "number" ? data.orderIndex : 0,
          };
        })
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map(({ orderIndex: _orderIndex, ...rest }) => rest);

      setActivePlanId(planId);
      setPlanTitle(planData.title || "");
      setStyleFilter(planData.style === "Mixed" ? "" : planData.style || "");
      setAssignedWrestlerIds(assignedIds);
      setBlocks(loadedBlocks);
      setImportPreview(null);
      setSnapshot(
        createPlanSnapshot({
          planId,
          title: planData.title || "",
          style: planData.style === "Mixed" ? "" : planData.style || "",
          blocks: loadedBlocks,
        })
      );
    } catch (error) {
      console.error("Failed to load practice plan:", error);
      setStatusMessage({ tone: "error", text: "Failed to load practice plan." });
    } finally {
      setLoadingPlanId(null);
    }
  }

  useEffect(() => {
    if (!openPlanId) return;
    if (loadingPlans) return;
    if (activePlanId === openPlanId) return;

    loadPlan(openPlanId);
  }, [openPlanId, loadingPlans]); // eslint-disable-line react-hooks/exhaustive-deps

  async function savePracticePlan() {
    if (!planTitle.trim()) {
      setStatusMessage({ tone: "error", text: "Please enter a practice plan title." });
      return;
    }

    if (blocks.length === 0) {
      setStatusMessage({ tone: "error", text: "Add at least one block before saving." });
      return;
    }

    if (!currentTeam?.id || !firebaseUser?.uid) {
      setStatusMessage({ tone: "error", text: "You need an active team before saving practice plans." });
      return;
    }

    try {
      setSaving(true);

      let planId = activePlanId;

      if (planId) {
        await updateDoc(doc(db, COLLECTIONS.PRACTICE_PLANS, planId), {
          teamId: currentTeam.id,
          title: planTitle.trim(),
          style: styleFilter || "Mixed",
          assignedWrestlerIds,
          totalMinutes,
          totalSeconds,
          updatedAt: serverTimestamp(),
        });

        const existingBlocksSnapshot = await getDocs(
          query(collection(db, COLLECTIONS.PRACTICE_BLOCKS), where("practicePlanId", "==", planId))
        );

        const deleteBatch = writeBatch(db);
        existingBlocksSnapshot.docs.forEach((blockDoc) => {
          deleteBatch.delete(doc(db, COLLECTIONS.PRACTICE_BLOCKS, blockDoc.id));
        });
        await deleteBatch.commit();
      } else {
        const planRef = await addDoc(collection(db, COLLECTIONS.PRACTICE_PLANS), {
          teamId: currentTeam.id,
          title: planTitle.trim(),
          style: styleFilter || "Mixed",
          assignedWrestlerIds,
          totalMinutes,
          totalSeconds,
          createdBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        planId = planRef.id;
        setActivePlanId(planId);
      }

      const batch = writeBatch(db);

      blocks.forEach((block, index) => {
        const blockRef = doc(collection(db, COLLECTIONS.PRACTICE_BLOCKS));
        batch.set(blockRef, {
          practicePlanId: planId,
          blockType: block.blockType,
          libraryItemId: block.libraryItemId || null,
          title: block.title,
          style: block.style || "",
          category: block.category || "",
          subcategory: block.subcategory || "",
          format: block.format || "",
          durationMinutes: block.durationMinutes,
          durationSeconds: block.durationSeconds,
          videoUrl: block.videoUrl || "",
          notes: block.notes || "",
          orderIndex: index,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();
      await refreshSavedPlans();
      setSnapshot(
        createPlanSnapshot({
          planId,
          title: planTitle,
          style: styleFilter,
          blocks,
        })
      );

      setStatusMessage({
        tone: "success",
        text: activePlanId ? "Practice plan updated." : "Practice plan saved.",
      });
    } catch (error) {
      console.error("Failed to save practice plan:", error);
      setStatusMessage({ tone: "error", text: "Failed to save practice plan." });
    } finally {
      setSaving(false);
    }
  }

  async function deletePracticePlan(planId: string) {
    const plan = savedPlans.find((item) => item.id === planId);
    const planName = plan?.title || "this practice plan";

    if (
      !window.confirm(
        `Delete "${planName}"? This will also remove its blocks and calendar assignments.`
      )
    ) {
      return;
    }

    try {
      setDeletingPlanId(planId);

      const blocksSnapshot = await getDocs(
        query(collection(db, COLLECTIONS.PRACTICE_BLOCKS), where("practicePlanId", "==", planId))
      );
      const eventsSnapshot = await getDocs(
        query(collection(db, COLLECTIONS.CALENDAR_EVENTS), where("practicePlanId", "==", planId))
      );

      const batch = writeBatch(db);

      blocksSnapshot.docs.forEach((blockDoc) => {
        batch.delete(doc(db, COLLECTIONS.PRACTICE_BLOCKS, blockDoc.id));
      });

      eventsSnapshot.docs.forEach((eventDoc) => {
        batch.delete(doc(db, COLLECTIONS.CALENDAR_EVENTS, eventDoc.id));
      });

      batch.delete(doc(db, COLLECTIONS.PRACTICE_PLANS, planId));
      await batch.commit();

      if (activePlanId === planId) {
        startNewPlan();
      }

      await refreshSavedPlans();
      setStatusMessage({ tone: "success", text: "Practice plan deleted." });
    } catch (error) {
      console.error("Failed to delete practice plan:", error);
      setStatusMessage({ tone: "error", text: "Failed to delete practice plan." });
    } finally {
      setDeletingPlanId(null);
    }
  }

  return (
    <RequireAuth
      title="Practice Plan Builder"
      description="Build, reopen, and update practice plans from your technique library."
    >
      <main style={{ padding: 24 }}>
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>Practice Plan Builder</h1>
        <p style={{ marginBottom: 24 }}>
          Build, reopen, and update practice plans from your technique library.
        </p>

        {statusMessage ? (
          <StatusBanner message={statusMessage} onDismiss={() => setStatusMessage(null)} />
        ) : null}

        {!isCoach ? (
          <StatusBanner
            message={{
              tone: "info",
              text: "Practice plans are coach-managed. Athletes can review saved plans here, but creating, editing, and deleting stays coach-only.",
            }}
          />
        ) : null}

        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Practice plan title"
            value={planTitle}
            onChange={(e) => setPlanTitle(e.target.value)}
            disabled={!isCoach}
            style={{ padding: 10, minWidth: 260 }}
          />

          <button
            onClick={savePracticePlan}
            disabled={saving || !isCoach}
            style={{ padding: "10px 14px", cursor: "pointer" }}
          >
            {saving ? "Saving..." : activePlanId ? "Update Practice Plan" : "Save Practice Plan"}
          </button>

          <button onClick={addTextBlock} disabled={!isCoach} style={{ padding: "10px 14px", cursor: "pointer" }}>
            Add Text Block
          </button>

          <button onClick={startNewPlan} disabled={!isCoach} style={{ padding: "10px 14px", cursor: "pointer" }}>
            New Plan
          </button>

          {isCoach && activePlanId ? (
            <button
              onClick={() => deletePracticePlan(activePlanId)}
              disabled={deletingPlanId === activePlanId}
              style={{ padding: "10px 14px", cursor: "pointer", color: "#8a1c1c" }}
            >
              {deletingPlanId === activePlanId ? "Deleting..." : "Delete Plan"}
            </button>
          ) : null}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          {[
            { label: "Plan Status", value: activePlanId ? "Saved Plan" : "New Draft" },
            { label: "Practice Style", value: selectedStyleLabel },
            { label: "Assigned To", value: assignmentSummaryLabel },
            { label: "Blocks", value: `${blocks.length}` },
            { label: "Total Time", value: formatDurationLabel(totalSeconds) },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: 14,
                background: "#fff",
              }}
            >
              <div style={{ fontSize: 12, textTransform: "uppercase", color: "#666", marginBottom: 6 }}>
                {item.label}
              </div>
              <strong style={{ fontSize: 18 }}>{item.value}</strong>
            </div>
          ))}
        </div>

        <div
          style={{
            marginBottom: 20,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #ddd",
            background: hasUnsavedChanges ? "#fff8e6" : "#f6f7f8",
            fontSize: 14,
          }}
        >
          {activePlanId ? (
            <>
              Editing saved plan: <strong>{planTitle || "Untitled plan"}</strong>.{" "}
              {hasUnsavedChanges ? "You have unsaved changes." : "Everything is saved."}
            </>
          ) : hasUnsavedChanges ? (
            <>New draft in progress. Save it to reuse it in the calendar and mobile app.</>
          ) : (
            <>Start from the library or add a custom text block to build a new practice plan.</>
          )}
        </div>

        {isCoach ? (
          <section
            style={{
              marginBottom: 20,
              padding: 16,
              borderRadius: 12,
              border: "1px solid #ddd",
              background: "#fff",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 8,
                position: "relative",
              }}
            >
              <h2 style={{ margin: 0 }}>Import Practice Plan</h2>

              <button
                type="button"
                aria-label="Practice plan import format help"
                onClick={() => setShowImportHelp((prev) => !prev)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  border: "1px solid #bf1029",
                  background: showImportHelp ? "#bf1029" : "#fff",
                  color: showImportHelp ? "#fff" : "#bf1029",
                  fontWeight: 900,
                  cursor: "pointer",
                  lineHeight: "24px",
                }}
              >
                ?
              </button>

              {showImportHelp ? (
                <div
                  style={{
                    position: "absolute",
                    top: 34,
                    left: 240,
                    zIndex: 20,
                    width: "min(520px, calc(100vw - 64px))",
                    border: "1px solid #d1d5db",
                    borderRadius: 14,
                    background: "#ffffff",
                    boxShadow: "0 18px 50px rgba(15, 23, 42, 0.18)",
                    padding: 14,
                    color: "#111827",
                  }}
                >
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>Import format</div>
                  <p style={{ margin: "0 0 10px", color: "#475569", fontSize: 14, lineHeight: 1.5 }}>
                    Start with plan details, then add one block per line. Each block should use:
                  </p>
                  <div
                    style={{
                      borderRadius: 10,
                      background: "#f8fafc",
                      border: "1px solid #e5e7eb",
                      padding: 10,
                      fontFamily: "monospace",
                      fontSize: 13,
                      marginBottom: 10,
                    }}
                  >
                    Block Title | Time | Notes | Optional Video URL
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, color: "#475569", fontSize: 14, lineHeight: 1.5 }}>
                    <li>
                      Time can be <strong>10:00</strong> or <strong>10</strong>.
                    </li>
                    <li>Video URL is optional.</li>
                    <li>Imported rows become editable timeline blocks before saving.</li>
                    <li>Use Preview Import first, then Apply to Timeline.</li>
                  </ul>
                </div>
              ) : null}
            </div>

            <p style={{ marginTop: 0, color: "#666", fontSize: 14 }}>
              Paste a structured practice plan, preview the blocks, then apply it to the timeline.
              Each block should use <strong>Block Title | Time | Notes | Optional Video URL</strong>.
            </p>

            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                background: "#f8fafc",
                padding: 12,
                marginBottom: 12,
                fontSize: 13,
                lineHeight: 1.5,
                color: "#334155",
              }}
            >
              <strong>Format example:</strong>
              <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>
{`Practice Plan: Folkstyle Chain Wrestling + Mat Returns
Style: Folkstyle
Level: Middle School / High School
Description: Build chain wrestling habits from stance motion to single-leg finishes, mat returns, and short live goes.

Warm-up | 10:00 | Jog, stance motion, sprawls, penetration steps, hip-heists
Hand Fighting | 8:00 | Inside ties, head position, wrist control, circle to angle
Technique | 15:00 | Single leg entry to shelf finish; coach demos, then partner reps | https://youtube.com/
Drill | 10:00 | Single leg finish chain: shelf, run the pipe, switch to double
Mat Returns | 12:00 | Lift-return mechanics, safe mat return position, partner rotation
Situational Live | 15:00 | Start in single leg position; wrestler A finishes, wrestler B defends
Top/Bottom Review | 10:00 | Stand-up first move, chop breakdown, tight waist ride
Conditioning | 8:00 | 20-second go behinds, sprawls, push-ups, repeat
Cooldown | 5:00 | Stretch, breathing, team huddle, one goal for next practice`}
              </pre>
            </div>

            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              rows={10}
              placeholder="Paste practice plan here..."
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 12,
                border: "1px solid #d1d5db",
                resize: "vertical",
                marginBottom: 12,
              }}
            />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={previewImportedPlan}
                style={{ padding: "10px 14px", cursor: "pointer" }}
              >
                Preview Import
              </button>

              <button
                type="button"
                onClick={applyImportedPlan}
                disabled={!importPreview}
                style={{ padding: "10px 14px", cursor: importPreview ? "pointer" : "default" }}
              >
                Apply to Timeline
              </button>

              <button
                type="button"
                onClick={() => {
                  setImportText("");
                  setImportPreview(null);
                }}
                style={{ padding: "10px 14px", cursor: "pointer" }}
              >
                Clear Import
              </button>
            </div>

            {importPreview ? (
              <div
                style={{
                  marginTop: 16,
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 14,
                  background: "#fafafa",
                }}
              >
                <h3 style={{ marginTop: 0 }}>Import Preview</h3>

                <p style={{ marginTop: 0, color: "#555" }}>
                  <strong>{importPreview.title || "Untitled imported plan"}</strong>{" "}
                  {importPreview.style ? `• ${importPreview.style}` : ""}
                  {importPreview.level ? ` • ${importPreview.level}` : ""}
                </p>

                {importPreview.description ? (
                  <p style={{ color: "#555" }}>{importPreview.description}</p>
                ) : null}

                <div style={{ display: "grid", gap: 8 }}>
                  {importPreview.blocks.map((block, index) => (
                    <div
                      key={block.id}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 10,
                        padding: 10,
                        background: "#fff",
                      }}
                    >
                      <strong>
                        {index + 1}. {block.title}
                      </strong>
                      <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
                        {formatDurationLabel(block.durationSeconds)}
                        {block.videoUrl ? " • Video attached" : ""}
                      </div>
                      {block.notes ? (
                        <div style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>
                          {block.notes}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <section
          style={{
            marginBottom: 20,
            padding: 16,
            borderRadius: 12,
            border: "1px solid #ddd",
            background: "#fff",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Athlete Assignments</h2>
          <p style={{ marginTop: 0, color: "#666", fontSize: 14 }}>
            {isCoach
              ? "Leave this empty for a team-wide practice, or target specific wrestlers for a more personal workflow."
              : "You only see practice plans assigned to you or shared team-wide."}
          </p>

          {wrestlers.length === 0 ? (
            <p style={{ marginBottom: 0, color: "#666" }}>
              Create wrestler profiles first to assign this practice plan.
            </p>
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {wrestlers.map((wrestler) => {
                const selected = assignedWrestlerIds.includes(wrestler.id);
                return (
                  <button
                    key={wrestler.id}
                    type="button"
                    onClick={() =>
                      setAssignedWrestlerIds((prev) =>
                        prev.includes(wrestler.id)
                          ? prev.filter((id) => id !== wrestler.id)
                          : [...prev, wrestler.id]
                      )
                    }
                    disabled={!isCoach}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 999,
                      border: `1px solid ${selected ? "#bf1029" : "#d1d5db"}`,
                      background: selected ? "#fde8eb" : "#fff",
                      color: selected ? "#911022" : "#111827",
                      cursor: isCoach ? "pointer" : "default",
                      fontWeight: 700,
                    }}
                  >
                    {wrestler.firstName} {wrestler.lastName}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "320px 1fr 1.2fr",
            gap: 24,
            alignItems: "start",
          }}
        >
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 16,
              background: "#fff",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Saved Practice Plans</h2>
            <p style={{ marginTop: 0, color: "#666", fontSize: 14 }}>
              Reopen, update, or remove plans without leaving the builder.
            </p>

            {loadingPlans ? (
              <p>Loading saved plans...</p>
            ) : savedPlans.length === 0 ? (
              <p>No saved plans yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 12, maxHeight: 700, overflowY: "auto" }}>
                {savedPlans.map((plan) => (
                  <div
                    key={plan.id}
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 10,
                      padding: 12,
                      background: activePlanId === plan.id ? "#f5f5f5" : "#fff",
                    }}
                  >
                    <strong>{plan.title}</strong>
                    <div style={{ fontSize: 14, marginTop: 6 }}>
                      {plan.style || "Mixed"} ·{" "}
                      {formatDurationLabel(plan.totalSeconds || plan.totalMinutes * 60 || 0)}
                    </div>
                    <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
                      {formatAssignmentSummary(wrestlers, plan.assignedWrestlerIds || [])}
                    </div>

                    <button
                      onClick={() => loadPlan(plan.id)}
                      style={{ marginTop: 10, padding: "8px 12px", cursor: "pointer" }}
                    >
                      {loadingPlanId === plan.id ? "Opening..." : "Open Plan"}
                    </button>

                    <button
                      onClick={() => deletePracticePlan(plan.id)}
                      disabled={deletingPlanId === plan.id || !isCoach}
                      style={{
                        marginTop: 10,
                        marginLeft: 8,
                        padding: "8px 12px",
                        cursor: "pointer",
                        color: "#8a1c1c",
                      }}
                    >
                      {deletingPlanId === plan.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 16,
              background: "#fff",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Library</h2>
            <p style={{ marginTop: 0, color: "#666", fontSize: 14 }}>
              Filter by style, search by keyword, then add blocks directly into the timeline.
            </p>

            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <select
                value={styleFilter}
                onChange={(e) => setStyleFilter(e.target.value)}
                style={{ padding: 10, minWidth: 180 }}
              >
                <option value="">All Styles</option>
                {styles.map((style) => (
                  <option key={style} value={style}>
                    {style}
                  </option>
                ))}
              </select>

              <input
                type="text"
                placeholder="Search library..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: 1, minWidth: 180, padding: 10 }}
              />

              <button
                onClick={() => {
                  setStyleFilter("");
                  setSearch("");
                }}
                style={{ padding: "10px 14px", cursor: "pointer" }}
              >
                Clear Filters
              </button>
            </div>

            <div style={{ fontSize: 14, color: "#666", marginBottom: 12 }}>{libraryCountLabel}</div>

            {loadingLibrary ? (
              <p>Loading library...</p>
            ) : (
              <div style={{ display: "grid", gap: 12, maxHeight: 700, overflowY: "auto" }}>
                {filteredLibrary.length === 0 ? (
                  <p style={{ color: "#666", fontSize: 14 }}>
                    No library items match the current filters.
                  </p>
                ) : (
                  filteredLibrary.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        border: "1px solid #eee",
                        borderRadius: 10,
                        padding: 12,
                      }}
                    >
                      <strong>{item.title}</strong>

                      <div style={{ fontSize: 14, marginTop: 6 }}>
                        {item.style} · {item.category} · {item.subcategory} · {item.format}
                      </div>

                      {item.notes ? (
                        <p style={{ fontSize: 14, marginTop: 8, marginBottom: 8 }}>{item.notes}</p>
                      ) : null}

                      <button
                        onClick={() => addLibraryBlock(item)}
                        disabled={!isCoach}
                        style={{ marginTop: 6, padding: "8px 12px", cursor: "pointer" }}
                      >
                        Add to Practice
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 16,
              background: "#fff",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Practice Timeline</h2>
            <p style={{ marginBottom: 16 }}>
              {blocks.length === 0
                ? "Add library items or text blocks to start shaping the session."
                : `Total Time: ${formatDurationLabel(totalSeconds)} across ${blocks.length} blocks.`}
            </p>

            <div style={{ display: "grid", gap: 16 }}>
              {blocks.length === 0 ? (
                <div
                  style={{
                    border: "1px dashed #ccc",
                    borderRadius: 12,
                    padding: 24,
                    background: "#fafafa",
                    color: "#666",
                  }}
                >
                  No blocks yet. Build the session from the library on the left or add a custom text
                  block for warm-ups, partner rotations, live goes, or coach reminders.
                </div>
              ) : (
                blocks.map((block, index) => (
                  <div
                    key={block.id}
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 10,
                      padding: 14,
                      background: block.blockType === "text" ? "#fafafa" : "#fff",
                    }}
                  >
                    <div style={{ marginBottom: 8 }}>
                      <strong>
                        {index + 1}. {block.blockType === "text" ? "Text Block" : "Library Block"}
                      </strong>
                    </div>

                    <label style={{ display: "block", marginBottom: 10 }}>
                      Title:
                      <input
                        type="text"
                        value={block.title}
                        onChange={(e) => updateTitle(block.id, e.target.value)}
                        disabled={!isCoach}
                        style={{ display: "block", width: "100%", marginTop: 8, padding: 8 }}
                      />
                    </label>

                    {block.blockType === "library" ? (
                      <div style={{ fontSize: 14, marginBottom: 8 }}>
                        {block.style} · {block.category} · {block.subcategory} · {block.format}
                      </div>
                    ) : null}

                    <label style={{ display: "block", marginBottom: 10 }}>
                      Duration:
                      <input
                        type="text"
                        value={formatDurationLabel(block.durationSeconds)}
                        onChange={(e) => updateDuration(block.id, e.target.value)}
                        disabled={!isCoach}
                        style={{ marginLeft: 8, width: 90, padding: 6 }}
                      />{" "}
                      mm:ss
                    </label>

                    <label style={{ display: "block", marginBottom: 10 }}>
                      Notes:
                      <textarea
                        value={block.notes}
                        onChange={(e) => updateNotes(block.id, e.target.value)}
                        disabled={!isCoach}
                        rows={4}
                        style={{
                          display: "block",
                          width: "100%",
                          marginTop: 8,
                          padding: 8,
                          resize: "vertical",
                        }}
                      />
                    </label>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {block.videoUrl ? (
                        <a href={block.videoUrl} target="_blank" rel="noreferrer">
                          Open video
                        </a>
                      ) : null}

                      <button onClick={() => moveBlockUp(block.id)} disabled={!isCoach} style={{ padding: "6px 10px" }}>
                        Move Up
                      </button>

                      <button onClick={() => moveBlockDown(block.id)} disabled={!isCoach} style={{ padding: "6px 10px" }}>
                        Move Down
                      </button>

                      <button onClick={() => removeBlock(block.id)} disabled={!isCoach} style={{ padding: "6px 10px" }}>
                        Remove
                      </button>
                    </div>

                    <div style={{ marginTop: 12, fontSize: 12, color: "#666" }}>
                      {block.blockType === "library"
                        ? `Linked library item: ${block.libraryItemId}`
                        : "Custom text block"}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </main>
    </RequireAuth>
  );
}

export default function PracticePlansPage() {
  return (
    <Suspense fallback={null}>
      <PracticePlansPageContent />
    </Suspense>
  );
}