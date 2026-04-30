import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { signOut } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "@wrestlewell/firebase/client";
import {
  listCalendarEvents,
  listTeamAnnouncements,
  listTeamNotifications,
  listTournamentEntries,
  listTournaments,
  listWrestlers,
  type CalendarEventRecord,
} from "@wrestlewell/lib/index";
import type {
  TeamAnnouncement,
  TeamNotification,
  Tournament,
  TournamentEntry,
  WrestlerProfile,
} from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import {
  MobileScreenShell,
  WWBadge,
  WWCard,
  WWStat,
} from "../components/mobile-screen-shell";
import { TeamInviteCard } from "../components/team-invite-card";

type DashboardTournamentEntry = TournamentEntry & {
  tournamentName?: string;
  tournamentDate?: string;
};

type DashboardAction = {
  label: string;
  href: string;
  params?: Record<string, string>;
};

type PracticeSessionRecord = {
  id: string;
  teamId: string;
  practicePlanId: string;
  practicePlanTitle: string;
  practicePlanStyle?: string;
  totalSeconds?: number;
  blockCount?: number;
  notes?: string;
  completedBy?: string;
  completedByRole?: string;
  completedAt?: unknown;
  createdAt?: unknown;
};

const coachActionCards = [
  {
    title: "Run Practice",
    subtitle: "Open plans and start the live room timer.",
    href: "/practice-plans",
    tone: "blue",
    stat: "Timer",
  },
  {
    title: "Match-Day",
    subtitle: "Open tournament roster, queue matches, and use mat-side summaries.",
    href: "/match-day",
    tone: "red",
    stat: "Live",
  },
  {
    title: "Roster",
    subtitle: "Review wrestlers, learning styles, records, and profiles.",
    href: "/wrestlers",
    tone: "orange",
    stat: "Team",
  },
  {
    title: "Calendar",
    subtitle: "See upcoming practices and assigned plans.",
    href: "/calendar",
    tone: "green",
    stat: "Next",
  },
  {
    title: "Tournaments",
    subtitle: "Manage registrations, travel notes, and event status.",
    href: "/tournaments",
    tone: "blue",
    stat: "Events",
  },
  {
    title: "Alerts",
    subtitle: "Send team announcements and review reminders.",
    href: "/notifications",
    tone: "red",
    stat: "Notify",
  },
];

const athleteActionCards = [
  {
    title: "My Practice",
    subtitle: "Open assigned plans and review the session flow.",
    href: "/practice-plans",
    tone: "blue",
    stat: "Plan",
  },
  {
    title: "My Match-Day",
    subtitle: "See tournament prep and mat-side reminders.",
    href: "/match-day",
    tone: "red",
    stat: "Ready",
  },
  {
    title: "My Profile",
    subtitle: "Update weight, styles, goals, strengths, and warm-up routine.",
    href: "/wrestlers",
    tone: "orange",
    stat: "Me",
  },
  {
    title: "Calendar",
    subtitle: "See practices, tournaments, and team schedule.",
    href: "/calendar",
    tone: "green",
    stat: "Today",
  },
  {
    title: "Tournaments",
    subtitle: "Register interest and track event status.",
    href: "/tournaments",
    tone: "blue",
    stat: "Events",
  },
  {
    title: "Alerts",
    subtitle: "Read team announcements and reminders.",
    href: "/notifications",
    tone: "red",
    stat: "Inbox",
  },
];

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

