"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@wrestlewell/firebase/client";
import {
  WRESTLING_STYLES,
  createWrestler,
  deleteWrestler,
  emptyMatSideSummary,
  getMatSideSummary,
  listWrestlers,
  removeMatSideSummary,
  updateWrestler,
  upsertMatSideSummary,
  type MatSideSummaryInput,
  type WrestlerInput,
} from "@wrestlewell/lib/index";
import type { MatSideSummary, WrestlerProfile, WrestlingStyle } from "@wrestlewell/types/index";
import { RequireAuth } from "../require-auth";
import { useAuthState } from "../auth-provider";
import { StatusBanner, type StatusMessage } from "../status-banner";

type WrestlerFormState = {
  firstName: string;
  lastName: string;
  age: string;
  grade: string;
  weightClass: string;
  schoolOrClub: string;
  photoUrl: string;
  styles: WrestlingStyle[];
  strengths: string;
  weaknesses: string;
  warmupRoutine: string;
  keyAttacks: string;
  keyDefense: string;
  goals: string;
  coachNotes: string;
};

type MatSideFormState = {
  quickReminders: string;
  warmupChecklist: string;
  strengths: string;
  weaknesses: string;
  gamePlan: string;
  recentNotes: string;
};

function createEmptyForm(): WrestlerFormState {
  return {
    firstName: "",
    lastName: "",
    age: "",
    grade: "",
    weightClass: "",
    schoolOrClub: "",
    photoUrl: "",
    styles: [],
    strengths: "",
    weaknesses: "",
    warmupRoutine: "",
    keyAttacks: "",
    keyDefense: "",
    goals: "",
    coachNotes: "",
  };
}

function createEmptyMatSideForm(): MatSideFormState {
  return {
    quickReminders: "",
    warmupChecklist: "",
    strengths: "",
    weaknesses: "",
    gamePlan: "",
    recentNotes: "",
  };
}

function toTextareaValue(values: string[]) {
  return values.join("\n");
}

