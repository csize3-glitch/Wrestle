"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@wrestlewell/firebase/client";
import {
  COLLECTIONS,
  type PracticeSession,
  type TrainingGroup,
  type WrestlerProfile,
} from "@wrestlewell/types/index";
import {
  createTrainingGroup,
  deleteTrainingGroup,
  listPracticeSessions,
  listTrainingGroups,
  listTournamentEntries,
  listTournaments,
  listWrestlers,
  sendTeamPushDelivery,
  updateTrainingGroup,
} from "@wrestlewell/lib/index";
import { RequireAuth } from "../require-auth";
import { useAuthState } from "../auth-provider";
import { StatusBanner } from "../status-banner";

type SavedPracticePlan = {
  id: string;
  title: string;
  style: string;
  totalMinutes: number;
  totalSeconds?: number;
  assignmentType?: "team" | "group" | "custom";
  groupId?: string;
  groupName?: string;
  assignedWrestlerIds?: string[];
};

type CalendarEventItem = {
  id: string;
  date: string;
  practicePlanId: string;
  assignmentType?: "team" | "group" | "custom";
  groupId?: string;
  groupName?: string;
  assignedWrestlerIds?: string[];
  practicePlanTitle: string;
  practicePlanStyle: string;
  totalMinutes: number;
  totalSeconds?: number;
  notes?: string;
};

type TournamentCalendarItem = {
  id: string;
  date: string;
  name: string;
  registrationUrl: string;
  notes?: string;
  rosterCount: number;
  submittedCount: number;
  verifiedCount: number;
};

type CompletedPracticeSessionItem = PracticeSession & {
  date: string;
};

type AssignmentType = "team" | "group" | "custom";
type TrainingGroupDraft = {
  name: string;
  description: string;
};

function getStartOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateKey(date: Date) {
  return date.toISOString().split("T")[0];
}

function formatPrettyDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDurationLabel(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function matchesAssignment(assignedIds: string[] | undefined, wrestlerId?: string | null) {
  const safeIds = assignedIds || [];
  if (safeIds.length === 0) return true;
  return Boolean(wrestlerId && safeIds.includes(wrestlerId));
}

function wrestlerMatchesTrainingGroup(wrestler: WrestlerProfile, groupId: string) {
  return (
    wrestler.primaryTrainingGroupId === groupId ||
    Boolean(wrestler.trainingGroupIds?.includes(groupId))
  );
}

function uniqueIds(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeDateValue(value: unknown): string {
  if (!value) return "";

  if (typeof value === "string") return value;

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return "";
    }
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    return new Date((value as { seconds: number }).seconds * 1000).toISOString();
  }

  return "";
}

function toDateKeyFromTimestamp(value: unknown) {
  const normalized = normalizeDateValue(value);
  if (!normalized) return "";

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";

  return date.toISOString().split("T")[0];
}

