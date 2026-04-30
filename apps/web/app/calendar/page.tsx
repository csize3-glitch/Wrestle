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
  listCalendarEvents,
  listPracticeSessions,
  practicePlanMatchesAssignment,
  listTrainingGroups,
  listTournamentEntries,
  listTournaments,
  listWrestlers,
  sendTeamPushDelivery,
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
  practicePlanTitle?: string;
  practicePlanStyle?: string;
  totalMinutes?: number;
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
  const [wrestlersLoaded, setWrestlersLoaded] = useState(false);

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
          setWrestlersLoaded(true);
          return;
        }

        setWrestlersLoaded(false);
        setWrestlers(await listWrestlers(db, currentTeam.id));
      } catch (error) {
        console.error("Failed to load wrestlers for calendar assignment filtering:", error);
      } finally {
        setWrestlersLoaded(true);
      }
    }

    loadWrestlers();
  }, [currentTeam?.id]);

  useEffect(() => {
    async function loadTrainingGroupsForTeam() {
      if (!currentTeam?.id) {
        setTrainingGroups([]);
        return;
      }

      try {
        const groups = await listTrainingGroups(db, currentTeam.id);
        setTrainingGroups(groups);
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
          .filter((plan) =>
            appUser?.role === "athlete"
              ? athleteOwnedWrestler
                ? practicePlanMatchesAssignment(plan, athleteOwnedWrestler)
                : false
              : true
          )
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

    if (appUser?.role === "athlete" && !athleteOwnedWrestler) {
      setEvents([]);
      setTournaments([]);
      setCompletedPractices([]);
      return;
    }

    const eventRows = (
      await listCalendarEvents(
        db,
        currentTeam.id,
        appUser?.role === "athlete" ? athleteOwnedWrestler : undefined
      )
    )
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
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

        if (appUser?.role === "athlete" && !wrestlersLoaded) {
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
  }, [appUser?.role, athleteOwnedWrestler, currentTeam?.id, weekStartKey, weekEndKey, wrestlersLoaded]);

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

  const weeklyReviewCards = useMemo(() => {
    type ReviewTone = "team" | "group" | "custom";
    type WeeklyReviewCard = {
      key: string;
      title: string;
      subtitle: string;
      tone: ReviewTone;
      scheduled: CalendarEventItem[];
      completed: CompletedPracticeSessionItem[];
      totalScheduledMinutes: number;
      completionRate: number;
      latestNote: CompletedPracticeSessionItem | null;
      noteSessions: CompletedPracticeSessionItem[];
      rosterHref: string;
      rosterLabel: string;
    };

    function buildCard(
      key: string,
      title: string,
      subtitle: string,
      tone: ReviewTone,
      scheduled: CalendarEventItem[],
      completed: CompletedPracticeSessionItem[],
      rosterLabel: string
    ): WeeklyReviewCard | null {
      if (scheduled.length === 0 && completed.length === 0) {
        return null;
      }

      const totalScheduledMinutes = scheduled.reduce(
        (sum, event) => sum + (event.totalMinutes || Math.round((event.totalSeconds || 0) / 60) || 0),
        0
      );
      const completionRate =
        scheduled.length === 0 ? (completed.length > 0 ? 100 : 0) : Math.min(100, Math.round((completed.length / scheduled.length) * 100));
      const noteSessions = completed.filter((session) => session.notes?.trim());
      const latestNote = noteSessions[0] || null;

      return {
        key,
        title,
        subtitle,
        tone,
        scheduled,
        completed,
        totalScheduledMinutes,
        completionRate,
        latestNote,
        noteSessions,
        rosterHref: "/wrestlers",
        rosterLabel,
      };
    }

    const cards: WeeklyReviewCard[] = [];
    const legacyTeamScheduled = events.filter(
      (event) =>
        (event.assignmentType || "team") === "team" ||
        (!event.assignmentType && !event.groupId && !(event.assignedWrestlerIds || []).length)
    );
    const legacyTeamCompleted = completedPractices.filter(
      (session) =>
        (session.assignmentType || "team") === "team" ||
        (!session.assignmentType && !session.groupId && !(session.assignedWrestlerIds || []).length)
    );
    const teamCard = buildCard(
      "team",
      "Team-wide",
      "Shared training work for the full roster this week.",
      "team",
      legacyTeamScheduled,
      legacyTeamCompleted,
      "Open roster"
    );
    if (teamCard) cards.push(teamCard);

    for (const group of activeTrainingGroups) {
      const card = buildCard(
        group.id,
        group.name,
        group.description?.trim() || "Training group review for the selected week.",
        "group",
        events.filter((event) => event.groupId === group.id),
        completedPractices.filter((session) => session.groupId === group.id),
        `Open ${group.name} roster`
      );
      if (card) cards.push(card);
    }

    const customCard = buildCard(
      "custom",
      "Custom / 1-on-1",
      "Individually assigned practices and private work this week.",
      "custom",
      events.filter((event) => event.assignmentType === "custom"),
      completedPractices.filter((session) => session.assignmentType === "custom"),
      "Open wrestler assignments"
    );
    if (customCard) cards.push(customCard);

    return cards;
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
                        {formatDurationLabel(
                          event.totalSeconds || (event.totalMinutes || 0) * 60 || 0
                        )}
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
                alignItems: "end",
                marginBottom: 18,
              }}
            >
              <div>
                <h2 style={{ marginBottom: 8 }}>Coach Weekly Review</h2>
                <p style={{ color: "#666", marginTop: 0, marginBottom: 4 }}>
                  Week of {formatPrettyDate(weekDates[0])} - {formatPrettyDate(weekDates[6])}
                </p>
                <p style={{ color: "#666", marginTop: 0, marginBottom: 0 }}>
                  Review team-wide work, active training groups, and post-practice notes without leaving the schedule.
                </p>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
                marginBottom: 18,
              }}
            >
              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid #dbe5f0",
                  background: "#f8fbff",
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: "#0f3d68", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  Active groups
                </div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{activeTrainingGroups.length}</div>
                <div style={{ color: "#667085", fontSize: 14, marginTop: 4 }}>
                  Available for scheduling, review, and roster assignments
                </div>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid #e7e2ff",
                  background: "#fbf9ff",
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: "#5b3cc4", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  Scheduled this week
                </div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{events.length}</div>
                <div style={{ color: "#667085", fontSize: 14, marginTop: 4 }}>
                  Total practices on the board across team, groups, and custom work
                </div>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid #dcefe2",
                  background: "#f7fcf8",
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: "#166534", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  Completed this week
                </div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{completedPractices.length}</div>
                <div style={{ color: "#667085", fontSize: 14, marginTop: 4 }}>
                  Logged practice sessions feeding coach notes and completion trends
                </div>
              </div>
            </div>

            <p style={{ color: "#666", marginTop: 0, marginBottom: 18 }}>
              Group names and roster setup now live on the Wrestlers page. Calendar stays focused on scheduling and review.
            </p>

            <div style={{ display: "grid", gap: 14 }}>
              {weeklyReviewCards.length === 0 ? (
                <div
                  style={{
                    border: "1px solid #dbe5f0",
                    borderRadius: 16,
                    padding: 18,
                    background: "#fff",
                    color: "#666",
                  }}
                >
                  No team-wide or group-assigned practices landed in this week yet.
                </div>
              ) : (
                weeklyReviewCards.map((block) => {
                  const toneStyles =
                    block.tone === "team"
                      ? {
                          border: "#dbe5f0",
                          background: "linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)",
                          badgeBackground: "#0f3d68",
                          badgeText: "#ffffff",
                        }
                      : block.tone === "custom"
                        ? {
                            border: "#f3dfc2",
                            background: "linear-gradient(180deg, #fffaf2 0%, #ffffff 100%)",
                            badgeBackground: "#8a4b00",
                            badgeText: "#ffffff",
                          }
                        : {
                            border: "#eadff7",
                            background: "linear-gradient(180deg, #fcf9ff 0%, #ffffff 100%)",
                            badgeBackground: "#5b3cc4",
                            badgeText: "#ffffff",
                          };

                  return (
                    <section
                      key={block.key}
                      style={{
                        border: `1px solid ${toneStyles.border}`,
                        borderRadius: 18,
                        padding: 18,
                        background: toneStyles.background,
                        boxShadow: "0 10px 30px rgba(15, 23, 42, 0.04)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          flexWrap: "wrap",
                          marginBottom: 14,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "4px 10px",
                              borderRadius: 999,
                              background: toneStyles.badgeBackground,
                              color: toneStyles.badgeText,
                              fontSize: 11,
                              fontWeight: 800,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              marginBottom: 10,
                            }}
                          >
                            {block.tone === "team"
                              ? "Team-wide"
                              : block.tone === "custom"
                                ? "Custom Focus"
                                : "Training Group"}
                          </div>
                          <h3 style={{ marginTop: 0, marginBottom: 6 }}>{block.title}</h3>
                          <div style={{ color: "#667085", fontSize: 14 }}>{block.subtitle}</div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "8px 12px",
                              borderRadius: 999,
                              background: "#ffffff",
                              border: "1px solid rgba(15, 23, 42, 0.08)",
                              fontSize: 13,
                              color: "#344054",
                            }}
                          >
                            <strong>{block.completionRate}%</strong> completion
                          </div>

                          <Link
                            href={block.rosterHref}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "8px 12px",
                              borderRadius: 999,
                              border: "1px solid rgba(15, 23, 42, 0.08)",
                              background: "#ffffff",
                              color: "#0f3d68",
                              textDecoration: "none",
                              fontWeight: 600,
                            }}
                          >
                            {block.rosterLabel}
                          </Link>
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                          gap: 12,
                          marginBottom: 16,
                        }}
                      >
                        {[
                          { label: "Scheduled", value: block.scheduled.length, helper: "Practices on the board" },
                          { label: "Completed", value: block.completed.length, helper: "Sessions logged this week" },
                          { label: "Minutes", value: block.totalScheduledMinutes, helper: "Total scheduled training minutes" },
                        ].map((stat) => (
                          <div
                            key={stat.label}
                            style={{
                              borderRadius: 14,
                              padding: 14,
                              background: "#ffffff",
                              border: "1px solid rgba(15, 23, 42, 0.08)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 12,
                                color: "#667085",
                                textTransform: "uppercase",
                                letterSpacing: "0.06em",
                                marginBottom: 8,
                                fontWeight: 800,
                              }}
                            >
                              {stat.label}
                            </div>
                            <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{stat.value}</div>
                            <div style={{ color: "#667085", fontSize: 13, marginTop: 8 }}>{stat.helper}</div>
                          </div>
                        ))}
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                          gap: 12,
                          marginBottom: 14,
                        }}
                      >
                        <div
                          style={{
                            borderRadius: 14,
                            padding: 14,
                            background: "#ffffff",
                            border: "1px solid rgba(15, 23, 42, 0.08)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              color: "#667085",
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              marginBottom: 8,
                              fontWeight: 800,
                            }}
                          >
                            Latest note
                          </div>
                          {block.latestNote ? (
                            <>
                              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                                {block.latestNote.practicePlanTitle || "Completed practice"}
                              </div>
                              <div style={{ color: "#667085", fontSize: 13, marginBottom: 8 }}>
                                {formatCompletedAt(block.latestNote.completedAt || block.latestNote.createdAt)}
                              </div>
                              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                                {block.latestNote.notes}
                              </div>
                            </>
                          ) : (
                            <div style={{ color: "#667085", fontSize: 14 }}>
                              No post-practice notes yet. Coaches will see the newest reflection here after a session is marked complete.
                            </div>
                          )}
                        </div>

                        <div
                          style={{
                            borderRadius: 14,
                            padding: 14,
                            background: "#ffffff",
                            border: "1px solid rgba(15, 23, 42, 0.08)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              color: "#667085",
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              marginBottom: 8,
                              fontWeight: 800,
                            }}
                          >
                            Week snapshot
                          </div>
                          <div style={{ display: "grid", gap: 6, color: "#344054", fontSize: 14 }}>
                            <div>{block.scheduled.length} scheduled practices queued for this review lane.</div>
                            <div>{block.completed.length} completed sessions feeding weekly notes.</div>
                            <div>
                              {block.completionRate === 100 && block.scheduled.length > 0
                                ? "All scheduled work is completed."
                                : block.scheduled.length === 0
                                  ? "No upcoming practices in this lane right now."
                                  : `${Math.max(0, block.scheduled.length - block.completed.length)} scheduled practices still need completion notes.`}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div
                        style={{
                          borderRadius: 14,
                          padding: 14,
                          background: "#fffdf5",
                          border: "1px solid #f3e8a8",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            flexWrap: "wrap",
                            alignItems: "center",
                            marginBottom: 10,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              color: "#8a6d00",
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              fontWeight: 800,
                            }}
                          >
                            All post-practice notes
                          </div>
                          <div style={{ color: "#8a6d00", fontSize: 13 }}>
                            {block.noteSessions.length} note{block.noteSessions.length === 1 ? "" : "s"} this week
                          </div>
                        </div>

                        <div
                          style={{
                            borderRadius: 10,
                            padding: 12,
                            background: "#ffffff",
                            border: "1px solid #f0e3a8",
                            marginBottom: 12,
                          }}
                        >
                          <div style={{ fontSize: 12, color: "#8a6d00", textTransform: "uppercase", marginBottom: 6, fontWeight: 800, letterSpacing: "0.06em" }}>
                            Scheduled lineup
                          </div>
                          {block.scheduled.length === 0 ? (
                            <div style={{ color: "#666", fontSize: 14 }}>Nothing scheduled yet this week.</div>
                          ) : (
                            <div style={{ display: "grid", gap: 8 }}>
                              {block.scheduled.map((event) => (
                                <div
                                  key={event.id}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    flexWrap: "wrap",
                                    fontSize: 14,
                                  }}
                                >
                                  <span>
                                    <strong>{event.practicePlanTitle}</strong> · {event.date}
                                  </span>
                                  <span style={{ color: "#667085" }}>
                                    {formatDurationLabel(
                                      event.totalSeconds || (event.totalMinutes || 0) * 60 || 0
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {block.noteSessions.length === 0 ? (
                          <div style={{ color: "#666", fontSize: 14 }}>
                            No post-practice notes for this review lane yet. When coaches mark practices complete, their notes will land here automatically.
                          </div>
                        ) : (
                          <div style={{ display: "grid", gap: 10 }}>
                            {block.noteSessions.map((session) => (
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
