"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { db } from "@wrestlewell/firebase/client";
import {
  listPracticeSessionFollowUps,
  listWrestlers,
  updatePracticeSessionFollowUpStatus,
} from "@wrestlewell/lib/index";
import type { PracticeSessionFollowUpRecord, WrestlerProfile } from "@wrestlewell/types/index";
import { useAuthState } from "../auth-provider";
import { RequireAuth } from "../require-auth";

function formatDateLabel(value?: string) {
  if (!value) {
    return "No due date";
  }

  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTimeLabel(value?: string) {
  if (!value) {
    return "Recently saved";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function FollowUpsPage() {
  const { appUser, currentTeam } = useAuthState();
  const [followUps, setFollowUps] = useState<PracticeSessionFollowUpRecord[]>([]);
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFollowUpKey, setActiveFollowUpKey] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "done">("open");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [wrestlerFilter, setWrestlerFilter] = useState("all");
  const [dueDateFilter, setDueDateFilter] = useState<"all" | "overdue" | "today" | "upcoming" | "none">("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const isCoach = appUser?.role === "coach";

  useEffect(() => {
    async function load() {
      if (!currentTeam?.id || !isCoach) {
        setFollowUps([]);
        setWrestlers([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const [followUpRows, wrestlerRows] = await Promise.all([
          listPracticeSessionFollowUps(db, currentTeam.id),
          listWrestlers(db, currentTeam.id),
        ]);
        setFollowUps(followUpRows);
        setWrestlers(wrestlerRows);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [currentTeam?.id, isCoach]);

  const categories = useMemo(
    () => Array.from(new Set(followUps.map((followUp) => followUp.category))).sort(),
    [followUps]
  );

  const filteredFollowUps = useMemo(() => {
    const todayKey = new Date().toISOString().split("T")[0];

    return followUps.filter((followUp) => {
      if (statusFilter !== "all" && followUp.status !== statusFilter) {
        return false;
      }

      if (categoryFilter !== "all" && followUp.category !== categoryFilter) {
        return false;
      }

      if (wrestlerFilter !== "all" && followUp.wrestlerId !== wrestlerFilter) {
        return false;
      }

      if (dueDateFilter === "overdue") {
        return Boolean(followUp.dueDate && followUp.dueDate < todayKey);
      }

      if (dueDateFilter === "today") {
        return followUp.dueDate === todayKey;
      }

      if (dueDateFilter === "upcoming") {
        return Boolean(followUp.dueDate && followUp.dueDate > todayKey);
      }

      if (dueDateFilter === "none") {
        return !followUp.dueDate;
      }

      return true;
    });
  }, [categoryFilter, dueDateFilter, followUps, statusFilter, wrestlerFilter]);

  const selectedFollowUp = useMemo(
    () =>
      filteredFollowUps.find(
        (followUp) => `${followUp.sessionId}:${followUp.id}` === selectedKey
      ) || null,
    [filteredFollowUps, selectedKey]
  );

  async function handleStatusToggle(followUp: PracticeSessionFollowUpRecord, status: "open" | "done") {
    const followUpKey = `${followUp.sessionId}:${followUp.id}`;
    setActiveFollowUpKey(followUpKey);

    try {
      await updatePracticeSessionFollowUpStatus(db, {
        sessionId: followUp.sessionId,
        followUps: followUp.sourceFollowUps,
        followUpId: followUp.id,
        status,
      });

      setFollowUps((prev) =>
        prev.map((entry) =>
          entry.sessionId === followUp.sessionId && entry.id === followUp.id
            ? {
                ...entry,
                status,
                completedAt: status === "done" ? entry.completedAt || new Date().toISOString() : "",
                sourceFollowUps: entry.sourceFollowUps.map((source) =>
                  source.id === entry.id
                    ? {
                        ...source,
                        status,
                        completedAt:
                          status === "done"
                            ? source.completedAt || new Date().toISOString()
                            : "",
                      }
                    : source
                ),
              }
            : entry
        )
      );
    } finally {
      setActiveFollowUpKey(null);
    }
  }

  return (
    <RequireAuth
      title="Follow-Ups"
      description="Coach workflow board for unresolved wrestler and practice closeout items."
    >
      <main style={{ padding: 24, display: "grid", gap: 24 }}>
        <section className="hero-panel">
          <div className="hero-panel__inner" style={{ gridTemplateColumns: "1.2fr 0.95fr" }}>
            <div>
              <div className="eyebrow">Coach dashboard</div>
              <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 4vw, 3.2rem)" }}>
                Follow through on every wrestler note, attendance concern, and practice closeout.
              </h1>
              <p className="hero-copy">
                Keep all open follow-ups in one place, move them to done when the work is handled, and jump back into wrestler or calendar context when you need it.
              </p>
            </div>

            <div className="hero-side">
              <div className="stat-card stat-card--accent">
                <span className="stat-card__label">Open follow-ups</span>
                <span className="stat-card__value">
                  {followUps.filter((followUp) => followUp.status === "open").length}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">Done this cycle</span>
                <span className="stat-card__value">
                  {followUps.filter((followUp) => followUp.status === "done").length}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">Linked wrestlers</span>
                <span className="stat-card__value">{wrestlers.length}</span>
              </div>
            </div>
          </div>
        </section>

        {!isCoach ? (
          <section className="content-card">
            <h2 className="content-card__title">Coach access required</h2>
            <p className="content-card__copy">
              Follow-up management is coach-only so athlete and parent accounts never see internal closeout tasks.
            </p>
          </section>
        ) : (
          <div style={{ display: "grid", gap: 24, gridTemplateColumns: "0.95fr 1.05fr" }}>
            <section className="content-card" style={{ display: "grid", gap: 18, alignContent: "start" }}>
              <div>
                <h2 className="content-card__title">Filters</h2>
                <p className="content-card__copy">
                  Narrow the board by wrestler, category, due date, or status without losing the full season context.
                </p>
              </div>

              <label className="field-label">
                Status
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "open" | "done")}>
                  <option value="open">Open</option>
                  <option value="done">Done</option>
                  <option value="all">All</option>
                </select>
              </label>

              <label className="field-label">
                Wrestler
                <select value={wrestlerFilter} onChange={(event) => setWrestlerFilter(event.target.value)}>
                  <option value="all">All wrestlers</option>
                  {wrestlers.map((wrestler) => (
                    <option key={wrestler.id} value={wrestler.id}>
                      {wrestler.firstName} {wrestler.lastName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-label">
                Category
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                  <option value="all">All categories</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-label">
                Due date
                <select value={dueDateFilter} onChange={(event) => setDueDateFilter(event.target.value as typeof dueDateFilter)}>
                  <option value="all">All due dates</option>
                  <option value="overdue">Overdue</option>
                  <option value="today">Due today</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="none">No due date</option>
                </select>
              </label>
            </section>

            <section className="content-card" style={{ display: "grid", gap: 18 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h2 className="content-card__title">Open board</h2>
                  <p className="content-card__copy">
                    {loading
                      ? "Loading follow-ups..."
                      : `${filteredFollowUps.length} follow-up${filteredFollowUps.length === 1 ? "" : "s"} match the current filters.`}
                  </p>
                </div>
              </div>

              {loading ? (
                <p style={{ margin: 0 }}>Loading follow-ups...</p>
              ) : filteredFollowUps.length === 0 ? (
                <p style={{ margin: 0 }}>
                  No follow-ups match the current filters. Try widening the board or finish closeout on mobile to create a new task.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  {filteredFollowUps.map((followUp) => (
                    <button
                      key={`${followUp.sessionId}:${followUp.id}`}
                      type="button"
                      onClick={() => setSelectedKey(`${followUp.sessionId}:${followUp.id}`)}
                      style={{
                        textAlign: "left",
                        display: "grid",
                        gap: 10,
                        padding: 18,
                        borderRadius: 20,
                        border:
                          selectedKey === `${followUp.sessionId}:${followUp.id}`
                            ? "1px solid rgba(191, 16, 41, 0.35)"
                            : "1px solid rgba(15, 39, 72, 0.12)",
                        background:
                          selectedKey === `${followUp.sessionId}:${followUp.id}`
                            ? "rgba(191, 16, 41, 0.05)"
                            : "#fff",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        <strong style={{ fontSize: 18, color: "#0f172a" }}>{followUp.title}</strong>
                        <span className="eyebrow" style={{ marginBottom: 0 }}>
                          {followUp.status === "done" ? "Done" : "Open"}
                        </span>
                      </div>
                      <p style={{ margin: 0, color: "#334155", lineHeight: 1.5 }}>
                        {followUp.details || "No extra detail saved yet."}
                      </p>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "#64748b", fontSize: 14 }}>
                        <span>{followUp.wrestlerName || "Team-wide item"}</span>
                        <span>{followUp.category}</span>
                        <span>Due {formatDateLabel(followUp.dueDate)}</span>
                        <span>{followUp.practicePlanTitle || "Practice closeout"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {isCoach && selectedFollowUp ? (
          <section className="content-card" style={{ display: "grid", gap: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div className="eyebrow">Follow-up detail</div>
                <h2 className="content-card__title" style={{ marginBottom: 6 }}>
                  {selectedFollowUp.title}
                </h2>
                <p className="content-card__copy">
                  Saved {formatDateTimeLabel(selectedFollowUp.createdAt)} · {selectedFollowUp.practicePlanTitle || "Practice closeout"}
                </p>
              </div>

              <div className="hero-actions" style={{ marginTop: 0 }}>
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() =>
                    handleStatusToggle(
                      selectedFollowUp,
                      selectedFollowUp.status === "done" ? "open" : "done"
                    )
                  }
                  disabled={activeFollowUpKey === `${selectedFollowUp.sessionId}:${selectedFollowUp.id}`}
                >
                  {activeFollowUpKey === `${selectedFollowUp.sessionId}:${selectedFollowUp.id}`
                    ? "Saving..."
                    : selectedFollowUp.status === "done"
                      ? "Reopen"
                      : "Mark Done"}
                </button>
                <button className="button-secondary" type="button" onClick={() => setSelectedKey(null)}>
                  Close
                </button>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gap: 14,
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              }}
            >
              <div className="content-card" style={{ padding: 18, borderRadius: 18 }}>
                <strong style={{ display: "block", color: "#0f172a", marginBottom: 8 }}>Wrestler</strong>
                <span style={{ color: "#475569" }}>{selectedFollowUp.wrestlerName || "Team-wide item"}</span>
              </div>
              <div className="content-card" style={{ padding: 18, borderRadius: 18 }}>
                <strong style={{ display: "block", color: "#0f172a", marginBottom: 8 }}>Category</strong>
                <span style={{ color: "#475569" }}>{selectedFollowUp.category}</span>
              </div>
              <div className="content-card" style={{ padding: 18, borderRadius: 18 }}>
                <strong style={{ display: "block", color: "#0f172a", marginBottom: 8 }}>Due date</strong>
                <span style={{ color: "#475569" }}>{formatDateLabel(selectedFollowUp.dueDate)}</span>
              </div>
              <div className="content-card" style={{ padding: 18, borderRadius: 18 }}>
                <strong style={{ display: "block", color: "#0f172a", marginBottom: 8 }}>Status</strong>
                <span style={{ color: "#475569" }}>
                  {selectedFollowUp.status === "done" ? "Done" : "Open"}
                </span>
              </div>
            </div>

            <div className="content-card" style={{ padding: 20, borderRadius: 20 }}>
              <strong style={{ display: "block", color: "#0f172a", marginBottom: 10 }}>Detail</strong>
              <p style={{ margin: 0, color: "#334155", lineHeight: 1.6 }}>
                {selectedFollowUp.details || "No extra detail saved for this follow-up."}
              </p>
            </div>

            <div className="hero-actions" style={{ marginTop: 0 }}>
              <Link href="/wrestlers" className="button-secondary">
                Open Wrestlers
              </Link>
              <Link href="/calendar" className="button-secondary">
                Open Calendar
              </Link>
            </div>
          </section>
        ) : null}
      </main>
    </RequireAuth>
  );
}