function formatCompletedAt(value: unknown) {
  const normalized = normalizeDateValue(value);
  if (!normalized) return "Completed recently";

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "Completed recently";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getCompletedPracticeDate(session: CompletedPracticeSessionItem) {
  return (
    session.date ||
    toDateKeyFromTimestamp(session.completedAt) ||
    toDateKeyFromTimestamp(session.createdAt)
  );
}

export default function CalendarPage() {
  const { appUser, currentTeam } = useAuthState();

  const [savedPlans, setSavedPlans] = useState<SavedPracticePlan[]>([]);
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [trainingGroups, setTrainingGroups] = useState<TrainingGroup[]>([]);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [tournaments, setTournaments] = useState<TournamentCalendarItem[]>([]);
  const [completedPractices, setCompletedPractices] = useState<CompletedPracticeSessionItem[]>([]);

  const [loadingPlans, setLoadingPlans] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [assigningDate, setAssigningDate] = useState<string | null>(null);
  const [selectedPlanByDate, setSelectedPlanByDate] = useState<Record<string, string>>({});
  const [assignmentTypeByDate, setAssignmentTypeByDate] = useState<Record<string, AssignmentType>>(
    {}
  );
  const [selectedGroupByDate, setSelectedGroupByDate] = useState<Record<string, string>>({});
  const [customWrestlersByDate, setCustomWrestlersByDate] = useState<Record<string, string[]>>({});
  const [notesByDate, setNotesByDate] = useState<Record<string, string>>({});
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [groupDrafts, setGroupDrafts] = useState<Record<string, TrainingGroupDraft>>({});
  const [savingGroupId, setSavingGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(1440);

  const isCoach = appUser?.role === "coach";

  const athleteOwnedWrestler =
    appUser?.role === "athlete"
      ? wrestlers.find((wrestler) => wrestler.ownerUserId === appUser.id) || null
      : null;

  useEffect(() => {
    function handleResize() {
      setViewportWidth(window.innerWidth);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const calendarColumns =
    viewportWidth <= 640 ? 1 : viewportWidth <= 960 ? 2 : viewportWidth <= 1280 ? 4 : 7;

  const isDenseLayout = calendarColumns === 7;
  const activeTrainingGroups = useMemo(
    () => trainingGroups.filter((group) => group.active),
    [trainingGroups]
  );
  const trainingGroupNameById = useMemo(
    () =>
      Object.fromEntries(trainingGroups.map((group) => [group.id, group.name])) as Record<
        string,
        string
      >,
    [trainingGroups]
  );

  const weekDates = useMemo(() => {
    const start = getStartOfWeek();
    start.setDate(start.getDate() + weekOffset * 7);

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  const weekStartKey = formatDateKey(weekDates[0]);
  const weekEndKey = formatDateKey(weekDates[6]);

  useEffect(() => {
    async function loadWrestlers() {
      try {
        if (!currentTeam?.id) {
          setWrestlers([]);
          return;
        }

        setWrestlers(await listWrestlers(db, currentTeam.id));
      } catch (error) {
        console.error("Failed to load wrestlers for calendar assignment filtering:", error);
      }
    }

    loadWrestlers();
  }, [currentTeam?.id]);

  useEffect(() => {
    async function loadTrainingGroupsForTeam() {
      if (!currentTeam?.id) {
        setTrainingGroups([]);
        setGroupDrafts({});
        return;
      }

      try {
        const groups = await listTrainingGroups(db, currentTeam.id);
        setTrainingGroups(groups);
        setGroupDrafts(
          Object.fromEntries(
            groups.map((group) => [
              group.id,
              {
                name: group.name,
                description: group.description || "",
              },
            ])
          )
        );
      } catch (error) {
        console.error("Failed to load training groups:", error);
      }
    }

    loadTrainingGroupsForTeam();
  }, [currentTeam?.id]);

  useEffect(() => {
    async function loadPlans() {
      try {
        setLoadingPlans(true);

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
          .filter((plan) => matchesAssignment(plan.assignedWrestlerIds, athleteOwnedWrestler?.id))
          .sort((a, b) => (a.title || "").localeCompare(b.title || ""));

        setSavedPlans(rows);
      } catch (error) {
        console.error("Failed to load saved practice plans:", error);
      } finally {
        setLoadingPlans(false);
      }
    }

    loadPlans();
  }, [athleteOwnedWrestler?.id, currentTeam?.id]);

  async function refreshEvents() {
    if (!currentTeam?.id) {
      setEvents([]);
      setTournaments([]);
      setCompletedPractices([]);
      return;
    }

    const calendarQuery = query(
      collection(db, COLLECTIONS.CALENDAR_EVENTS),
      where("teamId", "==", currentTeam.id)
    );

    const calendarSnapshot = await getDocs(calendarQuery);

    const eventRows = calendarSnapshot.docs
      .map((d) => ({
        id: d.id,
        ...(d.data() as Omit<CalendarEventItem, "id">),
      }))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      .filter((event) => matchesAssignment(event.assignedWrestlerIds, athleteOwnedWrestler?.id))
      .filter((event) => event.date >= weekStartKey && event.date <= weekEndKey);

    setEvents(eventRows);
    const sessionRows = (
      await listPracticeSessions(db, currentTeam.id, weekStartKey, weekEndKey)
    )
      .map((session) => ({
        ...session,
        date:
          toDateKeyFromTimestamp(session.completedAt) ||
          toDateKeyFromTimestamp(session.createdAt) ||
          "",
      }))
      .filter((session) => session.date >= weekStartKey && session.date <= weekEndKey)
      .sort((a, b) => {
        const aDate = normalizeDateValue(a.completedAt) || normalizeDateValue(a.createdAt);
        const bDate = normalizeDateValue(b.completedAt) || normalizeDateValue(b.createdAt);
        return bDate.localeCompare(aDate);
      });

    setCompletedPractices(sessionRows);

    const tournamentRows = await listTournaments(db, currentTeam.id);

    const calendarTournaments = await Promise.all(
      tournamentRows
        .filter(
          (tournament) =>
            tournament.eventDate &&
            tournament.eventDate >= weekStartKey &&
            tournament.eventDate <= weekEndKey
        )
        .map(async (tournament) => {
          const entries = await listTournamentEntries(db, {
            teamId: currentTeam.id,
            tournamentId: tournament.id,
          });

          if (
            appUser?.role === "athlete" &&
            athleteOwnedWrestler &&
            entries.length > 0 &&
            !entries.some((entry) => entry.wrestlerId === athleteOwnedWrestler.id)
          ) {
            return null;
          }

          return {
            id: tournament.id,
            date: tournament.eventDate || "",
            name: tournament.name,
            registrationUrl: tournament.registrationUrl,
            notes: tournament.notes,
            rosterCount: entries.length,
            submittedCount: entries.filter((entry) => entry.status === "submitted").length,
            verifiedCount: entries.filter((entry) => entry.status === "confirmed").length,
          } satisfies TournamentCalendarItem;
        })
    );

    setTournaments(calendarTournaments.filter(Boolean) as TournamentCalendarItem[]);
  }

  useEffect(() => {
    async function loadEvents() {
      try {
        setLoadingEvents(true);

        if (!currentTeam?.id) {
          setEvents([]);
          setTournaments([]);
          setCompletedPractices([]);
          return;
        }

        await refreshEvents();
      } catch (error) {
        console.error("Failed to load calendar events:", error);
      } finally {
        setLoadingEvents(false);
      }
    }

    loadEvents();
  }, [athleteOwnedWrestler?.id, currentTeam?.id, weekStartKey, weekEndKey]);

  async function refreshTrainingGroupsForTeam() {
    if (!currentTeam?.id) {
      setTrainingGroups([]);
      setGroupDrafts({});
      return;
    }

    const groups = await listTrainingGroups(db, currentTeam.id);
    setTrainingGroups(groups);
    setGroupDrafts(
      Object.fromEntries(
        groups.map((group) => [
          group.id,
          {
            name: group.name,
            description: group.description || "",
          },
        ])
      )
    );
  }

  function getResolvedAssignedWrestlerIds(
    assignmentType: AssignmentType,
    groupId: string,
    customIds: string[]
  ) {
    if (assignmentType === "team") {
      return [];
    }

    if (assignmentType === "group") {
      return uniqueIds(
        wrestlers
          .filter((wrestler) => wrestlerMatchesTrainingGroup(wrestler, groupId))
          .map((wrestler) => wrestler.id)
      );
    }

    return uniqueIds(customIds);
  }

  function handlePlanSelection(dateKey: string, planId: string) {
    setSelectedPlanByDate((prev) => ({ ...prev, [dateKey]: planId }));

    const selectedPlan = savedPlans.find((plan) => plan.id === planId);
    if (!selectedPlan) {
      return;
    }

    const nextAssignmentType: AssignmentType =
      selectedPlan.assignmentType ||
      (selectedPlan.groupId ? "group" : selectedPlan.assignedWrestlerIds?.length ? "custom" : "team");

    setAssignmentTypeByDate((prev) => ({ ...prev, [dateKey]: nextAssignmentType }));
    setSelectedGroupByDate((prev) => ({ ...prev, [dateKey]: selectedPlan.groupId || "" }));
    setCustomWrestlersByDate((prev) => ({
      ...prev,
      [dateKey]: selectedPlan.assignedWrestlerIds || [],
    }));
  }

  function toggleCustomWrestler(dateKey: string, wrestlerId: string) {
    setCustomWrestlersByDate((prev) => {
      const currentIds = prev[dateKey] || [];
      const nextIds = currentIds.includes(wrestlerId)
        ? currentIds.filter((entry) => entry !== wrestlerId)
        : [...currentIds, wrestlerId];

      return {
        ...prev,
        [dateKey]: nextIds,
      };
    });
  }

  async function handleCreateGroup() {
    if (!currentTeam?.id) {
      alert("You need an active team before creating training groups.");
      return;
    }

    if (!newGroupName.trim()) {
      alert("Enter a training group name first.");
      return;
    }

    try {
      setCreatingGroup(true);
      await createTrainingGroup(db, {
        teamId: currentTeam.id,
        name: newGroupName,
        description: newGroupDescription,
        sortOrder: trainingGroups.length,
        active: true,
      });
      setNewGroupName("");
      setNewGroupDescription("");
      await refreshTrainingGroupsForTeam();
    } catch (error) {
      console.error("Failed to create training group:", error);
      alert("Failed to create training group.");
    } finally {
      setCreatingGroup(false);
    }
  }

  async function handleSaveGroup(groupId: string) {
    const draft = groupDrafts[groupId];
    if (!draft?.name.trim()) {
      alert("Training group name cannot be empty.");
      return;
    }

    try {
      setSavingGroupId(groupId);
      await updateTrainingGroup(db, groupId, {
        name: draft.name,
        description: draft.description,
      });
      await refreshTrainingGroupsForTeam();
    } catch (error) {
      console.error("Failed to update training group:", error);
      alert("Failed to update training group.");
    } finally {
      setSavingGroupId(null);
    }
  }

  async function handleToggleGroupActive(group: TrainingGroup) {
    try {
      setSavingGroupId(group.id);
      await updateTrainingGroup(db, group.id, { active: !group.active });
      await refreshTrainingGroupsForTeam();
    } catch (error) {
      console.error("Failed to update training group status:", error);
      alert("Failed to update training group.");
    } finally {
      setSavingGroupId(null);
    }
  }

  async function handleDeleteGroup(group: TrainingGroup) {
    if (!window.confirm(`Delete ${group.name}?`)) {
      return;
    }

    try {
      setSavingGroupId(group.id);

      const [planRefs, eventRefs, sessionRefs] = await Promise.all([
        getDocs(
          query(
            collection(db, COLLECTIONS.PRACTICE_PLANS),
            where("teamId", "==", currentTeam?.id || ""),
            where("groupId", "==", group.id)
          )
        ),
        getDocs(
          query(
            collection(db, COLLECTIONS.CALENDAR_EVENTS),
            where("teamId", "==", currentTeam?.id || ""),
            where("groupId", "==", group.id)
          )
        ),
        getDocs(
          query(
            collection(db, COLLECTIONS.PRACTICE_SESSIONS),
            where("teamId", "==", currentTeam?.id || ""),
            where("groupId", "==", group.id)
          )
        ),
      ]);

      const isReferenced =
        wrestlers.some((wrestler) => wrestlerMatchesTrainingGroup(wrestler, group.id)) ||
        !planRefs.empty ||
        !eventRefs.empty ||
        !sessionRefs.empty;

      if (isReferenced) {
        alert(
          "This training group is still referenced by wrestlers or practice work. Rename or deactivate it instead."
        );
        return;
      }

      await deleteTrainingGroup(db, group.id);
      await refreshTrainingGroupsForTeam();
    } catch (error) {
      console.error("Failed to delete training group:", error);
      alert("Failed to delete training group.");
    } finally {
      setSavingGroupId(null);
    }
  }

  const weeklyReviewBlocks = useMemo(() => {
    const blocks = [];

    const teamScheduled = events.filter((event) => (event.assignmentType || "team") === "team");
    const teamCompleted = completedPractices.filter(
      (session) => (session.assignmentType || "team") === "team"
    );

    if (teamScheduled.length || teamCompleted.length) {
      blocks.push({
        key: "team",
        title: "Team-wide",
        scheduled: teamScheduled,
        completed: teamCompleted,
      });
    }

    for (const group of activeTrainingGroups) {
      blocks.push({
        key: group.id,
        title: group.name,
        scheduled: events.filter((event) => event.groupId === group.id),
        completed: completedPractices.filter((session) => session.groupId === group.id),
      });
    }

    return blocks;
  }, [activeTrainingGroups, completedPractices, events]);

  async function assignPlanToDate(dateKey: string) {
    if (!currentTeam?.id) {
      alert("You need an active team before scheduling practices.");
      return;
    }

    const selectedPlanId = selectedPlanByDate[dateKey];

    if (!selectedPlanId) {
      alert("Choose a practice plan first.");
      return;
    }

    const selectedPlan = savedPlans.find((plan) => plan.id === selectedPlanId);

    if (!selectedPlan) {
      alert("Selected practice plan not found.");
      return;
    }

    const assignmentType = assignmentTypeByDate[dateKey] || "team";
    const groupId = selectedGroupByDate[dateKey] || "";
    const groupName = groupId ? trainingGroupNameById[groupId] : "";
    const customIds = customWrestlersByDate[dateKey] || [];
    const assignedWrestlerIds = getResolvedAssignedWrestlerIds(
      assignmentType,
      groupId,
      customIds
    );

    if (assignmentType === "group" && !groupId) {
      alert("Choose a training group before assigning this practice.");
      return;
    }

    if (assignmentType === "custom" && assignedWrestlerIds.length === 0) {
      alert("Choose at least one wrestler for a custom assignment.");
      return;
    }

    try {
      setAssigningDate(dateKey);

      await addDoc(collection(db, COLLECTIONS.CALENDAR_EVENTS), {
        teamId: currentTeam.id,
        date: dateKey,
        practicePlanId: selectedPlan.id,
        assignmentType,
        groupId: assignmentType === "group" ? groupId : "",
        groupName: assignmentType === "group" ? groupName : "",
        assignedWrestlerIds,
        practicePlanTitle: selectedPlan.title,
        practicePlanStyle: selectedPlan.style || "Mixed",
        totalMinutes: selectedPlan.totalMinutes || 0,
        totalSeconds: selectedPlan.totalSeconds || selectedPlan.totalMinutes * 60 || 0,
        notes: notesByDate[dateKey] || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      try {
        const targetUserIds =
          assignedWrestlerIds.length > 0
            ? wrestlers
                .filter((wrestler) => assignedWrestlerIds.includes(wrestler.id))
                .map((wrestler) => wrestler.ownerUserId)
                .filter((value): value is string => Boolean(value))
            : undefined;

        await sendTeamPushDelivery(db, {
          teamId: currentTeam.id,
          title: "New practice assignment",
          body: `${selectedPlan.title} is scheduled for ${dateKey}.`,
          audienceRole: "athlete",
          targetUserIds,
          preferenceKey: "practiceReminders",
        });
      } catch (pushError) {
        console.error("Failed to send practice assignment push:", pushError);
      }

      setSelectedPlanByDate((prev) => ({ ...prev, [dateKey]: "" }));
      setAssignmentTypeByDate((prev) => ({ ...prev, [dateKey]: "team" }));
      setSelectedGroupByDate((prev) => ({ ...prev, [dateKey]: "" }));
      setCustomWrestlersByDate((prev) => ({ ...prev, [dateKey]: [] }));
      setNotesByDate((prev) => ({ ...prev, [dateKey]: "" }));

      await refreshEvents();
    } catch (error) {
      console.error("Failed to assign practice plan:", error);
      alert("Failed to assign practice plan.");
    } finally {
      setAssigningDate(null);
    }
  }

  async function removeEvent(eventId: string) {
    try {
      await deleteDoc(doc(db, COLLECTIONS.CALENDAR_EVENTS, eventId));
      await refreshEvents();
    } catch (error) {
      console.error("Failed to remove calendar event:", error);
      alert("Failed to remove calendar event.");
    }
  }

  function getEventsForDate(dateKey: string) {
    return events.filter((event) => event.date === dateKey);
  }

  function getTournamentsForDate(dateKey: string) {
    return tournaments.filter((tournament) => tournament.date === dateKey);
  }

  function getCompletedPracticesForDate(dateKey: string) {
    return completedPractices.filter((session) => getCompletedPracticeDate(session) === dateKey);
  }

  return (
    <RequireAuth
      title="Weekly Calendar"
      description="Assign saved practice plans to specific days of the week."
    >
      <main
        style={{
          padding: viewportWidth <= 768 ? 16 : 24,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>Weekly Calendar</h1>

        <p style={{ marginBottom: 24 }}>
          Assign practice plans, view tournaments, and review completed practice notes.
        </p>

        {!isCoach ? (
          <StatusBanner
            message={{
              tone: "info",
              text: "Calendar scheduling is coach-managed. Athletes can review the team schedule here, but only coaches can assign or remove plans.",
            }}
          />
        ) : null}

        {isCoach ? (
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 16,
              background: "#fff",
              marginBottom: 24,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ marginTop: 0, marginBottom: 6 }}>Training Groups</h2>
                <p style={{ marginTop: 0, color: "#666", fontSize: 14 }}>
                  Build your own live group names here so calendar assignments and weekly review stay coach-specific.
                </p>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(220px, 1fr) minmax(260px, 1.4fr) auto",
                gap: 10,
                alignItems: "end",
                marginBottom: 16,
              }}
            >
              <label style={{ display: "grid", gap: 6 }}>
                <span>Group name</span>
                <input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="White Group"
                  style={{ padding: 10 }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span>Description</span>
                <input
                  value={newGroupDescription}
                  onChange={(e) => setNewGroupDescription(e.target.value)}
                  placeholder="Optional notes about who this group is for"
                  style={{ padding: 10 }}
                />
              </label>

              <button onClick={handleCreateGroup} disabled={creatingGroup} style={{ padding: "10px 14px" }}>
                {creatingGroup ? "Creating..." : "Create Group"}
              </button>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {trainingGroups.length === 0 ? (
                <div style={{ fontSize: 14, color: "#666" }}>
                  No custom groups yet. Add the first one above and it will immediately become available for wrestler profiles and calendar assignments.
                </div>
              ) : (
                trainingGroups.map((group) => (
                  <div
                    key={group.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      padding: 12,
                      display: "grid",
                      gridTemplateColumns: "minmax(200px, 1fr) minmax(260px, 1.4fr) auto auto auto",
                      gap: 10,
                      alignItems: "end",
                      background: group.active ? "#fff" : "#f8fafc",
                    }}
                  >
                    <label style={{ display: "grid", gap: 6 }}>
                      <span>Name</span>
                      <input
                        value={groupDrafts[group.id]?.name || ""}
                        onChange={(e) =>
                          setGroupDrafts((prev) => ({
                            ...prev,
                            [group.id]: {
                              ...(prev[group.id] || { name: "", description: "" }),
                              name: e.target.value,
                            },
                          }))
                        }
                        style={{ padding: 10 }}
                      />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span>Description</span>
                      <input
                        value={groupDrafts[group.id]?.description || ""}
                        onChange={(e) =>
                          setGroupDrafts((prev) => ({
                            ...prev,
                            [group.id]: {
                              ...(prev[group.id] || { name: "", description: "" }),
                              description: e.target.value,
                            },
                          }))
                        }
                        style={{ padding: 10 }}
                      />
                    </label>

                    <button onClick={() => handleSaveGroup(group.id)} disabled={savingGroupId === group.id}>
                      {savingGroupId === group.id ? "Saving..." : "Save"}
                    </button>

                    <button onClick={() => handleToggleGroupActive(group)} disabled={savingGroupId === group.id}>
                      {group.active ? "Deactivate" : "Activate"}
                    </button>

                    <button
                      onClick={() => handleDeleteGroup(group)}
                      disabled={savingGroupId === group.id}
                      style={{ color: "#8a1c1c" }}
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : null}

        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 24,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <button onClick={() => setWeekOffset((prev) => prev - 1)} style={{ padding: "10px 14px" }}>
            Previous Week
          </button>

          <div style={{ fontWeight: 600 }}>
            {formatPrettyDate(weekDates[0])} - {formatPrettyDate(weekDates[6])}
          </div>

          <button onClick={() => setWeekOffset((prev) => prev + 1)} style={{ padding: "10px 14px" }}>
            Next Week
          </button>

          <button onClick={() => setWeekOffset(0)} style={{ padding: "10px 14px" }}>
            This Week
          </button>
        </div>

        {loadingPlans ? <p>Loading practice plans...</p> : null}
        {loadingEvents ? <p>Loading calendar...</p> : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${calendarColumns}, minmax(0, 1fr))`,
            gap: isDenseLayout ? 12 : 16,
            alignItems: "start",
            width: "100%",
          }}
        >
          {weekDates.map((date) => {
            const dateKey = formatDateKey(date);
            const dayEvents = getEventsForDate(dateKey);
            const dayTournaments = getTournamentsForDate(dateKey);
            const dayCompletedPractices = getCompletedPracticesForDate(dateKey);

            return (
              <section
                key={dateKey}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 12,
                  padding: isDenseLayout ? 12 : 16,
                  background: "#fff",
                  minHeight: isDenseLayout ? 420 : 500,
                  minWidth: 0,
                }}
              >
                <h2 style={{ marginTop: 0, marginBottom: 6, fontSize: isDenseLayout ? 16 : 18 }}>
                  {formatPrettyDate(date)}
                </h2>

                <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>{dateKey}</div>

                <select
                  value={selectedPlanByDate[dateKey] || ""}
                  onChange={(e) => handlePlanSelection(dateKey, e.target.value)}
                  disabled={!isCoach}
                  style={{
                    width: "100%",
                    padding: isDenseLayout ? 8 : 10,
                    marginBottom: 10,
                    minWidth: 0,
                  }}
                >
                  <option value="">Select a practice plan</option>
                  {savedPlans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.title}
                      {plan.assignmentType === "group" && plan.groupName
                        ? ` (${plan.groupName})`
                        : plan.assignedWrestlerIds?.length
                          ? " (Custom)"
                          : ""}
                    </option>
                  ))}
                </select>

                {isCoach ? (
                  <div
                    style={{
                      display: "grid",
                      gap: 10,
                      padding: 12,
                      borderRadius: 10,
                      border: "1px solid #e5e7eb",
                      background: "#f8fafc",
                      marginBottom: 10,
                    }}
                  >
                    <label style={{ display: "grid", gap: 6 }}>
                      <span>Assignment</span>
                      <select
                        value={assignmentTypeByDate[dateKey] || "team"}
                        onChange={(e) =>
                          setAssignmentTypeByDate((prev) => ({
                            ...prev,
                            [dateKey]: e.target.value as AssignmentType,
                          }))
                        }
                        style={{ padding: 10 }}
                      >
                        <option value="team">Team-wide</option>
                        <option value="group">Training Group</option>
                        <option value="custom">Custom Wrestlers</option>
                      </select>
                    </label>

                    {(assignmentTypeByDate[dateKey] || "team") === "group" ? (
                      <label style={{ display: "grid", gap: 6 }}>
                        <span>Training group</span>
                        <select
                          value={selectedGroupByDate[dateKey] || ""}
                          onChange={(e) =>
                            setSelectedGroupByDate((prev) => ({
                              ...prev,
                              [dateKey]: e.target.value,
                            }))
                          }
                          style={{ padding: 10 }}
                        >
                          <option value="">Select a group</option>
                          {activeTrainingGroups.map((group) => (
                            <option key={group.id} value={group.id}>
                              {group.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {(assignmentTypeByDate[dateKey] || "team") === "custom" ? (
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>Custom wrestlers</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {wrestlers.map((wrestler) => {
                            const fullName = `${wrestler.firstName} ${wrestler.lastName}`.trim();
                            const checked = (customWrestlersByDate[dateKey] || []).includes(wrestler.id);

                            return (
                              <label
                                key={wrestler.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  borderRadius: 999,
                                  border: "1px solid #d1d5db",
                                  padding: "6px 10px",
                                  background: checked ? "#e0f2fe" : "#fff",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleCustomWrestler(dateKey, wrestler.id)}
                                />
                                <span>{fullName || "Unnamed Wrestler"}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <textarea
                  placeholder="Optional notes for this day..."
                  value={notesByDate[dateKey] || ""}
                  onChange={(e) =>
                    setNotesByDate((prev) => ({ ...prev, [dateKey]: e.target.value }))
                  }
                  disabled={!isCoach}
                  rows={3}
                  style={{
                    width: "100%",
                    padding: isDenseLayout ? 8 : 10,
                    resize: "vertical",
                    marginBottom: 10,
                    boxSizing: "border-box",
                  }}
                />

                <button
                  onClick={() => assignPlanToDate(dateKey)}
                  disabled={assigningDate === dateKey || !isCoach}
                  style={{
                    width: "100%",
                    padding: isDenseLayout ? "8px 12px" : "10px 14px",
                    marginBottom: 16,
                  }}
                >
                  {assigningDate === dateKey ? "Assigning..." : "Assign Plan"}
                </button>

                <div style={{ display: "grid", gap: 12 }}>
                  {dayEvents.length === 0 &&
                  dayTournaments.length === 0 &&
                  dayCompletedPractices.length === 0 ? (
                    <p style={{ fontSize: 14, color: "#666" }}>
                      No practice, completed session, or tournament scheduled.
                    </p>
                  ) : null}

                  {dayCompletedPractices.map((session) => (
                    <div
                      key={`completed-${session.id}`}
                      style={{
                        border: "1px solid rgba(22, 101, 52, 0.28)",
                        borderRadius: 10,
                        padding: isDenseLayout ? 10 : 12,
                        background: "rgba(22, 101, 52, 0.08)",
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: "#166534",
                          color: "#fff",
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          marginBottom: 8,
                        }}
                      >
                        Completed Practice
                      </div>

                      <strong>{session.practicePlanTitle || "Completed practice"}</strong>

                      <div style={{ fontSize: isDenseLayout ? 13 : 14, marginTop: 6, color: "#555" }}>
                        {session.practicePlanStyle || "Mixed"} ·{" "}
                        {formatDurationLabel(session.totalSeconds || 0)} ·{" "}
                        {session.blockCount || 0} blocks
                      </div>

                      <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                        {(session.assignmentType || "team") === "group" && session.groupName
                          ? `Training group · ${session.groupName} · `
                          : (session.assignmentType || "team") === "custom"
                            ? "Custom wrestler assignment · "
                            : "Team-wide · "}
                        {formatCompletedAt(session.completedAt || session.createdAt)}
                        {session.completedByRole ? ` · ${session.completedByRole}` : ""}
                      </div>

                      {session.notes ? (
                        <div
                          style={{
                            marginTop: 10,
                            padding: 10,
                            borderRadius: 8,
                            background: "#fff",
                            border: "1px solid rgba(22, 101, 52, 0.16)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              color: "#166534",
                              textTransform: "uppercase",
                              marginBottom: 6,
                              letterSpacing: "0.06em",
                            }}
                          >
                            Post-practice notes
                          </div>

                          <p
                            style={{
                              fontSize: isDenseLayout ? 13 : 14,
                              margin: 0,
                              whiteSpace: "pre-wrap",
                              lineHeight: 1.5,
                            }}
                          >
                            {session.notes}
                          </p>
                        </div>
                      ) : (
                        <p style={{ fontSize: isDenseLayout ? 13 : 14, marginTop: 8, color: "#666" }}>
                          No post-practice notes were added.
                        </p>
                      )}

                      {session.practicePlanId ? (
                        <Link
                          href={`/practice-plans?open=${session.practicePlanId}`}
                          style={{ display: "inline-block", marginTop: 10 }}
                        >
                          Open Plan
                        </Link>
                      ) : null}
                    </div>
                  ))}

                  {dayTournaments.map((tournament) => (
                    <div
                      key={`tournament-${tournament.id}`}
                      style={{
                        border: "1px solid rgba(191, 16, 41, 0.18)",
                        borderRadius: 10,
                        padding: isDenseLayout ? 10 : 12,
                        background: "rgba(191, 16, 41, 0.08)",
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: "#bf1029",
                          color: "#fff",
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          marginBottom: 8,
                        }}
                      >
                        Tournament
                      </div>

                      <strong>{tournament.name}</strong>

                      <div style={{ fontSize: isDenseLayout ? 13 : 14, marginTop: 6, color: "#555" }}>
                        {tournament.rosterCount} attending · {tournament.submittedCount} submitted ·{" "}
                        {tournament.verifiedCount} verified
                      </div>

                      {tournament.notes ? (
                        <p style={{ fontSize: isDenseLayout ? 13 : 14, marginTop: 8, marginBottom: 8 }}>
                          {tournament.notes}
                        </p>
                      ) : null}

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                        <Link href={`/tournaments?open=${tournament.id}`} style={{ display: "inline-block" }}>
                          Open Tournament
                        </Link>

                        <a href={tournament.registrationUrl} target="_blank" rel="noreferrer">
                          Registration
                        </a>
                      </div>
                    </div>
                  ))}

                  {dayEvents.map((event) => (
                    <div
                      key={event.id}
                      style={{
                        border: "1px solid #eee",
                        borderRadius: 10,
                        padding: isDenseLayout ? 10 : 12,
                        background: "#fafafa",
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: "#0f3d68",
                          color: "#fff",
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          marginBottom: 8,
                        }}
                      >
                        Scheduled Practice
                      </div>

                      <strong>{event.practicePlanTitle}</strong>

                      <div style={{ fontSize: isDenseLayout ? 13 : 14, marginTop: 6 }}>
                        {event.practicePlanStyle || "Mixed"} ·{" "}
                        {formatDurationLabel(event.totalSeconds || event.totalMinutes * 60 || 0)}
                      </div>

                      <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                        {event.assignmentType === "group" && event.groupName
                          ? `Training group · ${event.groupName}`
                          : event.assignmentType === "custom"
                            ? `Custom wrestlers · ${(event.assignedWrestlerIds || []).length}`
                            : "Team-wide practice"}
                      </div>

                      {event.notes ? (
                        <p style={{ fontSize: isDenseLayout ? 13 : 14, marginTop: 8, marginBottom: 8 }}>
                          {event.notes}
                        </p>
                      ) : null}

                      <Link
                        href={`/practice-plans?open=${event.practicePlanId}`}
                        style={{ display: "inline-block", marginRight: 10, marginBottom: 8 }}
                      >
                        Open Plan
                      </Link>

                      {isCoach ? (
                        <button onClick={() => removeEvent(event.id)} style={{ padding: "6px 10px" }}>
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {isCoach ? (
          <section style={{ marginTop: 28 }}>
            <h2 style={{ marginBottom: 8 }}>Coach Weekly Review</h2>
            <p style={{ color: "#666", marginTop: 0, marginBottom: 18 }}>
              Review live group names, scheduled work, and post-practice notes for the selected week.
            </p>

            <div style={{ display: "grid", gap: 14 }}>
              {weeklyReviewBlocks.length === 0 ? (
                <div
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 12,
                    padding: 16,
                    background: "#fff",
                    color: "#666",
                  }}
                >
                  No team-wide or group-assigned practices landed in this week yet.
                </div>
              ) : (
                weeklyReviewBlocks.map((block) => {
                  const noteSessions = block.completed.filter((session) => session.notes?.trim());

                  return (
                    <section
                      key={block.key}
                      style={{
                        border: "1px solid #ddd",
                        borderRadius: 12,
                        padding: 16,
                        background: "#fff",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          flexWrap: "wrap",
                          marginBottom: 12,
                        }}
                      >
                        <div>
                          <h3 style={{ marginTop: 0, marginBottom: 6 }}>{block.title}</h3>
                          <div style={{ color: "#666", fontSize: 14 }}>
                            {block.completed.length} completed · {block.scheduled.length} upcoming
                          </div>
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                          gap: 12,
                          marginBottom: 14,
                        }}
                      >
                        <div
                          style={{
                            borderRadius: 10,
                            padding: 12,
                            background: "#f8fafc",
                            border: "1px solid #e5e7eb",
                          }}
                        >
                          <div style={{ fontSize: 12, color: "#666", textTransform: "uppercase", marginBottom: 6 }}>
                            Upcoming / Scheduled
                          </div>
                          {block.scheduled.length === 0 ? (
                            <div style={{ color: "#666", fontSize: 14 }}>Nothing scheduled yet this week.</div>
                          ) : (
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {block.scheduled.map((event) => (
                                <li key={event.id} style={{ marginBottom: 6 }}>
                                  {event.date}: {event.practicePlanTitle}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div
                          style={{
                            borderRadius: 10,
                            padding: 12,
                            background: "#f8fafc",
                            border: "1px solid #e5e7eb",
                          }}
                        >
                          <div style={{ fontSize: 12, color: "#666", textTransform: "uppercase", marginBottom: 6 }}>
                            Completed This Week
                          </div>
                          {block.completed.length === 0 ? (
                            <div style={{ color: "#666", fontSize: 14 }}>No completed practices recorded yet.</div>
                          ) : (
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {block.completed.map((session) => (
                                <li key={session.id} style={{ marginBottom: 6 }}>
                                  {session.practicePlanTitle || "Completed practice"} ·{" "}
                                  {formatCompletedAt(session.completedAt || session.createdAt)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          borderRadius: 10,
                          padding: 12,
                          background: "#fffdf5",
                          border: "1px solid #f3e8a8",
                        }}
                      >
                        <div style={{ fontSize: 12, color: "#8a6d00", textTransform: "uppercase", marginBottom: 8 }}>
                          Post-practice notes
                        </div>

                        {noteSessions.length === 0 ? (
                          <div style={{ color: "#666", fontSize: 14 }}>
                            No post-practice notes for this group yet. When coaches mark practices complete, their notes will land here automatically.
                          </div>
                        ) : (
                          <div style={{ display: "grid", gap: 10 }}>
                            {noteSessions.map((session) => (
                              <div
                                key={session.id}
                                style={{
                                  borderRadius: 8,
                                  border: "1px solid #eadf9a",
                                  padding: 10,
                                  background: "#ffffff",
                                }}
                              >
                                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                                  {session.practicePlanTitle || "Completed practice"}
                                </div>
                                <div style={{ color: "#666", fontSize: 13, marginBottom: 6 }}>
                                  {formatCompletedAt(session.completedAt || session.createdAt)}
                                </div>
                                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                                  {session.notes}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>
                  );
                })
              )}
            </div>
          </section>
        ) : null}
      </main>
    </RequireAuth>
  );
}