function toDateMs(value: unknown) {
  const normalized = normalizeDateValue(value);
  if (!normalized) return 0;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return 0;

  return date.getTime();
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

function formatEventDate(value?: string) {
  if (!value) return "Date not set";

  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

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

function getPracticeEventSeconds(event?: CalendarEventRecord | null) {
  if (!event) return 0;
  return Math.max(0, event.totalSeconds || (event.totalMinutes || 0) * 60);
}

function getFullName(wrestler?: WrestlerProfile | null) {
  return [wrestler?.firstName, wrestler?.lastName].filter(Boolean).join(" ").trim();
}

function getTournamentDateSortValue(tournament: Tournament) {
  return tournament.eventDate || "9999-12-31";
}

function isNotificationUnread(notification: TeamNotification, lastSeenAt?: string) {
  if (!lastSeenAt) return true;

  const notificationMs = toDateMs(notification.createdAt);
  const seenMs = new Date(lastSeenAt).getTime();

  if (!notificationMs) return true;
  if (Number.isNaN(seenMs)) return true;

  return notificationMs > seenMs;
}

async function listRecentPracticeSessions(teamId: string) {
  const snapshot = await getDocs(
    query(collection(db, "practice_sessions"), where("teamId", "==", teamId))
  );

  return snapshot.docs
    .map((sessionDoc) => ({
      id: sessionDoc.id,
      ...(sessionDoc.data() as Omit<PracticeSessionRecord, "id">),
    }))
    .sort((a, b) => toDateMs(b.completedAt || b.createdAt) - toDateMs(a.completedAt || a.createdAt))
    .slice(0, 5);
}

function formatPracticeSessionDate(value: unknown) {
  const ms = toDateMs(value);

  if (!ms) return "Recently";

  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function IndexScreen() {
  const { firebaseUser, appUser, currentTeam, refreshAppState } = useMobileAuthState();

  const [roster, setRoster] = useState<WrestlerProfile[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventRecord[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [announcements, setAnnouncements] = useState<TeamAnnouncement[]>([]);
  const [teamNotifications, setTeamNotifications] = useState<TeamNotification[]>([]);
  const [allTournamentEntries, setAllTournamentEntries] = useState<DashboardTournamentEntry[]>([]);
  const [recentPracticeSessions, setRecentPracticeSessions] = useState<PracticeSessionRecord[]>([]);
  const [pendingRegistrations, setPendingRegistrations] = useState(0);
  const [confirmedTournamentEntries, setConfirmedTournamentEntries] = useState(0);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const teamName =
    currentTeam?.name ||
    currentTeam?.teamName ||
    currentTeam?.displayName ||
    "Your Team";

  const signedIn = Boolean(firebaseUser && appUser);
  const isCoach = appUser?.role === "coach";

  const todayKey = useMemo(() => new Date().toISOString().split("T")[0], []);

  const upcomingPractices = useMemo(
    () =>
      calendarEvents
        .filter((event) => event.date >= todayKey)
        .sort((a, b) => {
          const dateCompare = a.date.localeCompare(b.date);
          if (dateCompare !== 0) return dateCompare;

          return (a.startTime || "").localeCompare(b.startTime || "");
        })
        .slice(0, 3),
    [calendarEvents, todayKey]
  );

  const nextPractice = upcomingPractices[0] || null;

  const upcomingTournaments = useMemo(
    () =>
      tournaments
        .filter((tournament) => {
          if (!tournament.eventDate) return true;
          return tournament.eventDate >= todayKey;
        })
        .sort((a, b) => getTournamentDateSortValue(a).localeCompare(getTournamentDateSortValue(b))),
    [tournaments, todayKey]
  );

  const nextTournament = upcomingTournaments[0] || null;

  const unreadOrActionableNotifications = useMemo(() => {
    return teamNotifications.filter((notification) =>
      isNotificationUnread(notification, appUser?.lastSeenNotificationsAt)
    );
  }, [appUser?.lastSeenNotificationsAt, teamNotifications]);

  const latestAlert = useMemo(() => {
    const cards = [
      ...announcements.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        createdAt: item.createdAt,
        kind: "announcement" as const,
      })),
      ...teamNotifications.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        createdAt: item.createdAt,
        kind: "notification" as const,
      })),
    ];

    return cards
      .filter((item) => item.createdAt)
      .sort((a, b) => toDateMs(b.createdAt) - toDateMs(a.createdAt))[0];
  }, [announcements, teamNotifications]);

  const ownWrestler = useMemo(
    () =>
      appUser?.role === "athlete" && firebaseUser
        ? roster.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) || null
        : null,
    [appUser?.role, firebaseUser, roster]
  );

  const myTournamentEntries = useMemo(() => {
    if (!ownWrestler) return [];
    return allTournamentEntries.filter((entry) => entry.wrestlerId === ownWrestler.id);
  }, [allTournamentEntries, ownWrestler]);

  const myNextTournamentEntry = useMemo(() => {
    if (!myTournamentEntries.length) return null;

    return myTournamentEntries
      .slice()
      .sort((a, b) => (a.tournamentDate || "9999-12-31").localeCompare(b.tournamentDate || "9999-12-31"))[0];
  }, [myTournamentEntries]);

  const primaryAction = useMemo<DashboardAction>(() => {
    if (!signedIn) {
      return {
        label: "Log In",
        href: "/sign-in",
      };
    }

    if (appUser?.role === "athlete" && appUser.varkCompleted !== true) {
      return {
        label: "Start WrestleWellIQ",
        href: "/vark-questionnaire",
      };
    }

    if (nextPractice?.practicePlanId) {
      return {
        label: isCoach ? "Run Practice Timer" : "Open My Practice",
        href: "/practice-plans",
        params: { planId: nextPractice.practicePlanId },
      };
    }

    if (nextTournament) {
      return {
        label: "Open Match-Day",
        href: "/match-day",
        params: { tournamentId: nextTournament.id },
      };
    }

    return {
      label: isCoach ? "Open Team Roster" : "Open My Profile",
      href: "/wrestlers",
    };
  }, [appUser?.role, appUser?.varkCompleted, isCoach, nextPractice, nextTournament, signedIn]);

  const actionCards = isCoach ? coachActionCards : athleteActionCards;

  useEffect(() => {
    if (!firebaseUser || !appUser) return;

    if (appUser.role === "athlete" && appUser.varkCompleted !== true) {
      router.replace("/vark-questionnaire");
    }
  }, [firebaseUser?.uid, appUser?.role, appUser?.varkCompleted]);

  async function handleSignOut() {
    try {
      await signOut(auth);
      await refreshAppState();
      router.replace("/");
    } catch (error: any) {
      Alert.alert("Sign out failed", error?.message ?? "Could not sign out.");
    }
  }

  async function refreshDashboard() {
    if (!currentTeam?.id || !firebaseUser || !appUser) {
      setRoster([]);
      setCalendarEvents([]);
      setTournaments([]);
      setAnnouncements([]);
      setTeamNotifications([]);
      setAllTournamentEntries([]);
      setRecentPracticeSessions([]);
      setPendingRegistrations(0);
      setConfirmedTournamentEntries(0);
      return;
    }

    if (appUser.role === "athlete" && appUser.varkCompleted !== true) {
      return;
    }

    try {
      setDashboardLoading(true);

      const wrestlerRows = await listWrestlers(db, currentTeam.id);
      const dashboardOwnWrestler =
        appUser.role === "athlete" && firebaseUser
          ? wrestlerRows.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) || null
          : null;

      const [
        eventRows,
        tournamentRows,
        announcementRows,
        notificationRows,
        practiceSessionRows,
      ] = await Promise.all([
        appUser.role === "athlete"
          ? dashboardOwnWrestler
            ? listCalendarEvents(db, currentTeam.id, dashboardOwnWrestler)
            : Promise.resolve([])
          : listCalendarEvents(db, currentTeam.id),
        listTournaments(db, currentTeam.id),
        listTeamAnnouncements(db, currentTeam.id),
        listTeamNotifications(db, currentTeam.id, appUser.role),
        listRecentPracticeSessions(currentTeam.id),
      ]);

      setRoster(wrestlerRows);
      setCalendarEvents(eventRows);
      setTournaments(tournamentRows);
      setAnnouncements(announcementRows);
      setTeamNotifications(notificationRows);
      setRecentPracticeSessions(practiceSessionRows);

      const entryBatches = await Promise.all(
        tournamentRows.map(async (tournament) => {
          const entries = await listTournamentEntries(db, {
            teamId: currentTeam.id,
            tournamentId: tournament.id,
          });

          return entries.map((entry) => ({
            ...entry,
            tournamentName: tournament.name,
            tournamentDate: tournament.eventDate,
          }));
        })
      );

      const flatEntries = entryBatches.flat();

      const submittedCount = flatEntries.filter((entry) => entry.status === "submitted").length;
      const confirmedCount = flatEntries.filter((entry) => entry.status === "confirmed").length;

      setAllTournamentEntries(flatEntries);
      setPendingRegistrations(submittedCount);
      setConfirmedTournamentEntries(confirmedCount);
    } catch (error) {
      console.error("Failed to load mobile dashboard:", error);
    } finally {
      setDashboardLoading(false);
    }
  }

  function navigateToAction(action: DashboardAction) {
    if (action.params) {
      router.push({
        pathname: action.href,
        params: action.params,
      } as any);
      return;
    }

    router.push(action.href as any);
  }

  useEffect(() => {
    refreshDashboard();
  }, [
    currentTeam?.id,
    firebaseUser?.uid,
    appUser?.role,
    appUser?.varkCompleted,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MobileScreenShell
      title="Team Command Center"
      subtitle={
        signedIn
          ? `Welcome back. You are working inside ${teamName}.`
          : "Plan practices, manage athletes, run mat-side summaries, and keep your team organized."
      }
      eyebrow={signedIn ? "WRESTLEWELL LIVE" : "WRESTLEWELL"}
    >
      <View style={{ gap: 14 }}>
        <WWCard
          style={{
            backgroundColor: "#ffffff",
            borderColor: "#ffffff",
          }}
        >
          <Text
            style={{
              color: "#061a33",
              fontSize: 13,
              fontWeight: "900",
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            TODAY’S ROOM
          </Text>

          <Text
            style={{
              color: "#061a33",
              fontSize: 28,
              fontWeight: "900",
              letterSpacing: -0.7,
            }}
          >
            {teamName}
          </Text>

          <Text
            style={{
              color: "#475569",
              fontSize: 15,
              lineHeight: 22,
              marginTop: 8,
            }}
          >
            {signedIn
              ? dashboardLoading
                ? "Updating your live team dashboard..."
                : "Your mat room dashboard is live. Jump into today’s work below."
              : "Jump into the tools coaches and athletes need during the week and on match day."}
          </Text>

          {signedIn && appUser?.role === "athlete" && appUser.varkCompleted !== true ? (
            <View
              style={{
                marginTop: 16,
                borderRadius: 18,
                padding: 14,
                backgroundColor: "#fef2f2",
                borderWidth: 1,
                borderColor: "#fecaca",
              }}
            >
              <Text style={{ color: "#7f1d1d", fontSize: 16, fontWeight: "900" }}>
                WrestleWellIQ setup needed
              </Text>

              <Text style={{ color: "#991b1b", fontSize: 14, lineHeight: 20, marginTop: 5 }}>
                Complete your learning style questionnaire before using the athlete dashboard.
              </Text>

              <Pressable
                onPress={() => router.replace("/vark-questionnaire")}
                style={{
                  marginTop: 12,
                  alignSelf: "flex-start",
                  borderRadius: 999,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  backgroundColor: "#bf1029",
                }}
              >
                <Text style={{ color: "#ffffff", fontWeight: "900" }}>
                  Start WrestleWellIQ
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View
            style={{
              flexDirection: "row",
              gap: 10,
              marginTop: 16,
              flexWrap: "wrap",
            }}
          >
            <MiniStat label="Mode" value={appUser?.role || "Guest"} />
            <MiniStat label="Roster" value={signedIn ? `${roster.length}` : "Preview"} />
            <MiniStat label="Mat-Side" value="Ready" />
          </View>

          <Pressable
            onPress={() => navigateToAction(primaryAction)}
            style={({ pressed }) => ({
              marginTop: 16,
              backgroundColor: pressed ? "#991b1b" : "#bf1029",
              borderRadius: 18,
              paddingVertical: 15,
              alignItems: "center",
            })}
          >
            <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "900" }}>
              {primaryAction.label}
            </Text>
          </Pressable>

          {signedIn ? (
            <Pressable
              onPress={handleSignOut}
              style={({ pressed }) => ({
                marginTop: 12,
                backgroundColor: pressed ? "#e2e8f0" : "#f1f5f9",
                borderRadius: 18,
                paddingVertical: 13,
                alignItems: "center",
                borderWidth: 1,
                borderColor: "#cbd5e1",
              })}
            >
              <Text style={{ color: "#061a33", fontSize: 15, fontWeight: "900" }}>
                Sign Out
              </Text>
            </Pressable>
          ) : null}
        </WWCard>

        {signedIn ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <WWStat label="Roster" value={`${roster.length}`} tone="orange" />
            <WWStat label="Practices" value={`${upcomingPractices.length}`} tone="green" />
            <WWStat label="Events" value={`${upcomingTournaments.length}`} tone="blue" />
            <WWStat label="Pending" value={`${pendingRegistrations}`} tone="red" />
          </View>
        ) : null}

        {signedIn ? (
          <WWCard>
            <View style={{ gap: 12 }}>
              <WWBadge label="LIVE COMMAND CENTER" tone="red" />

              <Text
                style={{
                  color: "#ffffff",
                  fontSize: 25,
                  fontWeight: "900",
                  letterSpacing: -0.5,
                }}
              >
                What should happen next?
              </Text>

              <View style={{ gap: 10 }}>
                <CommandRow
                  title={
                    nextPractice
                      ? nextPractice.practicePlanTitle || "Upcoming Practice"
                      : "No practice scheduled"
                  }
                  subtitle={
                    nextPractice
                      ? `${formatPracticeDate(nextPractice.date)} • ${
                          nextPractice.practicePlanStyle || "Mixed"
                        } • ${formatDurationLabel(getPracticeEventSeconds(nextPractice))}`
                      : isCoach
                        ? "Schedule a practice on the web app and it will appear here."
                        : "Your coach has not assigned an upcoming practice yet."
                  }
                  badge="Practice"
                  tone="green"
                  onPress={() =>
                    nextPractice?.practicePlanId
                      ? router.push({
                          pathname: "/practice-plans",
                          params: { planId: nextPractice.practicePlanId },
                        } as any)
                      : router.push("/calendar" as any)
                  }
                />

                <CommandRow
                  title={nextTournament ? nextTournament.name : "No tournament selected"}
                  subtitle={
                    nextTournament
                      ? `${formatEventDate(nextTournament.eventDate)} • ${confirmedTournamentEntries} confirmed • ${pendingRegistrations} pending`
                      : "Add or select a tournament to unlock match-day workflow."
                  }
                  badge="Match-Day"
                  tone="red"
                  onPress={() =>
                    nextTournament
                      ? router.push({
                          pathname: "/match-day",
                          params: { tournamentId: nextTournament.id },
                        } as any)
                      : router.push("/tournaments" as any)
                  }
                />

                <CommandRow
                  title={
                    unreadOrActionableNotifications.length > 0
                      ? `${unreadOrActionableNotifications.length} pending notification${
                          unreadOrActionableNotifications.length === 1 ? "" : "s"
                        }`
                      : "No pending notifications"
                  }
                  subtitle={
                    latestAlert
                      ? `${latestAlert.title}: ${latestAlert.body}`
                      : "Team alerts and reminders will show up here."
                  }
                  badge="Inbox"
                  tone="blue"
                  onPress={() => router.push("/notifications" as any)}
                />
              </View>
            </View>
          </WWCard>
        ) : null}

        {signedIn && appUser?.role === "athlete" ? (
          <WWCard>
            <View style={{ gap: 12 }}>
              <WWBadge label="MY STATUS" tone="orange" />

              <Text style={{ color: "#ffffff", fontSize: 24, fontWeight: "900" }}>
                Athlete snapshot
              </Text>

              <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22 }}>
                {ownWrestler
                  ? `${getFullName(ownWrestler)} • ${
                      ownWrestler.weightClass || "Weight not set"
                    } • ${ownWrestler.styles?.join(", ") || "Style not set"}`
                  : "Create your wrestler profile so coaches can use mat-side summaries and tournament tools."}
              </Text>

              {myNextTournamentEntry ? (
                <Pressable
                  onPress={() =>
                    myNextTournamentEntry.tournamentId
                      ? router.push({
                          pathname: "/match-day",
                          params: {
                            tournamentId: myNextTournamentEntry.tournamentId,
                            wrestlerId: myNextTournamentEntry.wrestlerId,
                          },
                        } as any)
                      : router.push("/match-day" as any)
                  }
                  style={({ pressed }) => ({
                    borderWidth: 1,
                    borderColor: "#315c86",
                    backgroundColor: pressed ? "#173b67" : "#102f52",
                    borderRadius: 18,
                    padding: 14,
                  })}
                >
                  <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "900" }}>
                    Next Tournament Entry
                  </Text>

                  <Text style={{ color: "#b7c9df", fontSize: 14, lineHeight: 20, marginTop: 5 }}>
                    {myNextTournamentEntry.tournamentName || "Tournament"} •{" "}
                    {formatEventDate(myNextTournamentEntry.tournamentDate)} •{" "}
                    {myNextTournamentEntry.status}
                  </Text>
                </Pressable>
              ) : null}

              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <Pressable
                  onPress={() => router.push("/wrestlers" as any)}
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? "#991b1b" : "#bf1029",
                    borderRadius: 18,
                    paddingHorizontal: 16,
                    paddingVertical: 13,
                  })}
                >
                  <Text style={{ color: "#ffffff", fontWeight: "900" }}>
                    Open My Profile
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    ownWrestler
                      ? router.push({
                          pathname: "/mat-side",
                          params: { wrestlerId: ownWrestler.id },
                        } as any)
                      : router.push("/wrestlers" as any)
                  }
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? "#12345a" : "#102f52",
                    borderRadius: 18,
                    paddingHorizontal: 16,
                    paddingVertical: 13,
                    borderWidth: 1,
                    borderColor: "#315c86",
                  })}
                >
                  <Text style={{ color: "#ffffff", fontWeight: "900" }}>
                    My Mat-Side
                  </Text>
                </Pressable>
              </View>
            </View>
          </WWCard>
        ) : null}

        {signedIn ? (
          <WWCard>
            <View style={{ gap: 12 }}>
              <WWBadge label="ACTION QUEUE" tone="red" />

              <Text
                style={{
                  color: "#ffffff",
                  fontSize: 24,
                  fontWeight: "900",
                }}
              >
                What needs attention
              </Text>

              <QueueItem
                title="Pending notifications"
                value={
                  unreadOrActionableNotifications.length > 0
                    ? `${unreadOrActionableNotifications.length} team notification${
                        unreadOrActionableNotifications.length === 1 ? "" : "s"
                      } need review.`
                    : "No pending notifications."
                }
                href="/notifications"
                badge={`${unreadOrActionableNotifications.length}`}
                urgent={unreadOrActionableNotifications.length > 0}
              />

              <QueueItem
                title="Pending registrations"
                value={
                  pendingRegistrations > 0
                    ? `${pendingRegistrations} tournament registration${
                        pendingRegistrations === 1 ? "" : "s"
                      } need review.`
                    : "No pending tournament registrations."
                }
                href="/tournaments"
                badge={`${pendingRegistrations}`}
                urgent={pendingRegistrations > 0}
              />

              <QueueItem
                title="Latest alert"
                value={
                  latestAlert
                    ? `${latestAlert.title}: ${latestAlert.body}`
                    : "No team alerts yet."
                }
                href="/notifications"
                badge={latestAlert ? "View" : "0"}
                urgent={Boolean(latestAlert)}
              />

              <QueueItem
                title="Roster health"
                value={
                  roster.length > 0
                    ? `${roster.length} wrestler${
                        roster.length === 1 ? "" : "s"
                      } currently on the roster.`
                    : "No wrestlers on the roster yet."
                }
                href="/wrestlers"
                badge={`${roster.length}`}
                urgent={roster.length === 0}
              />
            </View>
          </WWCard>
        ) : null}

        {signedIn ? (
          <WWCard>
            <View style={{ gap: 12 }}>
              <WWBadge label="PRACTICE HISTORY" tone="green" />

              <Text
                style={{
                  color: "#ffffff",
                  fontSize: 24,
                  fontWeight: "900",
                }}
              >
                Recent completed practices
              </Text>

              {recentPracticeSessions.length === 0 ? (
                <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22 }}>
                  Completed practices and post-practice notes will show here after a coach marks a practice complete.
                </Text>
              ) : (
                <View style={{ gap: 10 }}>
                  {recentPracticeSessions.map((session) => (
                    <Pressable
                      key={session.id}
                      onPress={() =>
                        session.practicePlanId
                          ? router.push({
                              pathname: "/practice-plans",
                              params: { planId: session.practicePlanId },
                            } as any)
                          : router.push("/practice-plans" as any)
                      }
                      style={({ pressed }) => ({
                        borderWidth: 1,
                        borderColor: "#315c86",
                        backgroundColor: pressed ? "#173b67" : "#102f52",
                        borderRadius: 18,
                        padding: 14,
                      })}
                    >
                      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: "#93c5fd", fontSize: 12, fontWeight: "900" }}>
                            {formatPracticeSessionDate(session.completedAt || session.createdAt)}
                          </Text>

                          <Text
                            style={{
                              color: "#ffffff",
                              fontSize: 17,
                              fontWeight: "900",
                              marginTop: 6,
                            }}
                          >
                            {session.practicePlanTitle || "Completed Practice"}
                          </Text>

                          <Text
                            style={{
                              color: "#b7c9df",
                              fontSize: 14,
                              lineHeight: 20,
                              marginTop: 5,
                            }}
                          >
                            {[
                              session.practicePlanStyle || "Mixed",
                              session.totalSeconds ? formatDurationLabel(session.totalSeconds) : "",
                              session.blockCount ? `${session.blockCount} blocks` : "",
                            ]
                              .filter(Boolean)
                              .join(" • ")}
                          </Text>

                          {session.notes ? (
                            <Text
                              numberOfLines={3}
                              style={{
                                color: "#dbeafe",
                                fontSize: 14,
                                lineHeight: 20,
                                marginTop: 8,
                              }}
                            >
                              {session.notes}
                            </Text>
                          ) : (
                            <Text
                              style={{
                                color: "#64748b",
                                fontSize: 14,
                                lineHeight: 20,
                                marginTop: 8,
                                fontStyle: "italic",
                              }}
                            >
                              No post-practice notes added.
                            </Text>
                          )}
                        </View>

                        <Text style={{ color: "#93c5fd", fontSize: 24, fontWeight: "900" }}>→</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </WWCard>
        ) : null}

        {signedIn ? (
          <TeamInviteCard
            teamName={teamName}
            teamCode={currentTeam?.teamCode}
            coachInviteCode={currentTeam?.coachInviteCode}
            compact
          />
        ) : (
          <WWCard>
            <WWBadge label="SIGN IN" tone="red" />

            <Text
              style={{
                color: "#ffffff",
                fontSize: 24,
                fontWeight: "900",
                marginTop: 12,
              }}
            >
              Unlock your team workspace
            </Text>

            <Text
              style={{
                color: "#b7c9df",
                fontSize: 15,
                lineHeight: 22,
                marginTop: 8,
              }}
            >
              Log in to see your team, invite codes, practice plans, roster, tournaments, and alerts.
            </Text>

            <Pressable
              onPress={() => router.push("/sign-in")}
              style={({ pressed }) => ({
                marginTop: 16,
                backgroundColor: pressed ? "#e2e8f0" : "#ffffff",
                borderRadius: 18,
                paddingVertical: 15,
                alignItems: "center",
              })}
            >
              <Text style={{ color: "#061a33", fontSize: 16, fontWeight: "900" }}>
                Log In
              </Text>
            </Pressable>
          </WWCard>
        )}

        <View style={{ gap: 12 }}>
          {actionCards.map((card) => (
            <Pressable
              key={card.href}
              onPress={() => router.push(card.href as any)}
              style={({ pressed }) => ({
                backgroundColor: pressed ? "#12345a" : "#0b2542",
                borderRadius: 26,
                borderWidth: 1,
                borderColor: "#21486e",
                padding: 18,
              })}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <View style={{ flex: 1 }}>
                  <WWBadge
                    label={card.stat.toUpperCase()}
                    tone={card.tone as "blue" | "red" | "green" | "orange"}
                  />

                  <Text
                    style={{
                      color: "#ffffff",
                      fontSize: 23,
                      fontWeight: "900",
                      marginTop: 12,
                    }}
                  >
                    {card.title}
                  </Text>

                  <Text
                    style={{
                      color: "#b7c9df",
                      fontSize: 15,
                      lineHeight: 22,
                      marginTop: 5,
                    }}
                  >
                    {card.subtitle}
                  </Text>
                </View>

                <Text
                  style={{
                    color: "#93c5fd",
                    fontSize: 28,
                    fontWeight: "900",
                  }}
                >
                  →
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </MobileScreenShell>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        minWidth: 88,
        flex: 1,
        borderRadius: 18,
        padding: 12,
        backgroundColor: "#f1f5f9",
      }}
    >
      <Text style={{ color: "#64748b", fontSize: 12, fontWeight: "800" }}>
        {label}
      </Text>

      <Text
        numberOfLines={1}
        style={{
          color: "#061a33",
          fontSize: 16,
          fontWeight: "900",
          marginTop: 3,
          textTransform: "capitalize",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function CommandRow({
  title,
  subtitle,
  badge,
  tone,
  onPress,
}: {
  title: string;
  subtitle: string;
  badge: string;
  tone: "blue" | "red" | "green" | "orange";
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderWidth: 1,
        borderColor: pressed ? "#ffffff" : "#315c86",
        backgroundColor: pressed ? "#173b67" : "#102f52",
        borderRadius: 20,
        padding: 14,
      })}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <WWBadge label={badge.toUpperCase()} tone={tone} />

          <Text style={{ color: "#ffffff", fontSize: 18, fontWeight: "900", marginTop: 10 }}>
            {title}
          </Text>

          <Text style={{ color: "#b7c9df", fontSize: 14, lineHeight: 20, marginTop: 5 }}>
            {subtitle}
          </Text>
        </View>

        <Text style={{ color: "#93c5fd", fontSize: 24, fontWeight: "900" }}>→</Text>
      </View>
    </Pressable>
  );
}

function QueueItem({
  title,
  value,
  href,
  badge,
  urgent,
}: {
  title: string;
  value: string;
  href: string;
  badge: string;
  urgent?: boolean;
}) {
  return (
    <Pressable
      onPress={() => router.push(href as any)}
      style={({ pressed }) => ({
        borderWidth: 1,
        borderColor: urgent ? "#bf1029" : "#315c86",
        backgroundColor: pressed ? "#173b67" : urgent ? "#431407" : "#102f52",
        borderRadius: 18,
        padding: 14,
      })}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "900" }}>
            {title}
          </Text>

          <Text
            numberOfLines={2}
            style={{
              color: "#b7c9df",
              fontSize: 14,
              lineHeight: 20,
              marginTop: 5,
            }}
          >
            {value}
          </Text>
        </View>

        <View
          style={{
            minWidth: 38,
            height: 38,
            borderRadius: 999,
            backgroundColor: urgent ? "#bf1029" : "#173b67",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 10,
            borderWidth: 1,
            borderColor: urgent ? "#fecaca" : "#315c86",
          }}
        >
          <Text style={{ color: "#ffffff", fontWeight: "900" }}>{badge}</Text>
        </View>
      </View>
    </Pressable>
  );
}
