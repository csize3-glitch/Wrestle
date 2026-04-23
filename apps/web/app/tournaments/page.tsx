"use client";

import { useEffect, useState } from "react";
import { db } from "@wrestlewell/firebase/client";
import {
  createTeamNotification,
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
  eventDate: string;
  notes: string;
};

function createEmptyForm(): TournamentFormState {
  return {
    name: "",
    registrationUrl: "",
    eventDate: "",
    notes: "",
  };
}

function formatEntryStatus(status: TournamentEntry["status"]) {
  if (status === "planned") return "Planned";
  if (status === "submitted") return "Submitted";
  return "Verified";
}

export default function TournamentsPage() {
  const { appUser, currentTeam, firebaseUser } = useAuthState();
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
  const activeTournament =
    tournaments.find((tournament) => tournament.id === activeTournamentId) || null;
  const canDirectlyEditActiveTournament =
    !activeTournament || activeTournament.teamId === currentTeam?.id || activeTournament.source === "manual";
  const ownWrestler =
    appUser?.role === "athlete" && firebaseUser
      ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) || null
      : null;
  const ownEntry =
    appUser?.role === "athlete" && ownWrestler
      ? entries.find((entry) => entry.wrestlerId === ownWrestler.id) || null
      : null;
  const plannedCount = entries.filter((entry) => entry.status === "planned").length;
  const submittedCount = entries.filter((entry) => entry.status === "submitted").length;
  const verifiedCount = entries.filter((entry) => entry.status === "confirmed").length;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const search = new URLSearchParams(window.location.search);
    const requestedTournamentId = search.get("open");
    if (!requestedTournamentId) {
      return;
    }

    setActiveTournamentId(requestedTournamentId);
  }, []);

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
        eventDate: selected.eventDate || "",
        notes: selected.notes || "",
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

      if (activeTournamentId && canDirectlyEditActiveTournament) {
        await updateTournament(db, activeTournamentId, {
          teamId: currentTeam.id,
          name: form.name,
          registrationUrl: form.registrationUrl,
          eventDate: form.eventDate,
          notes: form.notes,
          source: "manual",
        });
        await refreshTournaments(activeTournamentId);
        setStatusMessage({ tone: "success", text: "Tournament updated." });
      } else {
        const nextId = await createTournament(db, {
          teamId: currentTeam.id,
          name: form.name,
          registrationUrl: form.registrationUrl,
          eventDate: form.eventDate,
          notes: form.notes,
          source: "manual",
        });
        await refreshTournaments(nextId);
        setStatusMessage({
          tone: "success",
          text:
            activeTournamentId && !canDirectlyEditActiveTournament
              ? "A team-owned tournament copy was created so you can manage this event."
              : "Tournament created.",
        });
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
      if (status === "submitted" && appUser?.role === "athlete" && currentTeam?.id) {
        const tournament = tournaments.find((item) => item.id === entry.tournamentId);
        await createTeamNotification(db, {
          teamId: currentTeam.id,
          audienceRole: "coach",
          title: "Tournament registration submitted",
          body: `${entry.wrestlerName} marked themselves registered for ${tournament?.name || "a tournament"}. Please verify the USA Bracketing registration.`,
          type: "tournament_registration",
          createdBy: firebaseUser?.uid || "",
          tournamentId: entry.tournamentId,
          tournamentEntryId: entry.id,
          wrestlerId: entry.wrestlerId,
        });
      }
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

  async function athleteRegisterCurrentTournament() {
    if (!currentTeam?.id || !activeTournamentId) {
      setStatusMessage({ tone: "error", text: "Open a tournament first." });
      return;
    }

    if (!ownWrestler) {
      setStatusMessage({
        tone: "error",
        text: "Create your wrestler profile before marking yourself registered.",
      });
      return;
    }

    try {
      setSavingEntry(true);

      if (ownEntry) {
        if (ownEntry.status === "submitted" || ownEntry.status === "confirmed") {
          setStatusMessage({
            tone: "info",
            text:
              ownEntry.status === "confirmed"
                ? "Your coach has already verified this tournament registration."
                : "You already marked yourself registered for this tournament.",
          });
          return;
        }

        await updateTournamentEntryStatus(db, ownEntry, "submitted");
        await createTeamNotification(db, {
          teamId: currentTeam.id,
          audienceRole: "coach",
          title: "Tournament registration submitted",
          body: `${ownEntry.wrestlerName} marked themselves registered for ${tournaments.find((item) => item.id === activeTournamentId)?.name || "a tournament"}. Please verify the USA Bracketing registration.`,
          type: "tournament_registration",
          createdBy: firebaseUser?.uid || "",
          tournamentId: activeTournamentId,
          tournamentEntryId: ownEntry.id,
          wrestlerId: ownEntry.wrestlerId,
        });
      } else {
        const entryId = await createTournamentEntry(db, {
          teamId: currentTeam.id,
          tournamentId: activeTournamentId,
          wrestlerId: ownWrestler.id,
          wrestlerName: `${ownWrestler.firstName} ${ownWrestler.lastName}`.trim(),
          style: ownWrestler.styles[0],
          weightClass: ownWrestler.weightClass,
          status: "submitted",
        });
        await createTeamNotification(db, {
          teamId: currentTeam.id,
          audienceRole: "coach",
          title: "Tournament registration submitted",
          body: `${ownWrestler.firstName} ${ownWrestler.lastName} marked themselves registered for ${tournaments.find((item) => item.id === activeTournamentId)?.name || "a tournament"}. Please verify the USA Bracketing registration.`,
          type: "tournament_registration",
          createdBy: firebaseUser?.uid || "",
          tournamentId: activeTournamentId,
          tournamentEntryId: entryId,
          wrestlerId: ownWrestler.id,
        });
      }

      await refreshEntries(activeTournamentId);
      setStatusMessage({
        tone: "success",
        text: "Registration submitted. Your coach has been notified to verify it.",
      });
    } catch (error) {
      console.error("Failed to mark athlete registered:", error);
      setStatusMessage({ tone: "error", text: "Failed to submit your tournament registration." });
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
              text: "Athletes can open registration links and mark themselves registered. Coaches still verify the final USA Bracketing registration.",
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
                    {tournament.eventDate ? (
                      <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
                        Date: {tournament.eventDate}
                      </div>
                    ) : null}
                    <button
                      onClick={() => {
                        setActiveTournamentId(tournament.id);
                        setForm({
                          name: tournament.name,
                          registrationUrl: tournament.registrationUrl,
                          eventDate: tournament.eventDate || "",
                          notes: tournament.notes || "",
                        });
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
              {isCoach && activeTournamentId && !canDirectlyEditActiveTournament ? (
                <StatusBanner
                  message={{
                    tone: "info",
                    text: "This event came from the shared tournament import. Saving will create a team-owned copy you can edit and manage.",
                  }}
                />
              ) : null}

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

              <label style={{ display: "grid", gap: 6 }}>
                <span>Tournament date</span>
                <input
                  type="date"
                  value={form.eventDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, eventDate: e.target.value }))}
                  disabled={!isCoach}
                  style={{ padding: 10 }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span>Tournament notes</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  disabled={!isCoach}
                  rows={3}
                  style={{ padding: 10, resize: "vertical" }}
                />
              </label>

              {form.registrationUrl ? (
                <a href={form.registrationUrl} target="_blank" rel="noreferrer" className="button-secondary">
                  Open Registration Page
                </a>
              ) : null}

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button onClick={saveTournament} disabled={saving || !isCoach} className="button-primary">
                  {saving
                    ? "Saving..."
                    : activeTournamentId
                      ? canDirectlyEditActiveTournament
                        ? "Update Tournament"
                        : "Save as Team Event"
                      : "Create Tournament"}
                </button>

                <button onClick={startNewTournament} disabled={!isCoach} className="button-secondary">
                  Reset
                </button>

                {isCoach && activeTournamentId && canDirectlyEditActiveTournament ? (
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

              {!isCoach && activeTournamentId ? (
                <div
                  style={{
                    marginTop: 4,
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 14,
                    background: "#f8fafc",
                  }}
                >
                  <strong style={{ display: "block", marginBottom: 8 }}>My Registration</strong>
                  <div style={{ color: "#555", marginBottom: 12, fontSize: 14 }}>
                    {ownEntry
                      ? `Current status: ${formatEntryStatus(ownEntry.status)}`
                      : ownWrestler
                        ? "You are not listed for this tournament yet."
                        : "Create your wrestler profile first so we can match you to a tournament entry."}
                  </div>
                  <button
                    onClick={athleteRegisterCurrentTournament}
                    disabled={savingEntry || !ownWrestler || ownEntry?.status === "submitted" || ownEntry?.status === "confirmed"}
                    className="button-primary"
                  >
                    {savingEntry
                      ? "Saving..."
                      : ownEntry?.status === "confirmed"
                        ? "Verified"
                        : ownEntry?.status === "submitted"
                          ? "Submitted"
                          : "I Registered"}
                  </button>
                </div>
              ) : null}
              {activeTournamentId ? (
                <div
                  style={{
                    marginTop: 20,
                    borderTop: "1px solid #e5e7eb",
                    paddingTop: 20,
                    display: "grid",
                    gap: 16,
                  }}
                >
                  <div>
                    <h2 style={{ marginTop: 0, marginBottom: 8 }}>Tournament Roster</h2>
                    <p style={{ color: "#666", fontSize: 14, marginBottom: 0 }}>
                      Verify registrations and keep the full attending roster in one place.
                    </p>
                    {form.eventDate ? (
                      <p style={{ color: "#0f2748", fontSize: 14, marginTop: 10, marginBottom: 0 }}>
                        Event date: <strong>{form.eventDate}</strong>
                      </p>
                    ) : null}
                    {form.notes ? (
                      <p style={{ color: "#555", fontSize: 14, marginTop: 8, marginBottom: 0 }}>
                        {form.notes}
                      </p>
                    ) : null}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {[
                      { label: "Attending", value: entries.length },
                      { label: "Planned", value: plannedCount },
                      { label: "Submitted", value: submittedCount },
                      { label: "Verified", value: verifiedCount },
                    ].map((item) => (
                      <div
                        key={item.label}
                        style={{
                          border: "1px solid #e5e7eb",
                          borderRadius: 12,
                          padding: 14,
                          background: "#f8fafc",
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          {item.label}
                        </div>
                        <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", marginTop: 6 }}>{item.value}</div>
                      </div>
                    ))}
                  </div>

                  {isCoach ? (
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
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
                  ) : null}

                  {entries.length === 0 ? (
                    <p>{isCoach ? "No wrestlers added to this tournament yet." : "You are not listed for this tournament yet."}</p>
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
                          ) : ownWrestler?.id === entry.wrestlerId ? (
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                              {entry.status === "planned" ? (
                                <button
                                  onClick={() => athleteRegisterCurrentTournament()}
                                  disabled={savingEntry}
                                  className="button-primary"
                                >
                                  {savingEntry ? "Saving..." : "I Registered"}
                                </button>
                              ) : (
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    padding: "8px 12px",
                                    borderRadius: 999,
                                    background: entry.status === "confirmed" ? "#d7f4df" : "#f5d7dc",
                                    color: entry.status === "confirmed" ? "#166534" : "#911022",
                                    fontWeight: 700,
                                  }}
                                >
                                  {entry.status === "confirmed" ? "Verified by Coach" : "Submitted"}
                                </span>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </main>
    </RequireAuth>
  );
}
