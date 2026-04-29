import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { db } from "@wrestlewell/firebase/client";
import {
  createTeamAnnouncement,
  listCalendarEvents,
  listTeamAnnouncements,
  listTeamNotifications,
  sendTeamPushDelivery,
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
import { MobileScreenShell } from "../components/mobile-screen-shell";
import { useNotificationsState } from "../components/notifications-provider";

type NotificationCard = {
  id: string;
  kind: "announcement" | "practice" | "tournament";
  title: string;
  body: string;
  meta: string;
};

function formatPracticeDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatAnnouncementDate(value: string) {
  if (!value) {
    return "Just now";
  }

  const date = new Date(value);
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

function createPracticeCards(events: CalendarEventRecord[]): NotificationCard[] {
  const todayKey = new Date().toISOString().split("T")[0];

  return events
    .filter((event) => event.date >= todayKey)
    .slice(0, 6)
    .map((event) => ({
      id: `practice-${event.id}`,
      kind: "practice" as const,
      title: event.practicePlanTitle || "Upcoming practice",
      body:
        event.notes ||
        `Your team has ${event.practicePlanStyle || "Mixed"} practice scheduled on ${formatPracticeDate(
          event.date
        )}.`,
      meta: `Practice reminder • ${formatPracticeDate(event.date)}`,
    }));
}

function createTournamentCards(args: {
  tournaments: Tournament[];
  entriesByTournament: Record<string, TournamentEntry[]>;
  appRole: "coach" | "athlete";
  athleteOwnedWrestlerId?: string;
}): NotificationCard[] {
  if (args.appRole === "coach") {
    return args.tournaments
      .filter((tournament) => (args.entriesByTournament[tournament.id] || []).length > 0)
      .slice(0, 6)
      .map((tournament) => {
        const entryCount = (args.entriesByTournament[tournament.id] || []).length;

        return {
          id: `tournament-${tournament.id}`,
          kind: "tournament" as const,
          title: `${tournament.name} roster update`,
          body:
            entryCount === 1
              ? "1 wrestler is currently on the WrestleWell tournament roster."
              : `${entryCount} wrestlers are currently on the WrestleWell tournament roster.`,
          meta: "Tournament update",
        };
      });
  }

  if (!args.athleteOwnedWrestlerId) {
    return [];
  }

  return args.tournaments
    .filter((tournament) =>
      (args.entriesByTournament[tournament.id] || []).some(
        (entry) => entry.wrestlerId === args.athleteOwnedWrestlerId
      )
    )
    .slice(0, 6)
    .map((tournament) => ({
      id: `tournament-${tournament.id}`,
      kind: "tournament" as const,
      title: `${tournament.name} registration`,
      body: "You are listed on the WrestleWell roster for this tournament.",
      meta: "Tournament update",
    }));
}

function createAnnouncementCards(items: TeamAnnouncement[]): NotificationCard[] {
  return items.slice(0, 10).map((item) => ({
    id: `announcement-${item.id}`,
    kind: "announcement" as const,
    title: item.title,
    body: item.body,
    meta: `Coach announcement • ${formatAnnouncementDate(item.createdAt)}`,
  }));
}

function createTeamNotificationCards(items: TeamNotification[]): NotificationCard[] {
  return items.slice(0, 10).map((item) => ({
    id: `team-notification-${item.id}`,
    kind: item.type === "tournament_registration" ? "tournament" : "announcement",
    title: item.title,
    body: item.body,
    meta:
      item.type === "tournament_registration"
        ? `Registration alert • ${formatAnnouncementDate(item.createdAt)}`
        : `Team notification • ${formatAnnouncementDate(item.createdAt)}`,
  }));
}

export default function NotificationsScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } = useMobileAuthState();
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
  const [entriesByTournament, setEntriesByTournament] = useState<Record<string, TournamentEntry[]>>(
    {}
  );
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const isCoach = appUser?.role === "coach";

  async function refresh() {
    if (!currentTeam?.id) {
      setAnnouncements([]);
      setTeamNotifications([]);
      setEvents([]);
      setTournaments([]);
      setEntriesByTournament({});
      setWrestlers([]);
      return;
    }

    const [announcementRows, notificationRows, eventRows, tournamentRows, wrestlerRows] =
      await Promise.all([
        listTeamAnnouncements(db, currentTeam.id),
        listTeamNotifications(db, currentTeam.id, appUser?.role),
        listCalendarEvents(db, currentTeam.id),
        listTournaments(db, currentTeam.id),
        listWrestlers(db, currentTeam.id),
      ]);

    setAnnouncements(announcementRows);
    setTeamNotifications(notificationRows);
    setEvents(eventRows);
    setTournaments(tournamentRows);
    setWrestlers(wrestlerRows);

    const entryRows = await Promise.all(
      tournamentRows.map(
        async (tournament) =>
          [
            tournament.id,
            await listTournamentEntries(db, {
              teamId: currentTeam.id,
              tournamentId: tournament.id,
            }),
          ] as const
      )
    );

    setEntriesByTournament(Object.fromEntries(entryRows));
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

  const notificationCards = useMemo(() => {
    const cards = [
      ...createAnnouncementCards(announcements),
      ...createTeamNotificationCards(teamNotifications),
      ...createPracticeCards(events),
      ...createTournamentCards({
        tournaments,
        entriesByTournament,
        appRole: appUser?.role === "coach" ? "coach" : "athlete",
        athleteOwnedWrestlerId: athleteOwnedWrestler?.id,
      }),
    ];

    return cards.slice(0, 16);
  }, [
    announcements,
    appUser?.role,
    athleteOwnedWrestler?.id,
    entriesByTournament,
    events,
    teamNotifications,
    tournaments,
  ]);

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
        title,
        body,
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
            Local test reminders work now. Remote push delivery will use the saved device
            registration after notification sending is wired up.
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
          marginBottom: 20,
        }}
      >
        <Text style={{ color: "#061a33", fontWeight: "900" }}>
          {loading ? "Refreshing..." : "Refresh"}
        </Text>
      </Pressable>

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
            No notifications yet. Team announcements, practice reminders, and tournament updates will show here.
          </Text>
        </View>
      ) : null}

      <View style={{ gap: 14 }}>
        {notificationCards.map((item) => (
          <View
            key={item.id}
            style={{
              borderWidth: 1,
              borderColor: "#21486e",
              borderRadius: 24,
              padding: 18,
              backgroundColor: "#0b2542",
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "900", color: "#93c5fd", marginBottom: 8 }}>
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
          </View>
        ))}
      </View>
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