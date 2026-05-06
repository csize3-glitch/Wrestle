import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@wrestlewell/firebase/client";
import {
  createTeamAnnouncement,
  listCalendarEvents,
  listPracticeAttendanceForWrestlers,
  listPracticeSessionFollowUps,
  listPracticeSessionsForWrestler,
  listTeamAnnouncements,
  listTeamNotifications,
  sendTeamPushDelivery,
  listTournamentEntries,
  listTournaments,
  listWrestlers,
  listWrestlersByIds,
  type CalendarEventRecord,
} from "@wrestlewell/lib/index";
import type {
  PracticeAttendanceRecord,
  PracticeSession,
  TeamAnnouncement,
  TeamNotification,
  Tournament,
  TournamentEntry,
  WrestlerProfile,
} from "@wrestlewell/types/index";
import { COLLECTIONS } from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell } from "../components/mobile-screen-shell";
import { useNotificationsState } from "../components/notifications-provider";

type NotificationKind =
  | "announcement"
  | "practice"
  | "tournament"
  | "attendance"
  | "followup"
  | "note";

type NotificationCard = {
  id: string;
  rawCreatedAt?: unknown;
  kind: NotificationKind;
  title: string;
  body: string;
  meta: string;
  isUnread: boolean;
  actionLabel: string;
  route: string;
  params?: Record<string, string>;
  relatedWrestlerName?: string;
  relatedContext?: string;
  relatedStatus?: string;
};

