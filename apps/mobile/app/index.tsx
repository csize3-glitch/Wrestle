import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { signOut } from "firebase/auth";
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

const actionCards = [
  {
    title: "Practice Plans",
    subtitle: "Build sessions, run the timer, and keep the room moving.",
    href: "/practice-plans",
    tone: "blue",
    stat: "Plan",
  },
  {
    title: "Calendar",
    subtitle: "See upcoming practices and jump into assigned plans.",
    href: "/calendar",
    tone: "green",
    stat: "Today",
  },
  {
    title: "Roster",
    subtitle: "Manage profiles, notes, styles, strengths, and goals.",
    href: "/wrestlers",
    tone: "orange",
    stat: "Team",
  },
  {
    title: "Mat-Side",
    subtitle: "Fast match-day summaries for warm-up and strategy.",
    href: "/mat-side",
    tone: "red",
    stat: "Ready",
  },
  {
    title: "Tournaments",
    subtitle: "Track rosters, registration, travel notes, and status.",
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

function formatPracticeDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDurationLabel(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function IndexScreen() {
  const { firebaseUser, appUser, currentTeam, refreshAppState } = useMobileAuthState();

  const [roster, setRoster] = useState<WrestlerProfile[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventRecord[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [announcements, setAnnouncements] = useState<TeamAnnouncement[]>([]);
  const [teamNotifications, setTeamNotifications] = useState<TeamNotification[]>([]);
  const [pendingRegistrations, setPendingRegistrations] = useState(0);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const teamName =
    currentTeam?.name ||
    currentTeam?.teamName ||
    currentTeam?.displayName ||
    "Your Team";

  const signedIn = Boolean(firebaseUser && appUser);

  const todayKey = useMemo(() => new Date().toISOString().split("T")[0], []);

  const upcomingPractices = useMemo(
    () =>
      calendarEvents
        .filter((event) => event.date >= todayKey)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 3),
    [calendarEvents, todayKey]
  );

  const nextPractice = upcomingPractices[0] || null;

  const upcomingTournaments = useMemo(
    () =>
      tournaments.filter((tournament) => {
        if (!tournament.eventDate) return false;
        return tournament.eventDate >= todayKey;
      }),
    [tournaments, todayKey]
  );

  const latestAlert = useMemo(() => {
    const cards = [
      ...announcements.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        createdAt: item.createdAt,
      })),
      ...teamNotifications.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        createdAt: item.createdAt,
      })),
    ];

    return cards
      .filter((item) => item.createdAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }, [announcements, teamNotifications]);

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
      setPendingRegistrations(0);
      return;
    }

    if (appUser.role === "athlete" && appUser.varkCompleted !== true) {
      return;
    }

    try {
      setDashboardLoading(true);

      const [wrestlerRows, eventRows, tournamentRows, announcementRows, notificationRows] =
        await Promise.all([
          listWrestlers(db, currentTeam.id),
          listCalendarEvents(db, currentTeam.id),
          listTournaments(db, currentTeam.id),
          listTeamAnnouncements(db, currentTeam.id),
          listTeamNotifications(db, currentTeam.id, appUser.role),
        ]);

      setRoster(wrestlerRows);
      setCalendarEvents(eventRows);
      setTournaments(tournamentRows);
      setAnnouncements(announcementRows);
      setTeamNotifications(notificationRows);

      const entryBatches = await Promise.all(
        tournamentRows.map((tournament) =>
          listTournamentEntries(db, {
            teamId: currentTeam.id,
            tournamentId: tournament.id,
          })
        )
      );

      const submittedCount = entryBatches
        .flat()
        .filter((entry) => entry.status === "submitted").length;

      setPendingRegistrations(submittedCount);
    } catch (error) {
      console.error("Failed to load mobile dashboard:", error);
    } finally {
      setDashboardLoading(false);
    }
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
                WrestleIQ setup needed
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
                  Start WrestleIQ
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

          {signedIn ? (
            <Pressable
              onPress={handleSignOut}
              style={({ pressed }) => ({
                marginTop: 16,
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
              <WWBadge label="NEXT UP" tone="green" />

              <Text
                style={{
                  color: "#ffffff",
                  fontSize: 25,
                  fontWeight: "900",
                  letterSpacing: -0.5,
                }}
              >
                {nextPractice ? nextPractice.practicePlanTitle || "Upcoming Practice" : "No practice scheduled"}
              </Text>

              <Text
                style={{
                  color: "#b7c9df",
                  fontSize: 15,
                  lineHeight: 22,
                }}
              >
                {nextPractice
                  ? `${formatPracticeDate(nextPractice.date)} • ${nextPractice.practicePlanStyle || "Mixed"} • ${formatDurationLabel(
                      nextPractice.totalSeconds || nextPractice.totalMinutes * 60 || 0
                    )}`
                  : appUser?.role === "coach"
                    ? "Schedule a practice on the web app and it will appear here for the team."
                    : "Your coach has not assigned an upcoming practice yet."}
              </Text>

              {nextPractice?.notes ? (
                <Text style={{ color: "#dbeafe", fontSize: 14, lineHeight: 21 }}>
                  {nextPractice.notes}
                </Text>
              ) : null}

              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <Pressable
                  onPress={() =>
                    nextPractice?.practicePlanId
                      ? router.push({
                          pathname: "/practice-plans",
                          params: { planId: nextPractice.practicePlanId },
                        } as any)
                      : router.push("/calendar" as any)
                  }
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? "#991b1b" : "#bf1029",
                    borderRadius: 18,
                    paddingHorizontal: 16,
                    paddingVertical: 13,
                  })}
                >
                  <Text style={{ color: "#ffffff", fontWeight: "900" }}>
                    {nextPractice ? "Open Practice" : "Open Calendar"}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => router.push("/mat-side" as any)}
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
                    Mat-Side
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
                title="Pending registrations"
                value={
                  pendingRegistrations > 0
                    ? `${pendingRegistrations} tournament registration${pendingRegistrations === 1 ? "" : "s"} need review.`
                    : "No pending tournament registrations."
                }
                href="/tournaments"
              />

              <QueueItem
                title="Latest alert"
                value={
                  latestAlert
                    ? `${latestAlert.title}: ${latestAlert.body}`
                    : "No team alerts yet."
                }
                href="/notifications"
              />

              <QueueItem
                title="Roster health"
                value={
                  roster.length > 0
                    ? `${roster.length} wrestler${roster.length === 1 ? "" : "s"} currently on the roster.`
                    : "No wrestlers on the roster yet."
                }
                href="/wrestlers"
              />
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

function QueueItem({
  title,
  value,
  href,
}: {
  title: string;
  value: string;
  href: string;
}) {
  return (
    <Pressable
      onPress={() => router.push(href as any)}
      style={({ pressed }) => ({
        borderWidth: 1,
        borderColor: "#315c86",
        backgroundColor: pressed ? "#173b67" : "#102f52",
        borderRadius: 18,
        padding: 14,
      })}
    >
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
    </Pressable>
  );
}