function parseList(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildFormFromWrestler(wrestler: WrestlerProfile): WrestlerFormState {
  return {
    firstName: wrestler.firstName,
    lastName: wrestler.lastName,
    age: wrestler.age ? String(wrestler.age) : "",
    grade: wrestler.grade || "",
    weightClass: wrestler.weightClass || "",
    schoolOrClub: wrestler.schoolOrClub || "",
    photoUrl: wrestler.photoUrl || "",
    styles: wrestler.styles,
    strengths: toTextareaValue(wrestler.strengths),
    weaknesses: toTextareaValue(wrestler.weaknesses),
    warmupRoutine: toTextareaValue(wrestler.warmupRoutine),
    keyAttacks: toTextareaValue(wrestler.keyAttacks),
    keyDefense: toTextareaValue(wrestler.keyDefense),
    goals: toTextareaValue(wrestler.goals),
    coachNotes: wrestler.coachNotes || "",
  };
}

function buildMatSideForm(summary: MatSideSummary | null): MatSideFormState {
  const baseSummary = summary ?? emptyMatSideSummary("");

  return {
    quickReminders: toTextareaValue(baseSummary.quickReminders),
    warmupChecklist: toTextareaValue(baseSummary.warmupChecklist),
    strengths: toTextareaValue(baseSummary.strengths),
    weaknesses: toTextareaValue(baseSummary.weaknesses),
    gamePlan: toTextareaValue(baseSummary.gamePlan),
    recentNotes: toTextareaValue(baseSummary.recentNotes),
  };
}

function buildPayload(form: WrestlerFormState, teamId: string, ownerUserId?: string): WrestlerInput {
  const ageValue = Number(form.age);

  return {
    teamId,
    ownerUserId,
    firstName: form.firstName,
    lastName: form.lastName,
    age: form.age.trim() && Number.isFinite(ageValue) ? ageValue : undefined,
    grade: form.grade,
    weightClass: form.weightClass,
    schoolOrClub: form.schoolOrClub,
    photoUrl: form.photoUrl,
    styles: form.styles,
    strengths: parseList(form.strengths),
    weaknesses: parseList(form.weaknesses),
    warmupRoutine: parseList(form.warmupRoutine),
    keyAttacks: parseList(form.keyAttacks),
    keyDefense: parseList(form.keyDefense),
    goals: parseList(form.goals),
    coachNotes: form.coachNotes,
  };
}

function buildMatSidePayload(form: MatSideFormState): MatSideSummaryInput {
  return {
    quickReminders: parseList(form.quickReminders),
    warmupChecklist: parseList(form.warmupChecklist),
    strengths: parseList(form.strengths),
    weaknesses: parseList(form.weaknesses),
    gamePlan: parseList(form.gamePlan),
    recentNotes: parseList(form.recentNotes),
  };
}

function snapshotForm(form: WrestlerFormState) {
  return JSON.stringify({
    ...form,
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    grade: form.grade.trim(),
    weightClass: form.weightClass.trim(),
    schoolOrClub: form.schoolOrClub.trim(),
    photoUrl: form.photoUrl.trim(),
    coachNotes: form.coachNotes.trim(),
  });
}

function snapshotMatSideForm(form: MatSideFormState) {
  return JSON.stringify({
    quickReminders: parseList(form.quickReminders),
    warmupChecklist: parseList(form.warmupChecklist),
    strengths: parseList(form.strengths),
    weaknesses: parseList(form.weaknesses),
    gamePlan: parseList(form.gamePlan),
    recentNotes: parseList(form.recentNotes),
  });
}

export default function WrestlersPage() {
  const { appUser, currentTeam, firebaseUser } = useAuthState();
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeWrestlerId, setActiveWrestlerId] = useState<string | null>(null);
  const [form, setForm] = useState<WrestlerFormState>(createEmptyForm);
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshotForm(createEmptyForm()));
  const [matSideForm, setMatSideForm] = useState<MatSideFormState>(createEmptyMatSideForm);
  const [savedMatSideSnapshot, setSavedMatSideSnapshot] = useState(() =>
    snapshotMatSideForm(createEmptyMatSideForm())
  );
  const [loadingMatSide, setLoadingMatSide] = useState(false);
  const [savingMatSide, setSavingMatSide] = useState(false);
  const [matSideExists, setMatSideExists] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const isCoach = appUser?.role === "coach";

  async function refreshWrestlers(nextSelectedId?: string | null) {
    if (!currentTeam?.id) {
      setWrestlers([]);
      setActiveWrestlerId(null);
      const emptyForm = createEmptyForm();
      setForm(emptyForm);
      setSavedSnapshot(snapshotForm(emptyForm));
      return;
    }

    const rows = await listWrestlers(db, currentTeam.id);
    setWrestlers(rows);

    const ownWrestler =
      appUser?.role === "athlete" && firebaseUser
        ? rows.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid)
        : null;

    const selectedId = nextSelectedId ?? activeWrestlerId ?? ownWrestler?.id ?? null;
    const selected = rows.find((wrestler) => wrestler.id === selectedId);

    if (selected) {
      const nextForm = buildFormFromWrestler(selected);
      setActiveWrestlerId(selected.id);
      setForm(nextForm);
      setSavedSnapshot(snapshotForm(nextForm));
      return;
    }

    setActiveWrestlerId(null);
    const emptyForm = createEmptyForm();
    setForm(emptyForm);
    setSavedSnapshot(snapshotForm(emptyForm));
  }

  useEffect(() => {
    async function load() {
      try {
        await refreshWrestlers(null);
      } catch (error) {
        console.error("Failed to load wrestlers:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [appUser?.role, currentTeam?.id, firebaseUser?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function loadMatSide() {
      if (!activeWrestlerId) {
        const emptyForm = createEmptyMatSideForm();
        setMatSideForm(emptyForm);
        setSavedMatSideSnapshot(snapshotMatSideForm(emptyForm));
        setMatSideExists(false);
        return;
      }

      try {
        setLoadingMatSide(true);
        const summary = await getMatSideSummary(db, activeWrestlerId);
        const nextForm = buildMatSideForm(summary);
        setMatSideForm(nextForm);
        setSavedMatSideSnapshot(snapshotMatSideForm(nextForm));
        setMatSideExists(Boolean(summary));
      } catch (error) {
        console.error("Failed to load mat-side summary:", error);
      } finally {
        setLoadingMatSide(false);
      }
    }

    loadMatSide();
  }, [activeWrestlerId]);

  const activeWrestler = useMemo(
    () => wrestlers.find((wrestler) => wrestler.id === activeWrestlerId) || null,
    [activeWrestlerId, wrestlers]
  );
  const athleteOwnedWrestler = useMemo(
    () =>
      appUser?.role === "athlete" && firebaseUser
        ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) || null
        : null,
    [appUser?.role, firebaseUser, wrestlers]
  );
  const canEditActiveProfile = isCoach || (activeWrestler?.ownerUserId === firebaseUser?.uid && appUser?.role === "athlete");
  const profileCountLabel = `${wrestlers.length} wrestler${wrestlers.length === 1 ? "" : "s"}`;
  const hasUnsavedChanges = snapshotForm(form) !== savedSnapshot;
  const hasUnsavedMatSideChanges = snapshotMatSideForm(matSideForm) !== savedMatSideSnapshot;

  function updateField<K extends keyof WrestlerFormState>(field: K, value: WrestlerFormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateMatSideField<K extends keyof MatSideFormState>(field: K, value: MatSideFormState[K]) {
    setMatSideForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleStyle(style: WrestlingStyle) {
    setForm((prev) => ({
      ...prev,
      styles: prev.styles.includes(style)
        ? prev.styles.filter((item) => item !== style)
        : [...prev.styles, style],
    }));
  }

  function startNewProfile() {
    if (!isCoach && athleteOwnedWrestler) {
      setStatusMessage({ tone: "info", text: "Athletes can maintain one personal wrestler profile." });
      return;
    }
    setActiveWrestlerId(null);
    const emptyForm = createEmptyForm();
    setForm(emptyForm);
    setSavedSnapshot(snapshotForm(emptyForm));
  }

  function openProfile(wrestler: WrestlerProfile) {
    if (!isCoach && wrestler.ownerUserId !== firebaseUser?.uid) {
      setStatusMessage({ tone: "info", text: "Athletes can edit only their own wrestler profile." });
      return;
    }
    const nextForm = buildFormFromWrestler(wrestler);
    setActiveWrestlerId(wrestler.id);
    setForm(nextForm);
    setSavedSnapshot(snapshotForm(nextForm));
  }

  async function saveProfile() {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setStatusMessage({ tone: "error", text: "Please enter both first and last name." });
      return;
    }

    try {
      setSaving(true);
      if (!currentTeam?.id) {
        setStatusMessage({ tone: "error", text: "You need an active team before saving wrestlers." });
        return;
      }

      const payload = buildPayload(
        form,
        currentTeam.id,
        isCoach ? activeWrestler?.ownerUserId : firebaseUser?.uid
      );

      if (activeWrestlerId) {
        if (!canEditActiveProfile) {
          setStatusMessage({ tone: "error", text: "You can edit only your own wrestler profile." });
          return;
        }
        await updateWrestler(db, activeWrestlerId, payload);
        await refreshWrestlers(activeWrestlerId);
        setStatusMessage({ tone: "success", text: "Wrestler profile updated." });
      } else {
        const newId = await createWrestler(db, payload);
        await refreshWrestlers(newId);
        setStatusMessage({ tone: "success", text: "Wrestler profile created." });
      }
    } catch (error) {
      console.error("Failed to save wrestler profile:", error);
      setStatusMessage({ tone: "error", text: "Failed to save wrestler profile." });
    } finally {
      setSaving(false);
    }
  }

  async function removeProfile(wrestlerId: string) {
    if (!isCoach) {
      setStatusMessage({ tone: "info", text: "Only coaches can delete wrestler profiles." });
      return;
    }
    const wrestler = wrestlers.find((item) => item.id === wrestlerId);
    const fullName = [wrestler?.firstName, wrestler?.lastName].filter(Boolean).join(" ");

    if (!window.confirm(`Delete ${fullName || "this wrestler"}?`)) {
      return;
    }

    try {
      setDeletingId(wrestlerId);
      await deleteWrestler(db, wrestlerId);
      await refreshWrestlers(activeWrestlerId === wrestlerId ? null : activeWrestlerId);
      setStatusMessage({ tone: "success", text: "Wrestler deleted." });
    } catch (error) {
      console.error("Failed to delete wrestler:", error);
      setStatusMessage({ tone: "error", text: "Failed to delete wrestler." });
    } finally {
      setDeletingId(null);
    }
  }

  async function saveMatSide() {
    if (!isCoach) {
      setStatusMessage({ tone: "info", text: "Mat-side summaries are coach-managed." });
      return;
    }
    if (!activeWrestler) {
      setStatusMessage({ tone: "error", text: "Save the wrestler profile first." });
      return;
    }

    try {
      setSavingMatSide(true);
      await upsertMatSideSummary(db, activeWrestler.id, buildMatSidePayload(matSideForm));
      setSavedMatSideSnapshot(snapshotMatSideForm(matSideForm));
      setMatSideExists(true);
      setStatusMessage({ tone: "success", text: "Mat-side summary updated." });
    } catch (error) {
      console.error("Failed to save mat-side summary:", error);
      setStatusMessage({ tone: "error", text: "Failed to save mat-side summary." });
    } finally {
      setSavingMatSide(false);
    }
  }

  async function clearMatSide() {
    if (!isCoach) {
      setStatusMessage({ tone: "info", text: "Mat-side summaries are coach-managed." });
      return;
    }
    if (!activeWrestler) {
      return;
    }

    if (!window.confirm(`Delete the mat-side summary for ${activeWrestler.firstName} ${activeWrestler.lastName}?`)) {
      return;
    }

    try {
      setSavingMatSide(true);
      await removeMatSideSummary(db, activeWrestler.id);
      const emptyForm = createEmptyMatSideForm();
      setMatSideForm(emptyForm);
      setSavedMatSideSnapshot(snapshotMatSideForm(emptyForm));
      setMatSideExists(false);
      setStatusMessage({ tone: "success", text: "Mat-side summary deleted." });
    } catch (error) {
      console.error("Failed to delete mat-side summary:", error);
      setStatusMessage({ tone: "error", text: "Failed to delete mat-side summary." });
    } finally {
      setSavingMatSide(false);
    }
  }

  return (
    <RequireAuth
      title="Wrestlers"
      description="Create shared wrestler profiles and coach-facing mat-side summaries for web and mobile."
    >
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Wrestlers</h1>
      <p style={{ marginBottom: 24 }}>
        Create shared wrestler profiles and coach-facing mat-side summaries for web and mobile.
      </p>

      {statusMessage ? (
        <StatusBanner message={statusMessage} onDismiss={() => setStatusMessage(null)} />
      ) : null}

      {!isCoach ? (
        <StatusBanner
          message={{
            tone: "info",
            text: athleteOwnedWrestler
              ? "You can update your own wrestler profile here. Mat-side and roster management stay coach-only."
              : "Create your own wrestler profile here. Roster management and mat-side tools stay coach-only.",
          }}
        />
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {[
          { label: "Roster", value: profileCountLabel },
          { label: "Editor", value: activeWrestler ? "Existing Profile" : "New Profile" },
          { label: "Mat-Side", value: activeWrestler ? (matSideExists ? "Saved" : "Using Fallback") : "Waiting" },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 14,
              background: "#fff",
            }}
          >
            <div style={{ fontSize: 12, textTransform: "uppercase", color: "#666", marginBottom: 6 }}>
              {item.label}
            </div>
            <strong style={{ fontSize: 18 }}>{item.value}</strong>
          </div>
        ))}
      </div>

      <div
        style={{
          marginBottom: 20,
          padding: "12px 14px",
          borderRadius: 12,
          border: "1px solid #ddd",
          background: hasUnsavedChanges || hasUnsavedMatSideChanges ? "#fff8e6" : "#f6f7f8",
          fontSize: 14,
        }}
      >
        {activeWrestler ? (
          <>
            Editing <strong>{activeWrestler.firstName} {activeWrestler.lastName}</strong>.{" "}
            {hasUnsavedChanges || hasUnsavedMatSideChanges ? "You have unsaved changes." : "Everything is saved."}
          </>
        ) : hasUnsavedChanges ? (
          <>New wrestler draft in progress.</>
        ) : (
          <>Start a new profile or open an existing wrestler from the roster.</>
        )}
      </div>

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
            <h2 style={{ marginTop: 0, marginBottom: 0 }}>Roster</h2>
            {isCoach || !athleteOwnedWrestler ? (
              <button onClick={startNewProfile} style={{ padding: "8px 12px", cursor: "pointer" }}>
                {isCoach ? "New Wrestler" : "Create My Profile"}
              </button>
            ) : null}
          </div>

          <p style={{ color: "#666", fontSize: 14 }}>
            {isCoach
              ? "Shared profiles used by the web app and mobile app."
              : "Your team roster is visible here. You can edit only your own profile."}
          </p>

          {loading ? (
            <p>Loading wrestlers...</p>
          ) : wrestlers.length === 0 ? (
            <p>No wrestlers added yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {wrestlers.map((wrestler) => {
                const fullName = `${wrestler.firstName} ${wrestler.lastName}`.trim();

                return (
                  <div
                    key={wrestler.id}
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 10,
                      padding: 12,
                      background: activeWrestlerId === wrestler.id ? "#f5f5f5" : "#fff",
                    }}
                  >
                    <strong>{fullName || "Unnamed Wrestler"}</strong>
                    <div style={{ fontSize: 14, marginTop: 6 }}>
                      {[wrestler.weightClass, wrestler.grade, wrestler.schoolOrClub]
                        .filter(Boolean)
                        .join(" · ") || "Profile details in progress"}
                    </div>
                    <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
                      {(wrestler.styles.length ? wrestler.styles : ["No styles selected"]).join(", ")}
                    </div>
                    <button
                      onClick={() => openProfile(wrestler)}
                      style={{ marginTop: 10, padding: "8px 12px", cursor: "pointer" }}
                    >
                      {isCoach || wrestler.ownerUserId === firebaseUser?.uid ? "Open" : "View"}
                    </button>
                    {isCoach ? (
                      <button
                        onClick={() => removeProfile(wrestler.id)}
                        disabled={deletingId === wrestler.id}
                        style={{
                          marginTop: 10,
                          marginLeft: 8,
                          padding: "8px 12px",
                          cursor: "pointer",
                          color: "#8a1c1c",
                        }}
                      >
                        {deletingId === wrestler.id ? "Deleting..." : "Delete"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div style={{ display: "grid", gap: 24 }}>
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 16,
              background: "#fff",
            }}
          >
            <h2 style={{ marginTop: 0 }}>
              {activeWrestler ? (isCoach ? "Edit Profile" : "My Profile") : isCoach ? "Create Profile" : "Create My Profile"}
            </h2>

            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>First name</span>
                  <input
                    value={form.firstName}
                    onChange={(e) => updateField("firstName", e.target.value)}
                    disabled={!isCoach && Boolean(activeWrestler && !canEditActiveProfile)}
                    style={{ padding: 10 }}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span>Last name</span>
                  <input
                    value={form.lastName}
                    onChange={(e) => updateField("lastName", e.target.value)}
                    disabled={!isCoach && Boolean(activeWrestler && !canEditActiveProfile)}
                    style={{ padding: 10 }}
                  />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Age</span>
                  <input
                    type="number"
                    min={1}
                    value={form.age}
                    onChange={(e) => updateField("age", e.target.value)}
                    disabled={!isCoach && Boolean(activeWrestler && !canEditActiveProfile)}
                    style={{ padding: 10 }}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span>Grade</span>
                  <input
                    value={form.grade}
                    onChange={(e) => updateField("grade", e.target.value)}
                    disabled={!isCoach && Boolean(activeWrestler && !canEditActiveProfile)}
                    style={{ padding: 10 }}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span>Weight class</span>
                  <input
                    value={form.weightClass}
                    onChange={(e) => updateField("weightClass", e.target.value)}
                    disabled={!isCoach && Boolean(activeWrestler && !canEditActiveProfile)}
                    style={{ padding: 10 }}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span>School or club</span>
                  <input
                    value={form.schoolOrClub}
                    onChange={(e) => updateField("schoolOrClub", e.target.value)}
                    disabled={!isCoach && Boolean(activeWrestler && !canEditActiveProfile)}
                    style={{ padding: 10 }}
                  />
                </label>
              </div>

              <label style={{ display: "grid", gap: 6 }}>
                <span>Photo URL</span>
                <input
                  value={form.photoUrl}
                  onChange={(e) => updateField("photoUrl", e.target.value)}
                  disabled={!isCoach && Boolean(activeWrestler && !canEditActiveProfile)}
                  style={{ padding: 10 }}
                />
              </label>

              <div>
                <div style={{ marginBottom: 8, fontWeight: 600 }}>Styles</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {WRESTLING_STYLES.map((style) => (
                    <label
                      key={style}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        border: "1px solid #ddd",
                        borderRadius: 999,
                        padding: "8px 12px",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={form.styles.includes(style)}
                        onChange={() => toggleStyle(style)}
                        disabled={!isCoach && Boolean(activeWrestler && !canEditActiveProfile)}
                      />
                      <span>{style}</span>
                    </label>
                  ))}
                </div>
              </div>

              {[
                ["strengths", "Strengths"],
                ["weaknesses", "Weaknesses"],
                ["warmupRoutine", "Warm-up routine"],
                ["keyAttacks", "Key attacks"],
                ["keyDefense", "Key defense"],
                ["goals", "Goals"],
              ].map(([field, label]) => (
                <label key={field} style={{ display: "grid", gap: 6 }}>
                  <span>{label}</span>
                  <textarea
                    value={form[field as keyof WrestlerFormState] as string}
                    onChange={(e) => updateField(field as keyof WrestlerFormState, e.target.value as never)}
                    disabled={!isCoach && Boolean(activeWrestler && !canEditActiveProfile)}
                    rows={4}
                    placeholder="One item per line"
                    style={{ padding: 10, resize: "vertical" }}
                  />
                </label>
              ))}

              <label style={{ display: "grid", gap: 6 }}>
                <span>Coach notes</span>
                <textarea
                  value={form.coachNotes}
                  onChange={(e) => updateField("coachNotes", e.target.value)}
                  disabled={!isCoach}
                  rows={5}
                  style={{ padding: 10, resize: "vertical" }}
                />
              </label>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button
                  onClick={saveProfile}
                  disabled={saving}
                  style={{ padding: "10px 14px", cursor: "pointer" }}
                >
                  {saving ? "Saving..." : activeWrestler ? "Update Profile" : isCoach ? "Create Profile" : "Create My Profile"}
                </button>

                <button onClick={startNewProfile} style={{ padding: "10px 14px", cursor: "pointer" }}>
                  Reset Form
                </button>

                {isCoach && activeWrestler ? (
                  <button
                    onClick={() => removeProfile(activeWrestler.id)}
                    disabled={deletingId === activeWrestler.id}
                    style={{ padding: "10px 14px", cursor: "pointer", color: "#8a1c1c" }}
                  >
                    {deletingId === activeWrestler.id ? "Deleting..." : "Delete Profile"}
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 16,
              background: "#fff",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Mat-Side Summary</h2>
            <p style={{ color: "#666", fontSize: 14, marginTop: 0 }}>
              Coach-facing bullets for warm-up, reminders, matchup plan, and recent notes.
            </p>

            {!isCoach ? (
              <p>Mat-side summaries are coach-only and will be prepared by your staff.</p>
            ) : !activeWrestler ? (
              <p>Save or open a wrestler profile to edit the mat-side summary.</p>
            ) : loadingMatSide ? (
              <p>Loading mat-side summary...</p>
            ) : (
              <div style={{ display: "grid", gap: 16 }}>
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid #ddd",
                    background: hasUnsavedMatSideChanges ? "#fff8e6" : "#f6f7f8",
                    fontSize: 14,
                  }}
                >
                  {matSideExists
                    ? hasUnsavedMatSideChanges
                      ? "Summary has unsaved changes."
                      : "Summary is saved."
                    : "No custom summary saved yet. Mobile will fall back to the wrestler profile until you save one."}
                </div>

                {[
                  ["quickReminders", "Quick reminders"],
                  ["warmupChecklist", "Warm-up checklist"],
                  ["strengths", "Strengths override"],
                  ["weaknesses", "Weaknesses override"],
                  ["gamePlan", "Game plan"],
                  ["recentNotes", "Recent notes"],
                ].map(([field, label]) => (
                  <label key={field} style={{ display: "grid", gap: 6 }}>
                    <span>{label}</span>
                    <textarea
                      value={matSideForm[field as keyof MatSideFormState]}
                      onChange={(e) =>
                        updateMatSideField(field as keyof MatSideFormState, e.target.value as never)
                      }
                      rows={4}
                      placeholder="One item per line"
                      style={{ padding: 10, resize: "vertical" }}
                    />
                  </label>
                ))}

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button
                    onClick={saveMatSide}
                    disabled={savingMatSide}
                    style={{ padding: "10px 14px", cursor: "pointer" }}
                  >
                    {savingMatSide ? "Saving..." : matSideExists ? "Update Summary" : "Save Summary"}
                  </button>

                  <button
                    onClick={() => {
                      const resetForm = buildMatSideForm(null);
                      setMatSideForm(resetForm);
                    }}
                    style={{ padding: "10px 14px", cursor: "pointer" }}
                  >
                    Clear Form
                  </button>

                  {matSideExists ? (
                    <button
                      onClick={clearMatSide}
                      disabled={savingMatSide}
                      style={{ padding: "10px 14px", cursor: "pointer", color: "#8a1c1c" }}
                    >
                      Delete Summary
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
    </RequireAuth>
  );
}
