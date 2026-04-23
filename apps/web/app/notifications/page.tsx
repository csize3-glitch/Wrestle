"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { db } from "@wrestlewell/firebase/client";
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
import { RequireAuth } from "../require-auth";
import { useAuthState } from "../auth-provider";
import { markNotificationsSeen } from "../notifications-storage";

type NotificationCard = {
  id: string;
  kind: "announcement" | "practice" | "tournament";
  title: string;
  body: string;
  meta: string;
  href: string;
};

function formatDateLabel(value: string) {
  if (!value) {
    return "Recently";
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

function createAnnouncementCards(items: TeamAnnouncement[]): NotificationCard[] {
  return items.slice(0, 10).map((item) => ({
    id: `announcement-${item.id}`,
    kind: "announcement",
    title: item.title,
    body: item.body,
    meta: `Coach announcement • ${formatDateLabel(item.createdAt)}`,
    href: "/notifications",
  }));
}

function createTeamNotificationCards(items: TeamNotification[]): NotificationCard[] {
  return items.slice(0, 10).map((item) => ({
    id: `team-notification-${item.id}`,
    kind: item.type === "tournament_registration" ? "tournament" : "announcement",
    title: item.title,
    body: item.body,
    href:
      item.type === "tournament_registration" && item.tournamentId
        ? `/tournaments?open=${item.tournamentId}`
        : "/notifications",
    meta:
      item.type === "tournament_registration"
        ? `Registration alert • ${formatDateLabel(item.createdAt)}`
        : `Team notification • ${formatDateLabel(item.createdAt)}`,
  }));
}

function createPracticeCards(events: CalendarEventRecord[]): NotificationCard[] {
  const todayKey = new Date().toISOString().split("T")[0];

  return events
    .filter((event) => event.date >= todayKey)
    .slice(0, 6)
    .map((event) => ({
      id: `practice-${event.id}`,
      kind: "practice",
      title: event.practicePlanTitle || "Upcoming practice",
      body:
        event.notes ||
        `Your team has ${event.practicePlanStyle || "Mixed"} practice scheduled on ${formatPracticeDate(event.date)}.`,
      meta: `Practice reminder • ${formatPracticeDate(event.date)}`,
      href: "/calendar",
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
          kind: "tournament",
          title: `${tournament.name} roster update`,
          body:
            entryCount === 1
              ? "1 wrestler is currently on the WrestleWell tournament roster."
              : `${entryCount} wrestlers are currently on the WrestleWell tournament roster.`,
          meta: "Tournament update",
          href: `/tournaments?open=${tournament.id}`,
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
      kind: "tournament",
      title: `${tournament.name} registration`,
      body: "You are listed on the WrestleWell roster for this tournament.",
      meta: "Tournament update",
      href: `/tournaments?open=${tournament.id}`,
    }));
}

export default function NotificationsPage() {
  const { firebaseUser, appUser, currentTeam } = useAuthState();
  const [announcements, setAnnouncements] = useState<TeamAnnouncement[]>([]);
  const [teamNotifications, setTeamNotifications] = useState<TeamNotification[]>([]);
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [entriesByTournament, setEntriesByTournament] = useState<Record<string, TournamentEntry[]>>({});
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const athleteOwnedWrestler = useMemo(
    () =>
      appUser?.role === "athlete" && firebaseUser
        ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) || null
        : null,
    [appUser?.role, firebaseUser, wrestlers]
  );

  useEffect(() => {
    async function load() {
      if (!currentTeam?.id || !appUser || !firebaseUser) {
        setAnnouncements([]);
        setTeamNotifications([]);
        setEvents([]);
        setTournaments([]);
        setEntriesByTournament({});
        setWrestlers([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const [announcementRows, notificationRows, eventRows, tournamentRows, wrestlerRows] =
          await Promise.all([
            listTeamAnnouncements(db, currentTeam.id),
            listTeamNotifications(db, currentTeam.id, appUser.role),
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
              [tournament.id, await listTournamentEntries(db, { teamId: currentTeam.id, tournamentId: tournament.id })] as const
          )
        );
        setEntriesByTournament(Object.fromEntries(entryRows));

        const latestSeenCandidate = [announcementRows[0]?.createdAt, notificationRows[0]?.createdAt]
          .filter(Boolean)
          .sort()
          .at(-1);

        if (latestSeenCandidate) {
          markNotificationsSeen(firebaseUser.uid, currentTeam.id, appUser.role, latestSeenCandidate);
        }
      } catch (error) {
        console.error("Failed to load web notifications:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [appUser, currentTeam?.id, firebaseUser]);

  const cards = useMemo(() => {
    const allCards = [
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

    return allCards.slice(0, 20);
  }, [announcements, appUser?.role, athleteOwnedWrestler?.id, entriesByTournament, events, teamNotifications, tournaments]);

  return (
    <RequireAuth
      title="Notifications"
      description="Announcements, tournament registration alerts, and upcoming schedule reminders."
    >
      <main style={{ padding: 24 }}>
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>Notifications</h1>
        <p style={{ marginBottom: 24 }}>
          Stay on top of coach announcements, tournament registration updates, and upcoming practice reminders.
        </p>

        {loading ? <p>Loading notifications...</p> : null}

        {!loading && cards.length === 0 ? (
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 16,
              padding: 20,
              background: "#fff",
            }}
          >
            <strong>No notifications yet.</strong>
            <p style={{ marginBottom: 0, color: "#555" }}>
              New announcements, registration alerts, and schedule reminders will appear here.
            </p>
          </section>
        ) : null}

        <div style={{ display: "grid", gap: 14 }}>
          {cards.map((card) => (
            <Link
              key={card.id}
              href={card.href}
              style={{
                display: "block",
                border: "1px solid #ddd",
                borderRadius: 16,
                padding: 18,
                background: "#fff",
                transition: "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0f2748", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {card.kind}
              </div>
              <strong style={{ display: "block", fontSize: 18, marginBottom: 8 }}>{card.title}</strong>
              <p style={{ marginTop: 0, marginBottom: 10, color: "#334155" }}>{card.body}</p>
              <div style={{ fontSize: 13, color: "#64748b" }}>{card.meta}</div>
            </Link>
          ))}
        </div>
      </main>
    </RequireAuth>
  );
}
