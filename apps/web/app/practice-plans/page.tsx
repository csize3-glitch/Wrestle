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
        .map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            blockType: data.blockType || "library",
            libraryItemId: data.libraryItemId || undefined,
            title: data.title || "",
            style: data.style || undefined,
            category: data.category || undefined,
            subcategory: data.subcategory || undefined,
            format: data.format || undefined,
            durationSeconds: data.durationSeconds || (data.durationMinutes || 10) * 60,
            durationMinutes: data.durationMinutes || Math.max(1, Math.round((data.durationSeconds || 600) / 60)),
            videoUrl: data.videoUrl || undefined,
            notes: data.notes || "",
            orderIndex: data.orderIndex || 0,
          };
        })
        .sort((a: any, b: any) => (a.orderIndex || 0) - (b.orderIndex || 0))
        .map(({ orderIndex, ...rest }: any) => rest);

      setActivePlanId(planId);
      setPlanTitle(planData.title || "");
      setStyleFilter(planData.style === "Mixed" ? "" : planData.style || "");
      setAssignedWrestlerIds(assignedIds);
      setBlocks(loadedBlocks);
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
          <p style={{ marginBottom: 0, color: "#666" }}>Create wrestler profiles first to assign this practice plan.</p>
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
                    {plan.style || "Mixed"} · {formatDurationLabel(plan.totalSeconds || plan.totalMinutes * 60 || 0)}
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
                    />
                    {" "}mm:ss
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
                    {block.blockType === "library" && block.videoUrl ? (
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
