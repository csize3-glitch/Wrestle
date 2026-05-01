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
  calendarEventMatchesWrestler,
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
  startTime?: string;
  endTime?: string;
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
type CoachCalendarFilter = "all" | "team" | "custom" | `group:${string}`;

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

function buildEventAssignmentKey(event: {
  practicePlanId?: string;
  assignmentType?: string;
  groupId?: string;
  assignedWrestlerIds?: string[];
}) {
  return [
    event.practicePlanId || "",
    event.assignmentType || "team",
    event.groupId || "",
    uniqueIds(event.assignedWrestlerIds || []).sort().join(","),
  ].join("::");
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

function formatAttendanceSummary(
  counts?: PracticeSession["attendanceCounts"]
) {
  if (!counts) {
    return "Attendance not logged.";
  }

  return `Present ${counts.present || 0} · Late ${counts.late || 0} · Absent ${counts.absent || 0} · Injured ${counts.injured || 0} · Excused ${counts.excused || 0} · Not sure ${counts.not_sure || 0} · Not checked in ${counts.not_checked_in || 0}`;
}

function getCompletedPracticeDate(session: CompletedPracticeSessionItem) {
  return (
    session.date ||
    toDateKeyFromTimestamp(session.completedAt) ||
    toDateKeyFromTimestamp(session.createdAt)
  );
}

export default function CalendarPage() {
  const { firebaseUser, appUser, currentTeam } = useAuthState();

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
  const [coachCalendarFilter, setCoachCalendarFilter] = useState<CoachCalendarFilter>("all");
  const [viewAsWrestlerId, setViewAsWrestlerId] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(1440);

  const isCoach = appUser?.role === "coach";

  const athleteOwnedWrestler =
    appUser?.role === "athlete"
      ? wrestlers.find(
          (wrestler) =>
            wrestler.ownerUserId === firebaseUser?.uid ||
            wrestler.ownerUserId === appUser.id
        ) || null
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

  const visibleAthletePreview =
    isCoach && viewAsWrestlerId
      ? wrestlers.find((wrestler) => wrestler.id === viewAsWrestlerId) || null
      : null;

  const athleteViewBannerName = visibleAthletePreview
    ? `${visibleAthletePreview.firstName} ${visibleAthletePreview.lastName}`.trim() || "Selected Wrestler"
    : "";

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
  }, [
    appUser?.role,
    athleteOwnedWrestler?.id,
    currentTeam?.id,
    firebaseUser?.uid,
  ]);

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

    const eventRows =
      appUser?.role === "coach"
        ? await listCalendarEvents(db, currentTeam.id)
        : await listCalendarEvents(db, currentTeam.id, athleteOwnedWrestler);

    setEvents(
      eventRows
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
        .filter((event) => event.date >= weekStartKey && event.date <= weekEndKey)
    );

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
  }, [
    appUser?.id,
    appUser?.role,
    athleteOwnedWrestler?.id,
    currentTeam?.id,
    firebaseUser?.uid,
    weekStartKey,
    weekEndKey,
    wrestlersLoaded,
  ]);

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

  const visibleScheduleEvents = useMemo(() => {
    if (isCoach && visibleAthletePreview) {
      return events.filter((event) => calendarEventMatchesWrestler(event, visibleAthletePreview));
    }

    return events;
  }, [events, isCoach, visibleAthletePreview]);

  const visibleCompletedPractices = useMemo(() => {
    if (isCoach && visibleAthletePreview) {
      return completedPractices.filter((session) =>
        calendarEventMatchesWrestler(session, visibleAthletePreview)
      );
    }

    return completedPractices;
  }, [completedPractices, isCoach, visibleAthletePreview]);

  const filteredEvents = useMemo(() => {
    if (!isCoach || coachCalendarFilter === "all") {
      return visibleScheduleEvents;
    }

    if (coachCalendarFilter === "team") {
      return visibleScheduleEvents.filter(
        (event) =>
          (event.assignmentType || "team") === "team" ||
          (!event.assignmentType && !event.groupId && !(event.assignedWrestlerIds || []).length)
      );
    }

    if (coachCalendarFilter === "custom") {
      return visibleScheduleEvents.filter((event) => event.assignmentType === "custom");
    }

    if (coachCalendarFilter.startsWith("group:")) {
      const groupId = coachCalendarFilter.slice("group:".length);
      return visibleScheduleEvents.filter((event) => event.groupId === groupId);
    }

    return visibleScheduleEvents;
  }, [coachCalendarFilter, isCoach, visibleScheduleEvents]);

  const filteredCompletedPractices = useMemo(() => {
    if (!isCoach || coachCalendarFilter === "all") {
      return visibleCompletedPractices;
    }

    if (coachCalendarFilter === "team") {
      return visibleCompletedPractices.filter(
        (session) =>
          (session.assignmentType || "team") === "team" ||
          (!session.assignmentType && !session.groupId && !(session.assignedWrestlerIds || []).length)
      );
    }

    if (coachCalendarFilter === "custom") {
      return visibleCompletedPractices.filter((session) => session.assignmentType === "custom");
    }

    if (coachCalendarFilter.startsWith("group:")) {
      const groupId = coachCalendarFilter.slice("group:".length);
      return visibleCompletedPractices.filter((session) => session.groupId === groupId);
    }

    return visibleCompletedPractices;
  }, [coachCalendarFilter, isCoach, visibleCompletedPractices]);

  function getResolvedAssignmentPreview(dateKey: string) {
    const selectedPlan = savedPlans.find((plan) => plan.id === selectedPlanByDate[dateKey]);
    if (!selectedPlan) {
      return null;
    }

    const assignmentType = assignmentTypeByDate[dateKey] || "team";
    const groupId = selectedGroupByDate[dateKey] || "";
    const assignedWrestlerIds = getResolvedAssignedWrestlerIds(
      assignmentType,
      groupId,
      customWrestlersByDate[dateKey] || []
    );
    const resolvedWrestlers =
      assignmentType === "team"
        ? wrestlers
        : wrestlers.filter((wrestler) => assignedWrestlerIds.includes(wrestler.id));
    const pushTargetCount =
      assignmentType === "team"
        ? uniqueIds(
            wrestlers
              .map((wrestler) => wrestler.ownerUserId)
              .filter((value): value is string => Boolean(value))
          ).length
        : uniqueIds(
            resolvedWrestlers
              .map((wrestler) => wrestler.ownerUserId)
              .filter((value): value is string => Boolean(value))
          ).length;

    return {
      selectedPlan,
      assignmentType,
      groupId,
      groupName: groupId ? trainingGroupNameById[groupId] || "Selected group" : "",
      assignedWrestlerIds,
      resolvedWrestlers,
      pushTargetCount,
      isValid:
        assignmentType === "team" ||
        (assignmentType === "group" ? Boolean(groupId) : assignedWrestlerIds.length > 0),
    };
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
      attendanceTotals: {
        present: number;
        absent: number;
        late: number;
        injured: number;
        excused: number;
        not_sure: number;
        not_checked_in: number;
      };
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
        scheduled.length === 0
          ? completed.length > 0
            ? 100
            : 0
          : Math.min(100, Math.round((completed.length / scheduled.length) * 100));

      const noteSessions = completed.filter((session) => session.notes?.trim());
      const latestNote = noteSessions[0] || null;
      const attendanceTotals = completed.reduce(
        (totals, session) => {
          if (!session.attendanceCounts) {
            return totals;
          }
          totals.present += session.attendanceCounts.present || 0;
          totals.absent += session.attendanceCounts.absent || 0;
          totals.late += session.attendanceCounts.late || 0;
          totals.injured += session.attendanceCounts.injured || 0;
          totals.excused += session.attendanceCounts.excused || 0;
          totals.not_sure += session.attendanceCounts.not_sure || 0;
          totals.not_checked_in += session.attendanceCounts.not_checked_in || 0;
          return totals;
        },
        {
          present: 0,
          absent: 0,
          late: 0,
          injured: 0,
          excused: 0,
          not_sure: 0,
          not_checked_in: 0,
        }
      );

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
        attendanceTotals,
        rosterHref: "/wrestlers",
        rosterLabel,
      };
    }

    const cards: WeeklyReviewCard[] = [];

    const legacyTeamScheduled = filteredEvents.filter(
      (event) =>
        (event.assignmentType || "team") === "team" ||
        (!event.assignmentType && !event.groupId && !(event.assignedWrestlerIds || []).length)
    );

    const legacyTeamCompleted = filteredCompletedPractices.filter(
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
        filteredEvents.filter((event) => event.groupId === group.id),
        filteredCompletedPractices.filter((session) => session.groupId === group.id),
        `Open ${group.name} roster`
      );

      if (card) cards.push(card);
    }

    const customCard = buildCard(
      "custom",
      "Custom / 1-on-1",
      "Individually assigned practices and private work this week.",
      "custom",
      filteredEvents.filter((event) => event.assignmentType === "custom"),
      filteredCompletedPractices.filter((session) => session.assignmentType === "custom"),
      "Open wrestler assignments"
    );

    if (customCard) cards.push(customCard);

    return cards;
  }, [activeTrainingGroups, filteredCompletedPractices, filteredEvents]);

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

  async function copyThisWeek() {
    if (!currentTeam?.id || !isCoach) {
      return;
    }

    const offsetInput = window.prompt(
      "Copy this week to how many weeks ahead?",
      "1"
    );

    if (!offsetInput) {
      return;
    }

    const weekJump = Number.parseInt(offsetInput, 10);
    if (!Number.isFinite(weekJump) || weekJump < 1) {
      alert("Enter a valid number of weeks ahead.");
      return;
    }

    const targetDates = weekDates.map((date) => {
      const next = new Date(date);
      next.setDate(next.getDate() + weekJump * 7);
      return formatDateKey(next);
    });
    const targetStart = targetDates[0];
    const targetEnd = targetDates[targetDates.length - 1];

    try {
      const allEventsSnapshot = await getDocs(
        query(collection(db, COLLECTIONS.CALENDAR_EVENTS), where("teamId", "==", currentTeam.id))
      );
      const allTeamEvents = allEventsSnapshot.docs.map((docSnapshot) => ({
        id: docSnapshot.id,
        ...(docSnapshot.data() as Omit<CalendarEventItem, "id">),
      }));

      const existingTargetKeys = new Set(
        allTeamEvents
          .filter((event) => event.date >= targetStart && event.date <= targetEnd)
          .map((event) => `${event.date}::${buildEventAssignmentKey(event)}`)
      );

      const sourceEvents = allTeamEvents
        .filter((event) => event.date >= weekStartKey && event.date <= weekEndKey)
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      let copiedCount = 0;
      let skippedCount = 0;

      for (const event of sourceEvents) {
        const sourceIndex = weekDates.findIndex((date) => formatDateKey(date) === event.date);
        if (sourceIndex === -1) {
          continue;
        }

        const nextDate = targetDates[sourceIndex];
        const targetKey = `${nextDate}::${buildEventAssignmentKey(event)}`;

        if (existingTargetKeys.has(targetKey)) {
          skippedCount += 1;
          continue;
        }

        await addDoc(collection(db, COLLECTIONS.CALENDAR_EVENTS), {
          teamId: currentTeam.id,
          date: nextDate,
          practicePlanId: event.practicePlanId,
          assignmentType: event.assignmentType || "team",
          groupId: event.groupId || "",
          groupName: event.groupName || "",
          assignedWrestlerIds: event.assignedWrestlerIds || [],
          practicePlanTitle: event.practicePlanTitle || "",
          practicePlanStyle: event.practicePlanStyle || "Mixed",
          totalMinutes: event.totalMinutes || 0,
          totalSeconds: event.totalSeconds || (event.totalMinutes || 0) * 60 || 0,
          notes: event.notes || "",
          startTime: event.startTime || "",
          endTime: event.endTime || "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        existingTargetKeys.add(targetKey);
        copiedCount += 1;
      }

      await refreshEvents();
      alert(
        skippedCount > 0
          ? `Copied ${copiedCount} practices. Skipped ${skippedCount} duplicates already scheduled in the target week.`
          : `Copied ${copiedCount} practices into the target week.`
      );
    } catch (error) {
      console.error("Failed to copy week:", error);
      alert("Failed to copy this week.");
    }
  }

  function getEventsForDate(dateKey: string) {
    return filteredEvents.filter((event) => event.date === dateKey);
  }

  function getTournamentsForDate(dateKey: string) {
    return tournaments.filter((tournament) => tournament.date === dateKey);
  }

  function getCompletedPracticesForDate(dateKey: string) {
    return filteredCompletedPractices.filter((session) => getCompletedPracticeDate(session) === dateKey);
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

          {isCoach ? (
            <button onClick={copyThisWeek} style={{ padding: "10px 14px" }}>
              Copy This Week
            </button>
          ) : null}
        </div>

        {isCoach ? (
          <section
            style={{
              border: "1px solid #dbe5f0",
              borderRadius: 16,
              padding: 16,
              background: "#fff",
              marginBottom: 18,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
                alignItems: "end",
              }}
            >
              <div>
                <h2 style={{ marginTop: 0, marginBottom: 6, fontSize: 20 }}>Coach schedule lens</h2>
                <p style={{ marginTop: 0, color: "#667085", fontSize: 14, marginBottom: 0 }}>
                  Filter the week by assignment lane or preview the schedule exactly as a wrestler would see it.
                </p>
              </div>

              <div style={{ display: "grid", gap: 6, minWidth: 260, flex: "0 1 320px" }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>View as athlete</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select
                    value={viewAsWrestlerId}
                    onChange={(e) => setViewAsWrestlerId(e.target.value)}
                    style={{ flex: "1 1 220px", padding: 10 }}
                  >
                    <option value="">Full coach view</option>
                    {wrestlers.map((wrestler) => {
                      const fullName = `${wrestler.firstName} ${wrestler.lastName}`.trim() || "Unnamed Wrestler";
                      return (
                        <option key={wrestler.id} value={wrestler.id}>
                          {fullName}
                        </option>
                      );
                    })}
                  </select>

                  {viewAsWrestlerId ? (
                    <button onClick={() => setViewAsWrestlerId("")} style={{ padding: "10px 14px" }}>
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {athleteViewBannerName ? (
              <div
                style={{
                  marginTop: 14,
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "#fff7ed",
                  border: "1px solid #fed7aa",
                  color: "#9a3412",
                  fontWeight: 700,
                }}
              >
                Viewing schedule as {athleteViewBannerName}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              {[
                { key: "all" as CoachCalendarFilter, label: "All" },
                { key: "team" as CoachCalendarFilter, label: "Team-wide" },
                ...activeTrainingGroups.map((group) => ({
                  key: `group:${group.id}` as CoachCalendarFilter,
                  label: group.name,
                })),
                { key: "custom" as CoachCalendarFilter, label: "Custom / 1-on-1" },
              ].map((filterOption) => {
                const isActive = coachCalendarFilter === filterOption.key;
                return (
                  <button
                    key={filterOption.key}
                    onClick={() => setCoachCalendarFilter(filterOption.key)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 999,
                      border: isActive ? "1px solid #0f3d68" : "1px solid #d1d5db",
                      background: isActive ? "#0f3d68" : "#fff",
                      color: isActive ? "#fff" : "#344054",
                      fontWeight: 700,
                    }}
                  >
                    {filterOption.label}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

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
            const assignmentPreview = getResolvedAssignmentPreview(dateKey);

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
                  disabled={
                    assigningDate === dateKey ||
                    !isCoach ||
                    !assignmentPreview?.selectedPlan ||
                    !assignmentPreview.isValid
                  }
                  style={{
                    width: "100%",
                    padding: isDenseLayout ? "8px 12px" : "10px 14px",
                    marginBottom: 16,
                  }}
                >
                  {assigningDate === dateKey ? "Assigning..." : "Assign Plan"}
                </button>

                {isCoach && assignmentPreview ? (
                  <div
                    style={{
                      border: "1px solid #dbe5f0",
                      borderRadius: 12,
                      padding: 12,
                      background: "#f8fbff",
                      marginBottom: 16,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div>
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
                        Assignment Preview
                      </div>
                      <div style={{ fontWeight: 700 }}>{assignmentPreview.selectedPlan.title}</div>
                      <div style={{ color: "#667085", fontSize: 14, marginTop: 4 }}>
                        {assignmentPreview.assignmentType === "group"
                          ? assignmentPreview.groupName || "Selected training group"
                          : assignmentPreview.assignmentType === "custom"
                            ? "Custom wrestler assignment"
                            : "Team-wide practice"}{" "}
                        · {formatDurationLabel(
                          assignmentPreview.selectedPlan.totalSeconds ||
                            assignmentPreview.selectedPlan.totalMinutes * 60 ||
                            0
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                        gap: 10,
                      }}
                    >
                      {[
                        {
                          label: "Wrestlers",
                          value:
                            assignmentPreview.assignmentType === "team"
                              ? assignmentPreview.resolvedWrestlers.length
                              : assignmentPreview.assignedWrestlerIds.length,
                        },
                        {
                          label: "Push targets",
                          value: assignmentPreview.pushTargetCount,
                        },
                        {
                          label: "Duration",
                          value: formatDurationLabel(
                            assignmentPreview.selectedPlan.totalSeconds ||
                              assignmentPreview.selectedPlan.totalMinutes * 60 ||
                              0
                          ),
                        },
                      ].map((stat) => (
                        <div
                          key={stat.label}
                          style={{
                            borderRadius: 10,
                            padding: 10,
                            background: "#fff",
                            border: "1px solid rgba(15, 23, 42, 0.08)",
                          }}
                        >
                          <div style={{ fontSize: 11, color: "#667085", textTransform: "uppercase", fontWeight: 800, letterSpacing: "0.06em", marginBottom: 6 }}>
                            {stat.label}
                          </div>
                          <div style={{ fontSize: 18, fontWeight: 800 }}>{stat.value}</div>
                        </div>
                      ))}
                    </div>

                    <div>
                      <div style={{ fontSize: 12, color: "#667085", textTransform: "uppercase", fontWeight: 800, letterSpacing: "0.06em", marginBottom: 6 }}>
                        Resolved roster
                      </div>
                      {assignmentPreview.assignmentType === "team" ? (
                        <div style={{ color: "#344054", fontSize: 14 }}>
                          All active team athletes{assignmentPreview.resolvedWrestlers.length > 0 ? ` · ${assignmentPreview.resolvedWrestlers.length} wrestlers` : ""}.
                        </div>
                      ) : assignmentPreview.resolvedWrestlers.length === 0 ? (
                        <div style={{ color: "#b42318", fontSize: 14 }}>
                          No wrestlers resolved yet. Choose a valid group or custom athlete list before assigning.
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {assignmentPreview.resolvedWrestlers.map((wrestler) => {
                            const fullName = `${wrestler.firstName} ${wrestler.lastName}`.trim() || "Unnamed Wrestler";
                            return (
                              <span
                                key={wrestler.id}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  padding: "6px 10px",
                                  borderRadius: 999,
                                  background: "#fff",
                                  border: "1px solid #d1d5db",
                                  fontSize: 13,
                                }}
                              >
                                {fullName}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

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

                      <div style={{ fontSize: 12, color: "#166534", marginTop: 6, fontWeight: 700 }}>
                        {formatAttendanceSummary(session.attendanceCounts)}
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
                        {
                          label: "Attendance",
                          value: block.attendanceTotals.present,
                          helper:
                            block.attendanceTotals.present +
                              block.attendanceTotals.absent +
                              block.attendanceTotals.late +
                              block.attendanceTotals.injured +
                              block.attendanceTotals.excused +
                              block.attendanceTotals.not_sure +
                              block.attendanceTotals.not_checked_in >
                            0
                              ? `P ${block.attendanceTotals.present} · A ${block.attendanceTotals.absent} · L ${block.attendanceTotals.late} · ? ${block.attendanceTotals.not_sure} · NC ${block.attendanceTotals.not_checked_in}`
                              : "Attendance not logged",
                        },
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
                                <div style={{ color: "#8a6d00", fontSize: 13, marginBottom: 6, fontWeight: 700 }}>
                                  {formatAttendanceSummary(session.attendanceCounts)}
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