function normalizeDateValue(value: unknown): string {
  if (!value) return "";

  if (typeof value === "string") {
    return value;
  }

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

function dateTimeMs(value: unknown) {
  const normalized = normalizeDateValue(value);
  if (!normalized) return 0;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return 0;

  return date.getTime();
}

function isUnread(createdAt: unknown, lastSeenAt?: string) {
  if (!createdAt) return false;
  if (!lastSeenAt) return true;

  const createdMs = dateTimeMs(createdAt);
  const seenMs = dateTimeMs(lastSeenAt);

  if (!createdMs || !seenMs) {
    return false;
  }

  return createdMs > seenMs;
}

function formatPracticeDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatAnnouncementDate(value: unknown) {
  const normalized = normalizeDateValue(value);

  if (!normalized) {
    return "Just now";
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAttendanceStatus(status: PracticeAttendanceRecord["status"]) {
  switch (status) {
    case "late":
      return "Late";
    case "absent":
      return "Absent";
    case "injured":
      return "Injured";
    case "excused":
      return "Excused";
    case "not_sure":
      return "Not Sure";
    case "not_checked_in":
      return "Not Checked In";
    default:
      return "Present";
  }
}

function getRoleEmptyState(role?: string) {
  if (role === "coach") {
    return "No alerts yet. Athlete check-ins, registrations, follow-ups, and team announcements will appear here.";
  }

  if (role === "parent") {
    return "No alerts yet. Linked wrestler schedule changes, attendance updates, tournament reminders, and coach-shared notes will appear here.";
  }

  return "No alerts yet. Your schedule changes, tournament reminders, attendance updates, and coach-shared notes will appear here.";
}

function createPracticeCards(args: {
  events: CalendarEventRecord[];
  lastSeenAt?: string;
  role?: "coach" | "athlete" | "parent";
}): NotificationCard[] {
  const todayKey = new Date().toISOString().split("T")[0];

  return args.events
    .filter((event) => event.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6)
    .map((event) => ({
      id: `practice-${event.id}`,
      rawCreatedAt: event.date,
      kind: "practice" as const,
      title: event.practicePlanTitle || "Upcoming practice",
      body:
        event.notes ||
        `Your team has ${event.practicePlanStyle || "Mixed"} practice scheduled on ${formatPracticeDate(
          event.date
        )}.`,
      meta: `Practice reminder • ${formatPracticeDate(event.date)}`,
      isUnread: false,
      actionLabel: "Open Calendar",
      route: "/calendar",
      params: undefined,
      relatedContext:
        args.role === "coach"
          ? event.assignmentType === "group" && event.groupName
            ? event.groupName
            : event.assignmentType === "custom"
              ? "Custom assignment"
              : "Team-wide"
          : undefined,
    }));
}

function createTournamentCards(args: {
  tournaments: Tournament[];
  entriesByTournament: Record<string, TournamentEntry[]>;
  appRole: "coach" | "athlete" | "parent";
  visibleWrestlerIds?: string[];
  lastSeenAt?: string;
}): NotificationCard[] {
  if (args.appRole === "coach") {
    return args.tournaments
      .filter((tournament) => (args.entriesByTournament[tournament.id] || []).length > 0)
      .sort((a, b) => (a.eventDate || "9999-12-31").localeCompare(b.eventDate || "9999-12-31"))
      .slice(0, 6)
      .map((tournament) => {
        const entries = args.entriesByTournament[tournament.id] || [];
        const submittedCount = entries.filter((entry) => entry.status === "submitted").length;
        const confirmedCount = entries.filter((entry) => entry.status === "confirmed").length;

        const latestEntryTimestamp = entries
          .map((entry) => entry.updatedAt || entry.createdAt)
          .sort((a, b) => dateTimeMs(b) - dateTimeMs(a))[0];

        return {
          id: `tournament-${tournament.id}`,
          rawCreatedAt: latestEntryTimestamp || tournament.updatedAt || tournament.createdAt || tournament.eventDate,
          kind: "tournament" as const,
          title: `${tournament.name} roster update`,
          body:
            submittedCount > 0
              ? `${submittedCount} registration${submittedCount === 1 ? "" : "s"} need verification. ${confirmedCount} verified for Match-Day.`
              : `${entries.length} wrestler${entries.length === 1 ? " is" : "s are"} currently on the tournament roster. ${confirmedCount} verified for Match-Day.`,
          meta: tournament.eventDate
            ? `Tournament update • ${formatPracticeDate(tournament.eventDate)}`
            : "Tournament update",
          isUnread: isUnread(latestEntryTimestamp || tournament.updatedAt || tournament.createdAt, args.lastSeenAt),
          actionLabel: submittedCount > 0 ? "Review Registrations" : "Open Tournament",
          route: "/tournaments",
          params: { tournamentId: tournament.id },
        };
      });
  }

  if (!args.visibleWrestlerIds?.length) {
    return [];
  }

  return args.tournaments
    .filter((tournament) =>
      (args.entriesByTournament[tournament.id] || []).some(
        (entry) => args.visibleWrestlerIds?.includes(entry.wrestlerId)
      )
    )
    .sort((a, b) => (a.eventDate || "9999-12-31").localeCompare(b.eventDate || "9999-12-31"))
    .slice(0, 6)
    .map((tournament) => {
      const entry = (args.entriesByTournament[tournament.id] || []).find((row) =>
        args.visibleWrestlerIds?.includes(row.wrestlerId)
      );
      const params: Record<string, string> =
        entry?.status === "confirmed" && entry
          ? {
              tournamentId: tournament.id,
              wrestlerId: entry.wrestlerId,
            }
          : {
              tournamentId: tournament.id,
            };

      const tournamentAlertTimestamp =
        entry?.updatedAt || entry?.createdAt || tournament.updatedAt || tournament.createdAt;

      const wrestlerName = entry?.wrestlerName || "Your wrestler";
      const confirmedBody =
        args.appRole === "parent"
          ? `${wrestlerName}'s coach verified the registration. ${wrestlerName} is available on Match-Day.`
          : "Your coach verified your registration. You are available on Match-Day.";

      return {
        id: `tournament-${tournament.id}`,
        rawCreatedAt: tournamentAlertTimestamp || tournament.eventDate,
        kind: "tournament" as const,
        title: `${tournament.name} registration`,
        body:
          entry?.status === "confirmed"
            ? confirmedBody
            : entry?.status === "submitted"
              ? args.appRole === "parent"
                ? `${wrestlerName}'s registration is submitted and waiting for coach verification.`
                : "Your registration is submitted and waiting for coach verification."
              : args.appRole === "parent"
                ? `${wrestlerName} is listed on the WrestleWell roster for this tournament.`
                : "You are listed on the WrestleWell roster for this tournament.",
        meta: tournament.eventDate
          ? `Tournament update • ${formatPracticeDate(tournament.eventDate)}`
          : "Tournament update",
        isUnread: isUnread(tournamentAlertTimestamp, args.lastSeenAt),
        actionLabel: entry?.status === "confirmed" ? "Open Match-Day" : "Open Tournament",
        route: entry?.status === "confirmed" ? "/match-day" : "/tournaments",
        relatedWrestlerName: entry?.wrestlerName,
        relatedStatus: entry?.status,
        params,
      };
    });
}

function createAnnouncementCards(args: {
  items: TeamAnnouncement[];
  lastSeenAt?: string;
}): NotificationCard[] {
  return args.items.slice(0, 10).map((item) => ({
    id: `announcement-${item.id}`,
    rawCreatedAt: item.createdAt,
    kind: "announcement" as const,
    title: item.title,
    body: item.body,
    meta: `Coach announcement • ${formatAnnouncementDate(item.createdAt)}`,
    isUnread: isUnread(item.createdAt, args.lastSeenAt),
    actionLabel: "Mark Read",
    route: "/notifications",
  }));
}

function createTeamNotificationCards(args: {
  items: TeamNotification[];
  lastSeenAt?: string;
  wrestlerNameById?: Record<string, string>;
}): NotificationCard[] {
  return args.items.slice(0, 10).map((item) => {
    const isTournamentRegistration = item.type === "tournament_registration";

    return {
      id: `team-notification-${item.id}`,
      rawCreatedAt: item.createdAt,
      kind: isTournamentRegistration ? "tournament" : "announcement",
      title: item.title,
      body: item.body,
      meta: isTournamentRegistration
        ? `Registration alert • ${formatAnnouncementDate(item.createdAt)}`
        : `Team notification • ${formatAnnouncementDate(item.createdAt)}`,
      isUnread: isUnread(item.createdAt, args.lastSeenAt),
      actionLabel: isTournamentRegistration ? "Review Tournament" : "View Alert",
      route: isTournamentRegistration ? "/tournaments" : "/notifications",
      relatedContext: item.type === "tournament_registration" ? "Registration update" : undefined,
      params:
        isTournamentRegistration && item.tournamentId
          ? {
              tournamentId: item.tournamentId,
            }
          : undefined,
      relatedWrestlerName: item.wrestlerId
        ? args.wrestlerNameById?.[item.wrestlerId]
        : undefined,
    };
  });
}

function createAttendanceCards(args: {
  rows: PracticeAttendanceRecord[];
  lastSeenAt?: string;
  role?: "coach" | "athlete" | "parent";
}): NotificationCard[] {
  return args.rows
    .filter((row) => (args.role === "coach" ? true : row.status !== "not_checked_in"))
    .sort((a, b) => dateTimeMs(b.updatedAt || b.checkedInAt || b.createdAt) - dateTimeMs(a.updatedAt || a.checkedInAt || a.createdAt))
    .slice(0, 8)
    .map((row) => ({
      id: `attendance-${row.id}`,
      rawCreatedAt: row.updatedAt || row.checkedInAt || row.createdAt,
      kind: "attendance" as const,
      title:
        args.role === "coach"
          ? `${row.wrestlerName} marked ${formatAttendanceStatus(row.status).toLowerCase()}`
          : row.status === "present"
            ? "Check-in confirmed"
            : `Attendance update: ${formatAttendanceStatus(row.status)}`,
      body:
        args.role === "coach"
          ? `${row.wrestlerName} was marked ${formatAttendanceStatus(row.status).toLowerCase()} for ${formatPracticeDate(row.date)} practice.`
          : row.status === "present"
            ? `${row.wrestlerName} is checked in for ${formatPracticeDate(row.date)} practice.`
            : `${row.wrestlerName} is marked ${formatAttendanceStatus(row.status).toLowerCase()} for ${formatPracticeDate(row.date)} practice.`,
      meta: `Attendance • ${formatAnnouncementDate(row.updatedAt || row.checkedInAt || row.createdAt)}`,
      isUnread: isUnread(row.updatedAt || row.checkedInAt || row.createdAt, args.lastSeenAt),
      actionLabel: "Open Attendance",
      route: args.role === "parent" ? "/parent-attendance" : "/calendar",
      relatedWrestlerName: row.wrestlerName,
      relatedStatus: formatAttendanceStatus(row.status),
    }));
}

function createWrestlerNoteCards(args: {
  sessions: PracticeSession[];
  role: "athlete" | "parent";
  wrestlerIds: string[];
  lastSeenAt?: string;
}): NotificationCard[] {
  return args.sessions
    .flatMap((session) =>
      (session.wrestlerNotes || [])
        .filter(
          (note) =>
            args.wrestlerIds.includes(note.wrestlerId) &&
            (args.role === "athlete"
              ? note.visibility === "athlete_visible"
              : note.visibility === "parent_visible")
        )
        .map((note, index) => ({
          id: `note-${session.id}-${note.wrestlerId}-${index}`,
          rawCreatedAt: note.createdAt || session.completedAt || session.createdAt,
          kind: "note" as const,
          title: `Coach note for ${note.wrestlerName}`,
          body: note.note,
          meta: `Coach note • ${formatAnnouncementDate(note.createdAt || session.completedAt || session.createdAt)}`,
          isUnread: isUnread(note.createdAt || session.completedAt || session.createdAt, args.lastSeenAt),
          actionLabel: "Open Calendar",
          route: "/calendar",
          relatedWrestlerName: note.wrestlerName,
          relatedContext: session.practicePlanTitle || "Practice closeout",
        }))
    )
    .sort((a, b) => dateTimeMs(b.rawCreatedAt) - dateTimeMs(a.rawCreatedAt))
    .slice(0, 8);
}

function createCoachFollowUpCards(args: {
  followUps: Awaited<ReturnType<typeof listPracticeSessionFollowUps>>;
  lastSeenAt?: string;
}): NotificationCard[] {
  return args.followUps
    .filter((followUp) => followUp.status === "open")
    .sort((a, b) => {
      const dueA = a.dueDate || "9999-12-31";
      const dueB = b.dueDate || "9999-12-31";
      if (dueA !== dueB) {
        return dueA.localeCompare(dueB);
      }
      return dateTimeMs(b.createdAt) - dateTimeMs(a.createdAt);
    })
    .slice(0, 8)
    .map((followUp) => ({
      id: `followup-${followUp.sessionId}-${followUp.id}`,
      rawCreatedAt: followUp.createdAt || followUp.sessionCompletedAt,
      kind: "followup" as const,
      title: followUp.title,
      body: followUp.details || "Open coach follow-up from a recent practice closeout.",
      meta: followUp.dueDate
        ? `Follow-up due ${formatDateForDue(followUp.dueDate)}`
        : `Follow-up • ${formatAnnouncementDate(followUp.createdAt || followUp.sessionCompletedAt)}`,
      isUnread: isUnread(followUp.createdAt || followUp.sessionCompletedAt, args.lastSeenAt),
      actionLabel: "Open Follow-Up",
      route: "/follow-ups",
      relatedWrestlerName: followUp.wrestlerName,
      relatedContext: followUp.practicePlanTitle || "Practice closeout",
      relatedStatus: followUp.status,
    }));
}

function formatDateForDue(value?: string) {
  if (!value) return "soon";

  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function NotificationsScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading, refreshAppState } =
    useMobileAuthState();

  const {
    permissionStatus,
    expoPushToken,
    registered,
    error: notificationError,
    scheduleLocalTestNotification,
  } = useNotificationsState();

  const [announcements, setAnnouncements] = useState<TeamAnnouncement[]>([]);
  const [teamNotifications, setTeamNotifications] = useState<TeamNotification[]>([]);
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [entriesByTournament, setEntriesByTournament] = useState<Record<string, TournamentEntry[]>>({});
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<PracticeAttendanceRecord[]>([]);
  const [visibleSessions, setVisibleSessions] = useState<PracticeSession[]>([]);
  const [coachFollowUps, setCoachFollowUps] = useState<Awaited<ReturnType<typeof listPracticeSessionFollowUps>>>([]);
  const [loading, setLoading] = useState(true);
  const [markingSeen, setMarkingSeen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [selectedNotification, setSelectedNotification] = useState<NotificationCard | null>(null);
  const [lastSeenAt, setLastSeenAt] = useState(appUser?.lastSeenNotificationsAt || "");

  const isCoach = appUser?.role === "coach";

  useEffect(() => {
    setLastSeenAt(appUser?.lastSeenNotificationsAt || "");
  }, [appUser?.lastSeenNotificationsAt]);

  async function refresh() {
    if (!currentTeam?.id) {
      setAnnouncements([]);
      setTeamNotifications([]);
      setEvents([]);
      setTournaments([]);
      setEntriesByTournament({});
      setWrestlers([]);
      setAttendanceRows([]);
      setVisibleSessions([]);
      setCoachFollowUps([]);
      return;
    }

    const isParent = appUser?.role === "parent";
    const linkedWrestlerIds = appUser?.linkedWrestlerIds || [];

    const [announcementRows, notificationRows, tournamentRows, wrestlerRows] =
      await Promise.all([
        listTeamAnnouncements(db, currentTeam.id),
        listTeamNotifications(db, currentTeam.id, appUser?.role),
        listTournaments(db, currentTeam.id),
        isParent ? listWrestlersByIds(db, linkedWrestlerIds) : listWrestlers(db, currentTeam.id),
      ]);

    const athleteOwnedWrestler =
      appUser?.role === "athlete" && firebaseUser
        ? wrestlerRows.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) || null
        : null;
    const visibleWrestlerIds =
      appUser?.role === "athlete"
        ? athleteOwnedWrestler
          ? [athleteOwnedWrestler.id]
          : []
        : isParent
          ? linkedWrestlerIds
          : wrestlerRows.map((wrestler) => wrestler.id);

    const eventRows =
      appUser?.role === "athlete"
        ? athleteOwnedWrestler
          ? await listCalendarEvents(db, currentTeam.id, athleteOwnedWrestler)
          : []
        : isParent
          ? Array.from(
              new Map(
                (
                  await Promise.all(
                    wrestlerRows.map((wrestler) =>
                      listCalendarEvents(db, currentTeam.id, wrestler)
                    )
                  )
                )
                  .flat()
                  .map((event) => [event.id, event] as const)
              ).values()
            )
        : await listCalendarEvents(db, currentTeam.id);

    setAnnouncements(announcementRows);
    setEvents(eventRows);
    setTournaments(tournamentRows);
    setWrestlers(wrestlerRows);

    const entryRows = await Promise.all(
      tournamentRows.map(
        async (tournament) =>
          [
            tournament.id,
            (
              await Promise.all(
                ((appUser?.role === "coach" ? [undefined] : visibleWrestlerIds.length ? visibleWrestlerIds : [undefined]) as Array<string | undefined>).map((wrestlerId) =>
                  listTournamentEntries(db, {
                    teamId: currentTeam.id,
                    tournamentId: tournament.id,
                    wrestlerId,
                  } as any).catch(() => [])
                )
              )
            ).flat(),
          ] as const
      )
    );

    setEntriesByTournament(Object.fromEntries(entryRows));

    const filteredNotificationRows = notificationRows.filter((item) => {
      if (appUser?.role === "coach") {
        return true;
      }

      if (!item.wrestlerId) {
        return true;
      }

      return visibleWrestlerIds.includes(item.wrestlerId);
    });

    setTeamNotifications(filteredNotificationRows);

    if (appUser?.role === "coach") {
      const [followUpRows, attendanceRows] = await Promise.all([
        listPracticeSessionFollowUps(db, currentTeam.id),
        listPracticeAttendanceForWrestlers(db, currentTeam.id, wrestlerRows.map((wrestler) => wrestler.id)),
      ]);
      setCoachFollowUps(followUpRows);
      setAttendanceRows(attendanceRows);
      setVisibleSessions([]);
      return;
    }

    if (!visibleWrestlerIds.length) {
      setAttendanceRows([]);
      setVisibleSessions([]);
      setCoachFollowUps([]);
      return;
    }

    const [attendanceForVisibleWrestlers, sessionsForVisibleWrestlers] = await Promise.all([
      listPracticeAttendanceForWrestlers(db, currentTeam.id, visibleWrestlerIds),
      Promise.all(
        visibleWrestlerIds.map((wrestlerId) =>
          listPracticeSessionsForWrestler(db, currentTeam.id, wrestlerId)
        )
      ).then((batches) =>
        Array.from(
          new Map(
            batches
              .flat()
              .map((session) => [session.id, session] as const)
          ).values()
        )
      ),
    ]);

    setAttendanceRows(attendanceForVisibleWrestlers);
    setVisibleSessions(sessionsForVisibleWrestlers);
    setCoachFollowUps([]);
  }

  useEffect(() => {
    async function load() {
      if (!firebaseUser || !appUser) {
        setLoading(false);
        return;
      }

      try {
        await refresh();
      } catch (error) {
        console.error("Failed to load notifications:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [appUser, currentTeam?.id, firebaseUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const athleteOwnedWrestler = useMemo(
    () =>
      appUser?.role === "athlete" && firebaseUser
        ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) || null
        : null,
    [appUser?.role, firebaseUser, wrestlers]
  );
  const wrestlerNameById = useMemo(
    () =>
      wrestlers.reduce<Record<string, string>>((map, wrestler) => {
        map[wrestler.id] = `${wrestler.firstName} ${wrestler.lastName}`.trim();
        return map;
      }, {}),
    [wrestlers]
  );
  const visibleWrestlerIds = useMemo(() => {
    if (appUser?.role === "athlete") {
      return athleteOwnedWrestler ? [athleteOwnedWrestler.id] : [];
    }

    if (appUser?.role === "parent") {
      return appUser.linkedWrestlerIds || [];
    }

    return wrestlers.map((wrestler) => wrestler.id);
  }, [appUser?.linkedWrestlerIds, appUser?.role, athleteOwnedWrestler, wrestlers]);

  const notificationCards = useMemo(() => {
    const cards = [
      ...createAnnouncementCards({
        items: announcements,
        lastSeenAt,
      }),
      ...createTeamNotificationCards({
        items: teamNotifications,
        lastSeenAt,
        wrestlerNameById,
      }),
      ...createPracticeCards({
        events,
        lastSeenAt,
        role: appUser?.role,
      }),
      ...createTournamentCards({
        tournaments,
        entriesByTournament,
        appRole: appUser?.role === "coach" ? "coach" : appUser?.role === "parent" ? "parent" : "athlete",
        visibleWrestlerIds,
        lastSeenAt,
      }),
      ...createAttendanceCards({
        rows: attendanceRows,
        lastSeenAt,
        role: appUser?.role,
      }),
      ...(appUser?.role === "coach"
        ? createCoachFollowUpCards({
            followUps: coachFollowUps,
            lastSeenAt,
          })
        : createWrestlerNoteCards({
            sessions: visibleSessions,
            role: appUser?.role === "parent" ? "parent" : "athlete",
            wrestlerIds: visibleWrestlerIds,
            lastSeenAt,
          })),
    ];

    return cards
      .sort((a, b) => {
        if (a.isUnread !== b.isUnread) return a.isUnread ? -1 : 1;

        const bMs = dateTimeMs(b.rawCreatedAt);
        const aMs = dateTimeMs(a.rawCreatedAt);

        if (bMs !== aMs) return bMs - aMs;

        return a.title.localeCompare(b.title);
      })
      .slice(0, 24);
  }, [
    announcements,
    appUser?.role,
    attendanceRows,
    coachFollowUps,
    entriesByTournament,
    events,
    lastSeenAt,
    teamNotifications,
    teamNotifications,
    tournaments,
    visibleSessions,
    visibleWrestlerIds,
    wrestlerNameById,
  ]);

  const unreadCount = notificationCards.filter((card) => card.isUnread).length;

  async function sendAnnouncement() {
    if (!firebaseUser || !currentTeam?.id || !isCoach) {
      return;
    }

    if (!title.trim() || !body.trim()) {
      Alert.alert("Announcement incomplete", "Add both a title and message before sending.");
      return;
    }

    try {
      setSaving(true);

      await createTeamAnnouncement(db, {
        teamId: currentTeam.id,
        title: title.trim(),
        body: body.trim(),
        createdBy: firebaseUser.uid,
      });

      try {
        await sendTeamPushDelivery(db, {
          teamId: currentTeam.id,
          title: title.trim(),
          body: body.trim(),
          excludeUserIds: [firebaseUser.uid],
          preferenceKey: "announcements",
        });
      } catch (pushError) {
        console.error("Failed to send announcement push:", pushError);
      }

      setTitle("");
      setBody("");

      await refresh();
      Alert.alert("Announcement sent", "Your team notification is now posted.");
    } catch (error) {
      console.error("Failed to send team announcement:", error);
      Alert.alert("Send failed", "There was a problem posting your announcement.");
    } finally {
      setSaving(false);
    }
  }

  async function markAllSeen() {
    if (!firebaseUser?.uid) return;

    try {
      setMarkingSeen(true);
      const seenAt = new Date().toISOString();

      await updateDoc(doc(db, COLLECTIONS.USERS, firebaseUser.uid), {
        lastSeenNotificationsAt: seenAt,
        updatedAt: seenAt,
      });

      setLastSeenAt(seenAt);
      setSelectedNotification((prev) =>
        prev ? { ...prev, isUnread: false } : prev
      );

      try {
        await refreshAppState();
      } catch (refreshError) {
        console.warn("Marked alerts read, but app state refresh failed:", refreshError);
      }

      Alert.alert("Alerts updated", "Alerts are marked as read.");
    } catch (error) {
      console.error("Failed to mark notifications seen:", error);
      Alert.alert("Update failed", "Could not mark alerts as read.");
    } finally {
      setMarkingSeen(false);
    }
  }

  async function markSingleRead(card?: NotificationCard | null) {
    if (!firebaseUser?.uid || !card?.isUnread) {
      return;
    }

    try {
      setMarkingSeen(true);
      const seenAt = new Date().toISOString();

      await updateDoc(doc(db, COLLECTIONS.USERS, firebaseUser.uid), {
        lastSeenNotificationsAt: seenAt,
        updatedAt: seenAt,
      });

      setLastSeenAt(seenAt);

      try {
        await refreshAppState();
      } catch (refreshError) {
        console.warn("Marked alert read, but app state refresh failed:", refreshError);
      }

      setSelectedNotification((prev) =>
        prev?.id === card.id ? { ...prev, isUnread: false } : prev
      );
    } catch (error) {
      console.error("Failed to mark notification read:", error);
      Alert.alert("Update failed", "Could not mark this alert as read.");
    } finally {
      setMarkingSeen(false);
    }
  }

  function openRelatedCard(card: NotificationCard) {
    if (card.params) {
      router.push({
        pathname: card.route,
        params: card.params,
      } as any);
      return;
    }

    router.push(card.route as any);
  }

  if (!authLoading && (!firebaseUser || !appUser)) {
    return (
      <MobileScreenShell
        title="Alerts"
        subtitle="Sign in to review team notifications and announcements."
      >
        <View
          style={{
            borderRadius: 24,
            padding: 18,
            borderWidth: 1,
            borderColor: "#21486e",
            backgroundColor: "#0b2542",
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 24, fontWeight: "900", color: "#ffffff" }}>
            Sign in required
          </Text>

          <Text style={{ fontSize: 15, color: "#b7c9df", lineHeight: 22 }}>
            Sign in on mobile to review team notifications and announcements.
          </Text>

          <Pressable
            onPress={() => router.push("/")}
            style={{
              alignSelf: "flex-start",
              paddingHorizontal: 16,
              paddingVertical: 11,
              borderRadius: 999,
              backgroundColor: "#bf1029",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>Go Home</Text>
          </Pressable>
        </View>
      </MobileScreenShell>
    );
  }

  return (
    <MobileScreenShell
      title="Alerts"
      subtitle={
        isCoach
          ? "Post team announcements and review practice, tournament, and registration updates."
          : "Review coach announcements plus your practice and tournament reminders in one place."
      }
    >
      <View
        style={{
          borderWidth: 1,
          borderColor: unreadCount > 0 ? "#bf1029" : "#21486e",
          borderRadius: 24,
          padding: 16,
          backgroundColor: unreadCount > 0 ? "#431407" : "#0b2542",
          gap: 10,
          marginBottom: 18,
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: "900", color: "#ffffff" }}>
          Alert Inbox
        </Text>

        <Text style={{ fontSize: 15, color: "#dbeafe", lineHeight: 22 }}>
          {unreadCount > 0
            ? `${unreadCount} alert${unreadCount === 1 ? "" : "s"} need review. Tap a card to open the right workflow.`
            : "No unread alerts. New registration, tournament, and practice updates will appear here."}
        </Text>

        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          <Pressable
            onPress={() => {
              setLoading(true);
              refresh().finally(() => setLoading(false));
            }}
            style={{
              alignSelf: "flex-start",
              paddingHorizontal: 16,
              paddingVertical: 11,
              borderRadius: 999,
              backgroundColor: "#ffffff",
            }}
          >
            <Text style={{ color: "#061a33", fontWeight: "900" }}>
              {loading ? "Refreshing..." : "Refresh"}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              markAllSeen().catch((error) => {
                console.error("Failed to mark alerts seen:", error);
                Alert.alert("Update failed", "Could not mark alerts as read.");
              });
            }}
            disabled={markingSeen}
            style={{
              alignSelf: "flex-start",
              paddingHorizontal: 16,
              paddingVertical: 11,
              borderRadius: 999,
              backgroundColor: "#bf1029",
              opacity: markingSeen ? 0.5 : 1,
            }}
          >
            <Text style={{ color: "#ffffff", fontWeight: "900" }}>
              {markingSeen ? "Updating..." : "Mark All Read"}
            </Text>
          </Pressable>
        </View>
      </View>

      <View
        style={{
          borderWidth: 1,
          borderColor: "#21486e",
          borderRadius: 24,
          padding: 16,
          backgroundColor: "#0b2542",
          gap: 10,
          marginBottom: 18,
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: "900", color: "#ffffff" }}>
          Push Status
        </Text>

        <StatusLine label="Permission" value={permissionStatus} />
        <StatusLine
          label="Registration"
          value={registered ? "Saved to WrestleWell" : "Not registered yet"}
        />
        <StatusLine
          label="Expo token"
          value={expoPushToken ? `${expoPushToken.slice(0, 20)}...` : "Not available yet"}
        />

        {notificationError ? (
          <Text style={{ fontSize: 14, color: "#fecaca", lineHeight: 21 }}>
            {notificationError}
          </Text>
        ) : (
          <Text style={{ fontSize: 14, color: "#b7c9df", lineHeight: 21 }}>
            Local test reminders work now. Remote push delivery uses the saved device registration.
          </Text>
        )}

        <Pressable
          onPress={() =>
            scheduleLocalTestNotification({
              title: "WrestleWell test reminder",
              body: "Push setup is active on this device.",
            }).catch((nextError) => {
              console.error("Failed to schedule local test notification:", nextError);
              Alert.alert("Test failed", "There was a problem scheduling the local test reminder.");
            })
          }
          style={{
            alignSelf: "flex-start",
            paddingHorizontal: 16,
            paddingVertical: 11,
            borderRadius: 999,
            backgroundColor: "#bf1029",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>Send Test Reminder</Text>
        </Pressable>
      </View>

      {isCoach ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#21486e",
            borderRadius: 24,
            padding: 16,
            backgroundColor: "#0b2542",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: "900", color: "#ffffff" }}>
            Send Team Announcement
          </Text>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Practice update"
            placeholderTextColor="#7c8da3"
            style={{
              minHeight: 48,
              borderWidth: 1,
              borderColor: "#315c86",
              borderRadius: 16,
              paddingHorizontal: 13,
              backgroundColor: "#102f52",
              color: "#ffffff",
            }}
          />

          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Let the team know what changed..."
            placeholderTextColor="#7c8da3"
            multiline
            textAlignVertical="top"
            style={{
              minHeight: 104,
              borderWidth: 1,
              borderColor: "#315c86",
              borderRadius: 16,
              paddingHorizontal: 13,
              paddingVertical: 12,
              backgroundColor: "#102f52",
              color: "#ffffff",
            }}
          />

          <Pressable
            onPress={sendAnnouncement}
            style={{
              minHeight: 50,
              borderRadius: 18,
              backgroundColor: "#bf1029",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>
              {saving ? "Sending..." : "Send Announcement"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <Text style={{ color: "#b7c9df", marginBottom: 16 }}>Loading notifications...</Text>
      ) : null}

      {!loading && notificationCards.length === 0 ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#21486e",
            borderRadius: 20,
            padding: 18,
            backgroundColor: "#0b2542",
          }}
        >
          <Text style={{ fontSize: 16, lineHeight: 22, color: "#b7c9df" }}>
            {getRoleEmptyState(appUser?.role)}
          </Text>
        </View>
      ) : null}

      <View style={{ gap: 14 }}>
        {notificationCards.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => setSelectedNotification(item)}
            style={({ pressed }) => ({
              borderWidth: 1,
              borderColor: item.isUnread ? "#bf1029" : pressed ? "#ffffff" : "#21486e",
              borderRadius: 24,
              padding: 18,
              backgroundColor: item.isUnread ? "#431407" : pressed ? "#173b67" : "#0b2542",
            })}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "900",
                    color: item.isUnread ? "#fecaca" : "#93c5fd",
                    marginBottom: 8,
                  }}
                >
                  {item.isUnread ? "NEW • " : ""}
                  {item.meta}
                </Text>

                <View
                  style={{
                    alignSelf: "flex-start",
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 999,
                    backgroundColor:
                      item.kind === "tournament"
                        ? "#431407"
                        : item.kind === "practice"
                          ? "#102f52"
                          : "#3b0a16",
                    borderWidth: 1,
                    borderColor:
                      item.kind === "tournament"
                        ? "#9a3412"
                        : item.kind === "practice"
                          ? "#315c86"
                          : "#7f1d1d",
                    marginBottom: 10,
                  }}
                >
                  <Text
                    style={{
                      color:
                        item.kind === "tournament"
                          ? "#fed7aa"
                          : item.kind === "practice"
                            ? "#dbeafe"
                            : "#fecaca",
                      fontSize: 12,
                      fontWeight: "900",
                    }}
                  >
                    {item.kind.toUpperCase()}
                  </Text>
                </View>

                <Text style={{ fontSize: 20, fontWeight: "900", color: "#ffffff" }}>
                  {item.title}
                </Text>

                <Text style={{ fontSize: 15, color: "#dbeafe", marginTop: 8, lineHeight: 22 }}>
                  {item.body}
                </Text>

                {item.relatedWrestlerName || item.relatedContext || item.relatedStatus ? (
                  <View style={{ gap: 4, marginTop: 10 }}>
                    {item.relatedWrestlerName ? (
                      <Text style={{ color: "#b7c9df", fontSize: 13 }}>
                        Wrestler: {item.relatedWrestlerName}
                      </Text>
                    ) : null}
                    {item.relatedContext ? (
                      <Text style={{ color: "#b7c9df", fontSize: 13 }}>
                        Context: {item.relatedContext}
                      </Text>
                    ) : null}
                    {item.relatedStatus ? (
                      <Text style={{ color: "#93c5fd", fontSize: 13, fontWeight: "800" }}>
                        Status: {item.relatedStatus}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                <Text style={{ color: "#93c5fd", fontSize: 14, fontWeight: "900", marginTop: 12 }}>
                  View detail →
                </Text>
              </View>

              {item.isUnread ? (
                <View
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    backgroundColor: "#bf1029",
                    borderWidth: 1,
                    borderColor: "#fecaca",
                    marginTop: 4,
                  }}
                />
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>

      <Modal visible={Boolean(selectedNotification)} transparent animationType="slide">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(2, 6, 23, 0.84)",
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: "#0b2542",
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              padding: 20,
              gap: 14,
              borderWidth: 1,
              borderColor: "#21486e",
            }}
          >
            {selectedNotification ? (
              <>
                <Text style={{ color: "#93c5fd", fontWeight: "900", fontSize: 13 }}>
                  {selectedNotification.meta}
                </Text>
                <Text style={{ color: "#ffffff", fontSize: 24, fontWeight: "900" }}>
                  {selectedNotification.title}
                </Text>
                <Text style={{ color: "#dbeafe", lineHeight: 23, fontSize: 15 }}>
                  {selectedNotification.body}
                </Text>

                {selectedNotification.relatedWrestlerName ? (
                  <Text style={{ color: "#b7c9df", fontSize: 14 }}>
                    Wrestler: {selectedNotification.relatedWrestlerName}
                  </Text>
                ) : null}
                {selectedNotification.relatedContext ? (
                  <Text style={{ color: "#b7c9df", fontSize: 14 }}>
                    Related item: {selectedNotification.relatedContext}
                  </Text>
                ) : null}
                {selectedNotification.relatedStatus ? (
                  <Text style={{ color: "#93c5fd", fontSize: 14, fontWeight: "800" }}>
                    Status: {selectedNotification.relatedStatus}
                  </Text>
                ) : null}

                <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                  {selectedNotification.route !== "/notifications" ? (
                    <Pressable
                      onPress={() => {
                        if (!selectedNotification) return;
                        openRelatedCard(selectedNotification);
                      }}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        borderRadius: 18,
                        backgroundColor: "#bf1029",
                      }}
                    >
                      <Text style={{ color: "#ffffff", fontWeight: "900" }}>
                        {selectedNotification.actionLabel}
                      </Text>
                    </Pressable>
                  ) : null}

                  <Pressable
                    onPress={() => {
                      markSingleRead(selectedNotification).catch((error) => {
                        console.error("Failed to mark alert read:", error);
                        Alert.alert("Update failed", "Could not mark this alert as read.");
                      });
                    }}
                    disabled={!selectedNotification.isUnread || markingSeen}
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      borderRadius: 18,
                      backgroundColor: "#102f52",
                      borderWidth: 1,
                      borderColor: "#315c86",
                      opacity: !selectedNotification.isUnread || markingSeen ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ color: "#ffffff", fontWeight: "900" }}>
                      {markingSeen ? "Saving..." : "Mark Read"}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setSelectedNotification(null)}
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      borderRadius: 18,
                      backgroundColor: "#102f52",
                      borderWidth: 1,
                      borderColor: "#315c86",
                    }}
                  >
                    <Text style={{ color: "#ffffff", fontWeight: "900" }}>Close</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </MobileScreenShell>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 12,
        paddingVertical: 3,
      }}
    >
      <Text style={{ fontSize: 15, color: "#b7c9df", fontWeight: "700" }}>
        {label}
      </Text>

      <Text
        style={{
          fontSize: 15,
          color: "#ffffff",
          fontWeight: "900",
          flexShrink: 1,
          textAlign: "right",
        }}
      >
        {value}
      </Text>
    </View>
  );
}
