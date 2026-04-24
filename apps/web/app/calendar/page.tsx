"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@wrestlewell/firebase/client";
import { COLLECTIONS, type WrestlerProfile } from "@wrestlewell/types/index";
import { listTournamentEntries, listTournaments, listWrestlers } from "@wrestlewell/lib/index";
import { RequireAuth } from "../require-auth";
import { useAuthState } from "../auth-provider";
import { StatusBanner } from "../status-banner";

type SavedPracticePlan = {
  id: string;
  title: string;
  style: string;
  totalMinutes: number;
  totalSeconds?: number;
  assignedWrestlerIds?: string[];
};

type CalendarEventItem = {
  id: string;
  date: string;
  practicePlanId: string;
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

function getStartOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
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
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function matchesAssignment(assignedIds: string[] | undefined, wrestlerId?: string | null) {
  const safeIds = assignedIds || [];
  if (safeIds.length === 0) {
    return true;
  }

  return Boolean(wrestlerId && safeIds.includes(wrestlerId));
}

export default function CalendarPage() {
  const { appUser, currentTeam } = useAuthState();
  const [savedPlans, setSavedPlans] = useState<SavedPracticePlan[]>([]);
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [tournaments, setTournaments] = useState<TournamentCalendarItem[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [assigningDate, setAssigningDate] = useState<string | null>(null);
  const [selectedPlanByDate, setSelectedPlanByDate] = useState<Record<string, string>>({});
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
    async function loadPlans() {
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
    async function loadEvents() {
      try {
        setLoadingEvents(true);

        if (!currentTeam?.id) {
          setEvents([]);
          setTournaments([]);
          return;
        }

        const q = query(
          collection(db, COLLECTIONS.CALENDAR_EVENTS),
          where("teamId", "==", currentTeam.id)
        );
        const snapshot = await getDocs(q);

        const rows = snapshot.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<CalendarEventItem, "id">),
          }))
          .filter((event) => matchesAssignment(event.assignedWrestlerIds, athleteOwnedWrestler?.id))
          .filter((event) => event.date >= weekStartKey && event.date <= weekEndKey);

        setEvents(rows);

        const tournamentRows = await listTournaments(db, currentTeam.id);
        const calendarTournaments = await Promise.all(
          tournamentRows
            .filter((tournament) => tournament.eventDate && tournament.eventDate >= weekStartKey && tournament.eventDate <= weekEndKey)
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
      } catch (error) {
        console.error("Failed to load calendar events:", error);
      } finally {
        setLoadingEvents(false);
      }
    }

    loadEvents();
  }, [athleteOwnedWrestler?.id, currentTeam?.id, weekStartKey, weekEndKey]);

  async function refreshEvents() {
    if (!currentTeam?.id) {
      setEvents([]);
      setTournaments([]);
      return;
    }

    const q = query(
      collection(db, COLLECTIONS.CALENDAR_EVENTS),
      where("teamId", "==", currentTeam.id)
    );
    const snapshot = await getDocs(q);

    const rows = snapshot.docs
      .map((d) => ({
        id: d.id,
        ...(d.data() as Omit<CalendarEventItem, "id">),
      }))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      .filter((event) => matchesAssignment(event.assignedWrestlerIds, athleteOwnedWrestler?.id))
      .filter((event) => event.date >= weekStartKey && event.date <= weekEndKey);

    setEvents(rows);

    const tournamentRows = await listTournaments(db, currentTeam.id);
    const calendarTournaments = await Promise.all(
      tournamentRows
        .filter((tournament) => tournament.eventDate && tournament.eventDate >= weekStartKey && tournament.eventDate <= weekEndKey)
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

    try {
      setAssigningDate(dateKey);

      await addDoc(collection(db, COLLECTIONS.CALENDAR_EVENTS), {
        teamId: currentTeam.id,
        date: dateKey,
        practicePlanId: selectedPlan.id,
        assignedWrestlerIds: selectedPlan.assignedWrestlerIds || [],
        practicePlanTitle: selectedPlan.title,
        practicePlanStyle: selectedPlan.style || "Mixed",
        totalMinutes: selectedPlan.totalMinutes || 0,
        totalSeconds: selectedPlan.totalSeconds || selectedPlan.totalMinutes * 60 || 0,
        notes: notesByDate[dateKey] || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSelectedPlanByDate((prev) => ({ ...prev, [dateKey]: "" }));
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

  return (
    <RequireAuth
      title="Weekly Calendar"
      description="Assign saved practice plans to specific days of the week."
    >
    <main style={{ padding: viewportWidth <= 768 ? 16 : 24, width: "100%", boxSizing: "border-box" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Weekly Calendar</h1>
      <p style={{ marginBottom: 24 }}>
        Assign saved practice plans to specific days of the week.
      </p>

      {!isCoach ? (
        <StatusBanner
          message={{
            tone: "info",
            text: "Calendar scheduling is coach-managed. Athletes can review the team schedule here, but only coaches can assign or remove plans.",
          }}
        />
      ) : null}

      <div style={{ display: "flex", gap: 12, marginBottom: 24, alignItems: "center", flexWrap: "wrap" }}>
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
                onChange={(e) =>
                  setSelectedPlanByDate((prev) => ({ ...prev, [dateKey]: e.target.value }))
                }
                disabled={!isCoach}
                style={{ width: "100%", padding: isDenseLayout ? 8 : 10, marginBottom: 10, minWidth: 0 }}
              >
                <option value="">Select a practice plan</option>
                {savedPlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.title}
                    {plan.assignedWrestlerIds?.length ? " (Assigned)" : ""}
                  </option>
                ))}
              </select>

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
                style={{ width: "100%", padding: isDenseLayout ? "8px 12px" : "10px 14px", marginBottom: 16 }}
              >
                {assigningDate === dateKey ? "Assigning..." : "Assign Plan"}
              </button>

              <div style={{ display: "grid", gap: 12 }}>
                {dayEvents.length === 0 && dayTournaments.length === 0 ? (
                  <p style={{ fontSize: 14, color: "#666" }}>No practice or tournament scheduled.</p>
                ) : null}

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
                      {tournament.rosterCount} attending · {tournament.submittedCount} submitted · {tournament.verifiedCount} verified
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
                      <strong>{event.practicePlanTitle}</strong>

                      <div style={{ fontSize: isDenseLayout ? 13 : 14, marginTop: 6 }}>
                        {event.practicePlanStyle || "Mixed"} ·{" "}
                        {formatDurationLabel(event.totalSeconds || event.totalMinutes * 60 || 0)}
                      </div>
                      <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                        {(event.assignedWrestlerIds || []).length === 0 ? "Team-wide practice" : "Assigned practice"}
                      </div>

                      {event.notes ? (
                        <p style={{ fontSize: isDenseLayout ? 13 : 14, marginTop: 8, marginBottom: 8 }}>
                          {event.notes}
                        </p>
                      ) : null}

                      <a
                        href={`/practice-plans?open=${event.practicePlanId}`}
                        style={{ display: "inline-block", marginRight: 10, marginBottom: 8 }}
                      >
                        Open Plan
                      </a>

                      {isCoach ? (
                        <button
                          onClick={() => removeEvent(event.id)}
                          style={{ padding: "6px 10px" }}
                        >
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
    </main>
    </RequireAuth>
  );
}
