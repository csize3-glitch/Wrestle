"use client";

import { useEffect, useState } from "react";
import { db } from "@wrestlewell/firebase/client";
import {
  createTournament,
  createTournamentEntry,
  deleteTournament,
  deleteTournamentEntry,
  listTournaments,
  listTournamentEntries,
  listWrestlers,
  updateTournament,
  updateTournamentEntryStatus,
} from "@wrestlewell/lib/index";
import type { Tournament, TournamentEntry, WrestlerProfile } from "@wrestlewell/types/index";
import { RequireAuth } from "../require-auth";
import { useAuthState } from "../auth-provider";
import { StatusBanner, type StatusMessage } from "../status-banner";

type TournamentFormState = {
  name: string;
  registrationUrl: string;
};

function createEmptyForm(): TournamentFormState {
  return {
    name: "",
    registrationUrl: "",
  };
}

function formatEntryStatus(status: TournamentEntry["status"]) {
  if (status === "planned") return "Planned";
  if (status === "submitted") return "Submitted";
  return "Verified";
}

export default function TournamentsPage() {
  const { appUser, currentTeam } = useAuthState();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [entries, setEntries] = useState<TournamentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingEntry, setSavingEntry] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [activeTournamentId, setActiveTournamentId] = useState<string | null>(null);
  const [form, setForm] = useState<TournamentFormState>(createEmptyForm);
  const [selectedWrestlerId, setSelectedWrestlerId] = useState("");
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const isCoach = appUser?.role === "coach";

  async function refreshTournaments(nextSelectedId?: string | null) {
    if (!currentTeam?.id) {
      setTournaments([]);
      setActiveTournamentId(null);
      setForm(createEmptyForm());
      return;
    }

    const rows = await listTournaments(db, currentTeam.id);
    setTournaments(rows);

    const selectedId = nextSelectedId ?? activeTournamentId;
    const selected = rows.find((tournament) => tournament.id === selectedId);

    if (selected) {
      setActiveTournamentId(selected.id);
      setForm({
        name: selected.name,
        registrationUrl: selected.registrationUrl,
      });
      return;
    }

    setActiveTournamentId(null);
    setForm(createEmptyForm());
  }

  async function refreshWrestlers() {
    if (!currentTeam?.id) {
      setWrestlers([]);
      return;
    }

    setWrestlers(await listWrestlers(db, currentTeam.id));
  }

  async function refreshEntries(tournamentId: string | null) {
    if (!currentTeam?.id || !tournamentId) {
      setEntries([]);
      return;
    }

    setEntries(await listTournamentEntries(db, { teamId: currentTeam.id, tournamentId }));
  }

  useEffect(() => {
    async function load() {
      try {
        await refreshTournaments(null);
        await refreshWrestlers();
      } catch (error) {
        console.error("Failed to load tournaments:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [currentTeam?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refreshEntries(activeTournamentId).catch((error) => {
      console.error("Failed to load tournament entries:", error);
    });
  }, [activeTournamentId, currentTeam?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function startNewTournament() {
    setActiveTournamentId(null);
    setForm(createEmptyForm());
  }

  async function saveTournament() {
    if (!form.name.trim() || !form.registrationUrl.trim()) {
      setStatusMessage({ tone: "error", text: "Please enter both tournament name and registration URL." });
      return;
    }

    try {
      if (!currentTeam?.id) {
        setStatusMessage({ tone: "error", text: "You need an active team before saving tournaments." });
        return;
      }
      setSaving(true);

      if (activeTournamentId) {
        await updateTournament(db, activeTournamentId, {
          teamId: currentTeam.id,
          name: form.name,
          registrationUrl: form.registrationUrl,
          source: "manual",
        });
        await refreshTournaments(activeTournamentId);
        setStatusMessage({ tone: "success", text: "Tournament updated." });
      } else {
        const nextId = await createTournament(db, {
          teamId: currentTeam.id,
          name: form.name,
          registrationUrl: form.registrationUrl,
          source: "manual",
        });
        await refreshTournaments(nextId);
        setStatusMessage({ tone: "success", text: "Tournament created." });
      }
    } catch (error) {
      console.error("Failed to save tournament:", error);
      setStatusMessage({ tone: "error", text: "Failed to save tournament." });
    } finally {
      setSaving(false);
    }
  }

  async function removeTournament(tournamentId: string) {
    const tournament = tournaments.find((item) => item.id === tournamentId);

    if (!window.confirm(`Delete ${tournament?.name || "this tournament"}?`)) {
      return;
    }

    try {
      setDeletingId(tournamentId);
      await deleteTournament(db, tournamentId);
      await refreshTournaments(activeTournamentId === tournamentId ? null : activeTournamentId);
      setStatusMessage({ tone: "success", text: "Tournament deleted." });
    } catch (error) {
      console.error("Failed to delete tournament:", error);
      setStatusMessage({ tone: "error", text: "Failed to delete tournament." });
    } finally {
      setDeletingId(null);
    }
  }

  async function addEntry() {
    if (!currentTeam?.id || !activeTournamentId) {
      setStatusMessage({ tone: "error", text: "Open a tournament first." });
      return;
    }

    if (!selectedWrestlerId) {
      setStatusMessage({ tone: "error", text: "Choose a wrestler to add." });
      return;
    }

    const wrestler = wrestlers.find((item) => item.id === selectedWrestlerId);
    if (!wrestler) {
      setStatusMessage({ tone: "error", text: "Wrestler not found." });
      return;
    }

    const alreadyAdded = entries.some((entry) => entry.wrestlerId === wrestler.id);
    if (alreadyAdded) {
      setStatusMessage({ tone: "info", text: "That wrestler is already entered in this tournament." });
      return;
    }

    try {
      setSavingEntry(true);
      await createTournamentEntry(db, {
        teamId: currentTeam.id,
        tournamentId: activeTournamentId,
        wrestlerId: wrestler.id,
        wrestlerName: `${wrestler.firstName} ${wrestler.lastName}`.trim(),
        style: wrestler.styles[0],
        weightClass: wrestler.weightClass,
        status: "planned",
      });
      setSelectedWrestlerId("");
      await refreshEntries(activeTournamentId);
      setStatusMessage({ tone: "success", text: "Wrestler added to tournament roster." });
    } catch (error) {
      console.error("Failed to add tournament entry:", error);
      setStatusMessage({ tone: "error", text: "Failed to add tournament entry." });
    } finally {
      setSavingEntry(false);
    }
  }

  async function removeEntry(entryId: string) {
    try {
      setDeletingEntryId(entryId);
      await deleteTournamentEntry(db, entryId);
      await refreshEntries(activeTournamentId);
      setStatusMessage({ tone: "success", text: "Tournament roster entry removed." });
    } catch (error) {
      console.error("Failed to remove tournament entry:", error);
      setStatusMessage({ tone: "error", text: "Failed to remove tournament entry." });
    } finally {
      setDeletingEntryId(null);
    }
  }

  async function setEntryStatus(entry: TournamentEntry, status: TournamentEntry["status"]) {
    try {
      setSavingEntry(true);
      await updateTournamentEntryStatus(db, entry, status);
      await refreshEntries(activeTournamentId);
      setStatusMessage({
        tone: "success",
        text:
          status === "planned"
            ? "Tournament entry reset to planned."
            : status === "submitted"
              ? "Tournament entry marked submitted."
              : "Tournament entry verified.",
      });
    } catch (error) {
      console.error("Failed to update tournament entry status:", error);
      setStatusMessage({ tone: "error", text: "Failed to update tournament entry status." });
    } finally {
      setSavingEntry(false);
    }
  }

  return (
    <RequireAuth
      title="Tournament Hub"
      description="Manage tournament registration links for your season."
    >
      <main style={{ padding: 24 }}>
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>Tournament Hub</h1>
        <p style={{ marginBottom: 24 }}>
          Track upcoming events and jump directly to official registration pages.
        </p>

        {statusMessage ? (
          <StatusBanner message={statusMessage} onDismiss={() => setStatusMessage(null)} />
        ) : null}

        {!isCoach ? (
          <StatusBanner
            message={{
              tone: "info",
              text: "Tournaments are read-only for athletes. Coaches manage event links and tournament roster entries.",
            }}
          />
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "320px minmax(0, 1fr)",
            gap: 24,
            alignItems: "start",
          }}
        >
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 16,
              background: "#fff",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <h2 style={{ marginTop: 0, marginBottom: 0 }}>Events</h2>
              {isCoach ? (
                <button onClick={startNewTournament} style={{ padding: "8px 12px", cursor: "pointer" }}>
                  New Event
                </button>
              ) : null}
            </div>

            <p style={{ color: "#666", fontSize: 14 }}>
              Season registration links imported from your workbook or added manually.
            </p>

            {loading ? (
              <p>Loading tournaments...</p>
            ) : tournaments.length === 0 ? (
              <p>No tournaments added yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {tournaments.map((tournament) => (
                  <div
                    key={tournament.id}
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 10,
                      padding: 12,
                      background: activeTournamentId === tournament.id ? "#f5f5f5" : "#fff",
                    }}
                  >
                    <strong>{tournament.name}</strong>
                    <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
                      Source: {tournament.source === "excel_import" ? "Workbook import" : "Manual"}
                    </div>
                    <button
                      onClick={() => {
                        setActiveTournamentId(tournament.id);
                        setForm({ name: tournament.name, registrationUrl: tournament.registrationUrl });
                      }}
                      style={{ marginTop: 10, padding: "8px 12px", cursor: "pointer" }}
                    >
                      Open
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 16,
              background: "#fff",
            }}
          >
            <h2 style={{ marginTop: 0 }}>{activeTournamentId ? "Tournament Details" : "Add Tournament"}</h2>

            <div style={{ display: "grid", gap: 16 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Tournament name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  disabled={!isCoach}
                  style={{ padding: 10 }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span>Registration URL</span>
                <input
                  value={form.registrationUrl}
                  onChange={(e) => setForm((prev) => ({ ...prev, registrationUrl: e.target.value }))}
                  disabled={!isCoach}
                  style={{ padding: 10 }}
                />
              </label>

              {form.registrationUrl ? (
                <a href={form.registrationUrl} target="_blank" rel="noreferrer" className="button-secondary">
                  Open Registration Page
                </a>
              ) : null}

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button onClick={saveTournament} disabled={saving || !isCoach} className="button-primary">
                  {saving ? "Saving..." : activeTournamentId ? "Update Tournament" : "Create Tournament"}
                </button>

                <button onClick={startNewTournament} disabled={!isCoach} className="button-secondary">
                  Reset
                </button>

                {isCoach && activeTournamentId ? (
                  <button
                    onClick={() => removeTournament(activeTournamentId)}
                    disabled={deletingId === activeTournamentId}
                    className="button-secondary"
                    style={{ color: "#911022" }}
                  >
                    {deletingId === activeTournamentId ? "Deleting..." : "Delete"}
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          {activeTournamentId ? (
            <section
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: 16,
                background: "#fff",
              }}
            >
              <h2 style={{ marginTop: 0 }}>Tournament Roster</h2>
              <p style={{ color: "#666", fontSize: 14 }}>
                Link team wrestlers to this event so registrations, bout tracking, and future alerts have a real roster.
              </p>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <select
                  value={selectedWrestlerId}
                  onChange={(e) => setSelectedWrestlerId(e.target.value)}
                  disabled={!isCoach}
                  style={{ padding: 10, minWidth: 260 }}
                >
                  <option value="">Select wrestler</option>
                  {wrestlers.map((wrestler) => (
                    <option key={wrestler.id} value={wrestler.id}>
                      {wrestler.firstName} {wrestler.lastName}
                    </option>
                  ))}
                </select>

                <button onClick={addEntry} disabled={savingEntry || !isCoach} className="button-primary">
                  {savingEntry ? "Adding..." : "Add Wrestler"}
                </button>
              </div>

              {entries.length === 0 ? (
                <p>No wrestlers added to this tournament yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {entries.map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        border: "1px solid #eee",
                        borderRadius: 10,
                        padding: 12,
                        background: "#fafafa",
                      }}
                    >
                      <strong>{entry.wrestlerName}</strong>
                      <div style={{ fontSize: 14, marginTop: 6, color: "#555" }}>
                        {[entry.style, entry.weightClass, formatEntryStatus(entry.status)].filter(Boolean).join(" · ")}
                      </div>

                      {entry.notes ? (
                        <p style={{ marginTop: 8, marginBottom: 8 }}>{entry.notes}</p>
                      ) : null}

                      {isCoach ? (
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                          {entry.status !== "planned" ? (
                            <button
                              onClick={() => setEntryStatus(entry, "planned")}
                              disabled={savingEntry}
                              className="button-secondary"
                            >
                              Reset to Planned
                            </button>
                          ) : null}

                          {entry.status !== "submitted" ? (
                            <button
                              onClick={() => setEntryStatus(entry, "submitted")}
                              disabled={savingEntry}
                              className="button-secondary"
                            >
                              Mark Submitted
                            </button>
                          ) : null}

                          {entry.status !== "confirmed" ? (
                            <button
                              onClick={() => setEntryStatus(entry, "confirmed")}
                              disabled={savingEntry}
                              className="button-primary"
                            >
                              Verify External Registration
                            </button>
                          ) : null}

                          <button
                            onClick={() => removeEntry(entry.id)}
                            disabled={deletingEntryId === entry.id}
                            className="button-secondary"
                            style={{ color: "#911022" }}
                          >
                            {deletingEntryId === entry.id ? "Removing..." : "Remove Entry"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>
      </main>
    </RequireAuth>
  );
}
