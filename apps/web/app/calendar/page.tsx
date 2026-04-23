"use client";

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
import { COLLECTIONS } from "@wrestlewell/types/index";
import { RequireAuth } from "../require-auth";
import { useAuthState } from "../auth-provider";
import { StatusBanner } from "../status-banner";

type SavedPracticePlan = {
  id: string;
  title: string;
  style: string;
  totalMinutes: number;
  totalSeconds?: number;
};

type CalendarEventItem = {
  id: string;
  date: string;
  practicePlanId: string;
  practicePlanTitle: string;
  practicePlanStyle: string;
  totalMinutes: number;
  totalSeconds?: number;
  notes?: string;
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

export default function CalendarPage() {
  const { appUser, currentTeam } = useAuthState();
  const [savedPlans, setSavedPlans] = useState<SavedPracticePlan[]>([]);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [assigningDate, setAssigningDate] = useState<string | null>(null);
  const [selectedPlanByDate, setSelectedPlanByDate] = useState<Record<string, string>>({});
  const [notesByDate, setNotesByDate] = useState<Record<string, string>>({});
  const [weekOffset, setWeekOffset] = useState(0);
  const isCoach = appUser?.role === "coach";

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
          .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
        setSavedPlans(rows);
      } catch (error) {
        console.error("Failed to load saved practice plans:", error);
      } finally {
        setLoadingPlans(false);
      }
    }

    loadPlans();
  }, [currentTeam?.id]);

  useEffect(() => {
    async function loadEvents() {
      try {
        setLoadingEvents(true);

        if (!currentTeam?.id) {
          setEvents([]);
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
          .filter((event) => event.date >= weekStartKey && event.date <= weekEndKey);

        setEvents(rows);
      } catch (error) {
        console.error("Failed to load calendar events:", error);
      } finally {
        setLoadingEvents(false);
      }
    }

    loadEvents();
  }, [currentTeam?.id, weekStartKey, weekEndKey]);

  async function refreshEvents() {
    if (!currentTeam?.id) {
      setEvents([]);
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
      .filter((event) => event.date >= weekStartKey && event.date <= weekEndKey);

    setEvents(rows);
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

  return (
    <RequireAuth
      title="Weekly Calendar"
      description="Assign saved practice plans to specific days of the week."
    >
    <main style={{ padding: 24 }}>
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
          gridTemplateColumns: "repeat(7, minmax(220px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        {weekDates.map((date) => {
          const dateKey = formatDateKey(date);
          const dayEvents = getEventsForDate(dateKey);

          return (
            <section
              key={dateKey}
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: 16,
                background: "#fff",
                minHeight: 500,
              }}
            >
              <h2 style={{ marginTop: 0, fontSize: 18 }}>{formatPrettyDate(date)}</h2>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>{dateKey}</div>

              <select
                value={selectedPlanByDate[dateKey] || ""}
                onChange={(e) =>
                  setSelectedPlanByDate((prev) => ({ ...prev, [dateKey]: e.target.value }))
                }
                disabled={!isCoach}
                style={{ width: "100%", padding: 10, marginBottom: 10 }}
              >
                <option value="">Select a practice plan</option>
                {savedPlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.title}
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
                  padding: 10,
                  resize: "vertical",
                  marginBottom: 10,
                }}
              />

              <button
                onClick={() => assignPlanToDate(dateKey)}
                disabled={assigningDate === dateKey || !isCoach}
                style={{ width: "100%", padding: "10px 14px", marginBottom: 16 }}
              >
                {assigningDate === dateKey ? "Assigning..." : "Assign Plan"}
              </button>

              <div style={{ display: "grid", gap: 12 }}>
                {dayEvents.length === 0 ? (
                  <p style={{ fontSize: 14, color: "#666" }}>No practice assigned.</p>
                ) : (
                  dayEvents.map((event) => (
                    <div
                      key={event.id}
                      style={{
                        border: "1px solid #eee",
                        borderRadius: 10,
                        padding: 12,
                        background: "#fafafa",
                      }}
                    >
                      <strong>{event.practicePlanTitle}</strong>

                      <div style={{ fontSize: 14, marginTop: 6 }}>
                        {event.practicePlanStyle || "Mixed"} ·{" "}
                        {formatDurationLabel(event.totalSeconds || event.totalMinutes * 60 || 0)}
                      </div>

                      {event.notes ? (
                        <p style={{ fontSize: 14, marginTop: 8, marginBottom: 8 }}>{event.notes}</p>
                      ) : null}

                      <a
                        href={`/practice-plans?open=${event.practicePlanId}`}
                        style={{ display: "inline-block", marginRight: 10 }}
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
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </main>
    </RequireAuth>
  );
}
