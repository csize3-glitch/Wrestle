"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@wrestlewell/firebase/client";
import {
  WRESTLING_STYLES,
  createWrestlerMatch,
  createWrestler,
  deleteWrestlerMatch,
  deleteWrestler,
  emptyMatSideSummary,
  getAppUser,
  getMatSideSummary,
  listTrainingGroups,
  listWrestlerMatches,
  listWrestlers,
  removeMatSideSummary,
  updateWrestler,
  upsertMatSideSummary,
  type MatSideSummaryInput,
  type WrestlerInput,
} from "@wrestlewell/lib/index";
import type {
  AppUser,
  MatSideSummary,
  StyleMatSidePlans,
  StyleProfiles,
  TrainingGroup,
  VarkStyle,
  WrestlerMatch,
  WrestlerProfile,
  WrestlingStyle,
} from "@wrestlewell/types/index";
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
  trainingGroupIds: string[];
  primaryTrainingGroupId: string;
  strengths: string;
  weaknesses: string;
  warmupRoutine: string;
  keyAttacks: string;
  keyDefense: string;
  goals: string;
  coachNotes: string;
  styleProfiles: Record<WrestlingStyle, StyleFormState>;
};

type MatSideFormState = {
  quickReminders: string;
  warmupChecklist: string;
  strengths: string;
  weaknesses: string;
  gamePlan: string;
  recentNotes: string;
  stylePlans: Record<WrestlingStyle, StyleMatSideFormState>;
};

type StyleFormState = {
  strengths: string;
  weaknesses: string;
  keyAttacks: string;
  keyDefense: string;
  goals: string;
  coachNotes: string;
};

type StyleMatSideFormState = {
  quickReminders: string;
  focusPoints: string;
  gamePlan: string;
  recentNotes: string;
};

type MatchFormState = {
  eventName: string;
  opponentName: string;
  result: WrestlerMatch["result"];
  style: WrestlingStyle;
  weightClass: string;
  matchDate: string;
  score: string;
  method: string;
  notes: string;
};

function createEmptyStyleForm(): StyleFormState {
  return {
    strengths: "",
    weaknesses: "",
    keyAttacks: "",
    keyDefense: "",
    goals: "",
    coachNotes: "",
  };
}

function createEmptyStyleMatSideForm(): StyleMatSideFormState {
  return {
    quickReminders: "",
    focusPoints: "",
    gamePlan: "",
    recentNotes: "",
  };
}

function createEmptyStyleProfilesForm() {
  return Object.fromEntries(
    WRESTLING_STYLES.map((style) => [style, createEmptyStyleForm()])
  ) as Record<WrestlingStyle, StyleFormState>;
}

function createEmptyStylePlansForm() {
  return Object.fromEntries(
    WRESTLING_STYLES.map((style) => [style, createEmptyStyleMatSideForm()])
  ) as Record<WrestlingStyle, StyleMatSideFormState>;
}

function createEmptyMatchForm(): MatchFormState {
  return {
    eventName: "",
    opponentName: "",
    result: "win",
    style: "Folkstyle",
    weightClass: "",
    matchDate: "",
    score: "",
    method: "",
    notes: "",
  };
}

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
    trainingGroupIds: [],
    primaryTrainingGroupId: "",
    strengths: "",
    weaknesses: "",
    warmupRoutine: "",
    keyAttacks: "",
    keyDefense: "",
    goals: "",
    coachNotes: "",
    styleProfiles: createEmptyStyleProfilesForm(),
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
    stylePlans: createEmptyStylePlansForm(),
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
  const styleProfiles = createEmptyStyleProfilesForm();
  for (const style of WRESTLING_STYLES) {
    const section = wrestler.styleProfiles?.[style];
    styleProfiles[style] = {
      strengths: toTextareaValue(section?.strengths || []),
      weaknesses: toTextareaValue(section?.weaknesses || []),
      keyAttacks: toTextareaValue(section?.keyAttacks || []),
      keyDefense: toTextareaValue(section?.keyDefense || []),
      goals: toTextareaValue(section?.goals || []),
      coachNotes: section?.coachNotes || "",
    };
  }

  return {
    firstName: wrestler.firstName,
    lastName: wrestler.lastName,
    age: wrestler.age ? String(wrestler.age) : "",
    grade: wrestler.grade || "",
    weightClass: wrestler.weightClass || "",
    schoolOrClub: wrestler.schoolOrClub || "",
    photoUrl: wrestler.photoUrl || "",
    styles: wrestler.styles,
    trainingGroupIds: wrestler.trainingGroupIds || [],
    primaryTrainingGroupId: wrestler.primaryTrainingGroupId || "",
    strengths: toTextareaValue(wrestler.strengths),
    weaknesses: toTextareaValue(wrestler.weaknesses),
    warmupRoutine: toTextareaValue(wrestler.warmupRoutine),
    keyAttacks: toTextareaValue(wrestler.keyAttacks),
    keyDefense: toTextareaValue(wrestler.keyDefense),
    goals: toTextareaValue(wrestler.goals),
    coachNotes: wrestler.coachNotes || "",
    styleProfiles,
  };
}

function buildMatSideForm(summary: MatSideSummary | null): MatSideFormState {
  const baseSummary = summary ?? emptyMatSideSummary("");
  const stylePlans = createEmptyStylePlansForm();

  for (const style of WRESTLING_STYLES) {
    const section = baseSummary.stylePlans?.[style];
    stylePlans[style] = {
      quickReminders: toTextareaValue(section?.quickReminders || []),
      focusPoints: toTextareaValue(section?.focusPoints || []),
      gamePlan: toTextareaValue(section?.gamePlan || []),
      recentNotes: toTextareaValue(section?.recentNotes || []),
    };
  }

  return {
    quickReminders: toTextareaValue(baseSummary.quickReminders),
    warmupChecklist: toTextareaValue(baseSummary.warmupChecklist),
    strengths: toTextareaValue(baseSummary.strengths),
    weaknesses: toTextareaValue(baseSummary.weaknesses),
    gamePlan: toTextareaValue(baseSummary.gamePlan),
    recentNotes: toTextareaValue(baseSummary.recentNotes),
    stylePlans,
  };
}

function buildPayload(form: WrestlerFormState, teamId: string, ownerUserId?: string): WrestlerInput {
  const ageValue = Number(form.age);
  const styleProfiles = Object.fromEntries(
    WRESTLING_STYLES.map((style) => [
      style,
      {
        strengths: parseList(form.styleProfiles[style].strengths),
        weaknesses: parseList(form.styleProfiles[style].weaknesses),
        keyAttacks: parseList(form.styleProfiles[style].keyAttacks),
        keyDefense: parseList(form.styleProfiles[style].keyDefense),
        goals: parseList(form.styleProfiles[style].goals),
        coachNotes: form.styleProfiles[style].coachNotes.trim(),
      },
    ])
  ) as StyleProfiles;

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
    trainingGroupIds: form.trainingGroupIds,
    primaryTrainingGroupId: form.primaryTrainingGroupId || undefined,
    strengths: parseList(form.strengths),
    weaknesses: parseList(form.weaknesses),
    warmupRoutine: parseList(form.warmupRoutine),
    keyAttacks: parseList(form.keyAttacks),
    keyDefense: parseList(form.keyDefense),
    goals: parseList(form.goals),
    coachNotes: form.coachNotes,
    styleProfiles,
  };
}

function buildMatSidePayload(form: MatSideFormState): MatSideSummaryInput {
  const stylePlans = Object.fromEntries(
    WRESTLING_STYLES.map((style) => [
      style,
      {
        quickReminders: parseList(form.stylePlans[style].quickReminders),
        focusPoints: parseList(form.stylePlans[style].focusPoints),
        gamePlan: parseList(form.stylePlans[style].gamePlan),
        recentNotes: parseList(form.stylePlans[style].recentNotes),
      },
    ])
  ) as StyleMatSidePlans;

  return {
    quickReminders: parseList(form.quickReminders),
    warmupChecklist: parseList(form.warmupChecklist),
    strengths: parseList(form.strengths),
    weaknesses: parseList(form.weaknesses),
    gamePlan: parseList(form.gamePlan),
    recentNotes: parseList(form.recentNotes),
    stylePlans,
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
    trainingGroupIds: [...form.trainingGroupIds].sort(),
    primaryTrainingGroupId: form.primaryTrainingGroupId.trim(),
    styleProfiles: WRESTLING_STYLES.reduce<Record<string, unknown>>((acc, style) => {
      acc[style] = {
        strengths: parseList(form.styleProfiles[style].strengths),
        weaknesses: parseList(form.styleProfiles[style].weaknesses),
        keyAttacks: parseList(form.styleProfiles[style].keyAttacks),
        keyDefense: parseList(form.styleProfiles[style].keyDefense),
        goals: parseList(form.styleProfiles[style].goals),
        coachNotes: form.styleProfiles[style].coachNotes.trim(),
      };
      return acc;
    }, {}),
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
    stylePlans: WRESTLING_STYLES.reduce<Record<string, unknown>>((acc, style) => {
      acc[style] = {
        quickReminders: parseList(form.stylePlans[style].quickReminders),
        focusPoints: parseList(form.stylePlans[style].focusPoints),
        gamePlan: parseList(form.stylePlans[style].gamePlan),
        recentNotes: parseList(form.stylePlans[style].recentNotes),
      };
      return acc;
    }, {}),
  });
}

function getVarkStyleLabel(style?: VarkStyle | "") {
  switch (style) {
    case "visual":
      return "Visual learner";
    case "auditory":
      return "Auditory learner";
    case "readingWriting":
      return "Reading/Writing learner";
    case "kinesthetic":
      return "Kinesthetic learner";
    default:
      return "Not completed yet";
  }
}

function getVarkCoachCue(style?: VarkStyle | "", isMultimodal?: boolean) {
  if (isMultimodal) {
    return "Use a mix of demonstration, short verbal cues, quick checklist language, and live drilling.";
  }

  switch (style) {
    case "visual":
      return "Show the position first. Use video, diagrams, hand signals, and clear visual examples before correcting.";
    case "auditory":
      return "Explain the cue out loud. Keep the instruction short, repeat the key phrase, and confirm they can say it back.";
    case "readingWriting":
      return "Give short checklist cues. Use keywords, written goals, and simple step-by-step reminders.";
    case "kinesthetic":
      return "Demonstrate, drill, and let them feel the position. Use body-position corrections and quick reps.";
    default:
      return "Have the athlete complete WrestleWellIQ so coaches can match feedback to how they learn best.";
  }
}

function getWrestleWellIQSummary(user?: AppUser | null) {
  const profile = user?.varkProfile;

  if (!user || !user.varkCompleted || !profile) {
    return {
      label: "WrestleWellIQ not completed",
      cue: "Have this athlete complete WrestleWellIQ from their account so coaches can see their learning style.",
      completed: false,
    };
  }

  return {
    label: profile.isMultimodal
      ? `Multimodal learner: ${getVarkStyleLabel(profile.primaryStyle)} + ${getVarkStyleLabel(
          profile.secondaryStyle
        )}`
      : getVarkStyleLabel(profile.primaryStyle),
    cue: getVarkCoachCue(profile.primaryStyle, profile.isMultimodal),
    completed: true,
  };
}

export default function WrestlersPage() {
  const { appUser, currentTeam, firebaseUser } = useAuthState();
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [trainingGroups, setTrainingGroups] = useState<TrainingGroup[]>([]);
  const [wrestlerUsers, setWrestlerUsers] = useState<Record<string, AppUser>>({});
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
  const [activeStyleTab, setActiveStyleTab] = useState<WrestlingStyle>("Folkstyle");
  const [matches, setMatches] = useState<WrestlerMatch[]>([]);
  const [matchForm, setMatchForm] = useState<MatchFormState>(createEmptyMatchForm);
  const [savingMatch, setSavingMatch] = useState(false);
  const [deletingMatchId, setDeletingMatchId] = useState<string | null>(null);
  const [loadingMatSide, setLoadingMatSide] = useState(false);
  const [savingMatSide, setSavingMatSide] = useState(false);
  const [matSideExists, setMatSideExists] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const isCoach = appUser?.role === "coach";

  async function refreshWrestlers(nextSelectedId?: string | null) {
    if (!currentTeam?.id) {
      setWrestlers([]);
      setWrestlerUsers({});
      setActiveWrestlerId(null);
      const emptyForm = createEmptyForm();
      setForm(emptyForm);
      setSavedSnapshot(snapshotForm(emptyForm));
      return;
    }

    const rows = await listWrestlers(db, currentTeam.id);
    setWrestlers(rows);

    const ownerIds = Array.from(
      new Set(
        rows
          .map((wrestler) => wrestler.ownerUserId)
          .filter((ownerId): ownerId is string => Boolean(ownerId))
      )
    );

    const ownerUsers = await Promise.all(
      ownerIds.map(async (ownerId) => {
        try {
          return await getAppUser(db, ownerId);
        } catch (error) {
          console.error("Failed to load WrestleWellIQ profile for user:", ownerId, error);
          return null;
        }
      })
    );

    setWrestlerUsers(
      Object.fromEntries(
        ownerUsers
          .filter((user): user is AppUser => Boolean(user))
          .map((user) => [user.id, user])
      )
    );

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
    async function loadTrainingGroups() {
      if (!currentTeam?.id) {
        setTrainingGroups([]);
        return;
      }

      try {
        setTrainingGroups(await listTrainingGroups(db, currentTeam.id));
      } catch (error) {
        console.error("Failed to load training groups:", error);
      }
    }

    loadTrainingGroups();
  }, [currentTeam?.id]);

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

  const activeWrestlerUser = activeWrestler?.ownerUserId
    ? wrestlerUsers[activeWrestler.ownerUserId] || null
    : null;
  const trainingGroupNameById = useMemo(
    () =>
      Object.fromEntries(trainingGroups.map((group) => [group.id, group.name])) as Record<
        string,
        string
      >,
    [trainingGroups]
  );

  const activeWrestleWellIQ = getWrestleWellIQSummary(activeWrestlerUser);

  const athleteOwnedWrestler = useMemo(
    () =>
      appUser?.role === "athlete" && firebaseUser
        ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) || null
        : null,
    [appUser?.role, firebaseUser, wrestlers]
  );

  const canEditActiveProfile =
    isCoach || (activeWrestler?.ownerUserId === firebaseUser?.uid && appUser?.role === "athlete");
  const profileCountLabel = `${wrestlers.length} wrestler${wrestlers.length === 1 ? "" : "s"}`;
  const hasUnsavedChanges = snapshotForm(form) !== savedSnapshot;
  const hasUnsavedMatSideChanges = snapshotMatSideForm(matSideForm) !== savedMatSideSnapshot;
  const activeStyleProfile = form.styleProfiles[activeStyleTab];
  const activeStyleMatSide = matSideForm.stylePlans[activeStyleTab];
  const winCount = matches.filter((match) => match.result === "win").length;
  const lossCount = matches.filter((match) => match.result === "loss").length;

  function updateField<K extends keyof WrestlerFormState>(field: K, value: WrestlerFormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateMatSideField<K extends keyof MatSideFormState>(
    field: K,
    value: MatSideFormState[K]
  ) {
    setMatSideForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateStyleField<K extends keyof StyleFormState>(field: K, value: StyleFormState[K]) {
    setForm((prev) => ({
      ...prev,
      styleProfiles: {
        ...prev.styleProfiles,
        [activeStyleTab]: {
          ...prev.styleProfiles[activeStyleTab],
          [field]: value,
        },
      },
    }));
  }

  function updateStyleMatSideField<K extends keyof StyleMatSideFormState>(
    field: K,
    value: StyleMatSideFormState[K]
  ) {
    setMatSideForm((prev) => ({
      ...prev,
      stylePlans: {
        ...prev.stylePlans,
        [activeStyleTab]: {
          ...prev.stylePlans[activeStyleTab],
          [field]: value,
        },
      },
    }));
  }

  function toggleStyle(style: WrestlingStyle) {
    setForm((prev) => ({
      ...prev,
      styles: prev.styles.includes(style)
        ? prev.styles.filter((item) => item !== style)
        : [...prev.styles, style],
    }));
  }

  function toggleTrainingGroup(groupId: string) {
    setForm((prev) => {
      const alreadySelected = prev.trainingGroupIds.includes(groupId);
      const nextTrainingGroupIds = alreadySelected
        ? prev.trainingGroupIds.filter((entry) => entry !== groupId)
        : [...prev.trainingGroupIds, groupId];

      return {
        ...prev,
        trainingGroupIds: nextTrainingGroupIds,
        primaryTrainingGroupId:
          prev.primaryTrainingGroupId === groupId && alreadySelected
            ? ""
            : prev.primaryTrainingGroupId,
      };
    });
  }

  function resetMatchForm() {
    setMatchForm({
      ...createEmptyMatchForm(),
      style: form.styles[0] || activeStyleTab,
      weightClass: form.weightClass,
    });
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

  async function refreshMatches(wrestlerId: string | null) {
    if (!currentTeam?.id || !wrestlerId) {
      setMatches([]);
      return;
    }

    setMatches(await listWrestlerMatches(db, { teamId: currentTeam.id, wrestlerId }));
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

  async function saveMatch() {
    if (!isCoach) {
      setStatusMessage({ tone: "info", text: "Match history is coach-managed right now." });
      return;
    }
    if (!activeWrestler || !currentTeam?.id) {
      setStatusMessage({ tone: "error", text: "Open a wrestler profile before adding match history." });
      return;
    }
    if (!matchForm.eventName.trim() || !matchForm.opponentName.trim() || !matchForm.matchDate) {
      setStatusMessage({ tone: "error", text: "Event, opponent, and match date are required." });
      return;
    }

    try {
      setSavingMatch(true);
      await createWrestlerMatch(db, {
        teamId: currentTeam.id,
        wrestlerId: activeWrestler.id,
        eventName: matchForm.eventName,
        opponentName: matchForm.opponentName,
        result: matchForm.result,
        style: matchForm.style,
        weightClass: matchForm.weightClass,
        matchDate: matchForm.matchDate,
        score: matchForm.score,
        method: matchForm.method,
        notes: matchForm.notes,
      });
      await refreshMatches(activeWrestler.id);
      resetMatchForm();
      setStatusMessage({ tone: "success", text: "Match result added." });
    } catch (error) {
      console.error("Failed to save wrestler match:", error);
      setStatusMessage({ tone: "error", text: "Failed to save match history." });
    } finally {
      setSavingMatch(false);
    }
  }

  async function removeMatch(matchId: string) {
    if (!isCoach) {
      return;
    }

    if (!window.confirm("Delete this match result?")) {
      return;
    }

    try {
      setDeletingMatchId(matchId);
      await deleteWrestlerMatch(db, matchId);
      await refreshMatches(activeWrestlerId);
      setStatusMessage({ tone: "success", text: "Match result deleted." });
    } catch (error) {
      console.error("Failed to delete wrestler match:", error);
      setStatusMessage({ tone: "error", text: "Failed to delete match result." });
    } finally {
      setDeletingMatchId(null);
    }
  }

  useEffect(() => {
    if (form.styles.includes(activeStyleTab)) {
      return;
    }

    setActiveStyleTab(form.styles[0] || "Folkstyle");
  }, [activeStyleTab, form.styles]);

  useEffect(() => {
    refreshMatches(activeWrestlerId).catch((error) => {
      console.error("Failed to load wrestler matches:", error);
    });

    if (activeWrestler) {
      setMatchForm((prev) => ({
        ...prev,
        style: activeWrestler.styles[0] || prev.style,
        weightClass: activeWrestler.weightClass || prev.weightClass,
      }));
    } else {
      setMatchForm(createEmptyMatchForm());
    }
  }, [activeWrestler?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

        {activeWrestler ? (
          <section
            style={{
              marginBottom: 20,
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 16,
              background: activeWrestleWellIQ.completed ? "#eefdf4" : "#fff8e6",
            }}
          >
            <div style={{ fontSize: 12, textTransform: "uppercase", color: "#666", marginBottom: 6 }}>
              WrestleWellIQ Learning Profile
            </div>

            <strong style={{ fontSize: 20 }}>{activeWrestleWellIQ.label}</strong>

            <p style={{ marginBottom: 0, color: "#334155", lineHeight: 1.5 }}>
              {activeWrestleWellIQ.cue}
            </p>
          </section>
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

                      {(wrestler.trainingGroupIds?.length || wrestler.primaryTrainingGroupId) ? (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                          {Array.from(
                            new Set([
                              ...(wrestler.primaryTrainingGroupId ? [wrestler.primaryTrainingGroupId] : []),
                              ...(wrestler.trainingGroupIds || []),
                            ])
                          ).map((groupId) => (
                            <span
                              key={groupId}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                borderRadius: 999,
                                padding: "4px 10px",
                                fontSize: 12,
                                fontWeight: 700,
                                background:
                                  wrestler.primaryTrainingGroupId === groupId ? "#111827" : "#eef2ff",
                                color:
                                  wrestler.primaryTrainingGroupId === groupId ? "#ffffff" : "#312e81",
                              }}
                            >
                              {trainingGroupNameById[groupId] || "Training group"}
                              {wrestler.primaryTrainingGroupId === groupId ? " • Primary" : ""}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {wrestler.ownerUserId ? (
                        <div style={{ fontSize: 13, color: "#0f766e", marginTop: 6, fontWeight: 700 }}>
                          {getWrestleWellIQSummary(wrestlerUsers[wrestler.ownerUserId]).label}
                        </div>
                      ) : null}

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

                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    padding: 16,
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Training groups</div>
                  <p style={{ color: "#666", fontSize: 14, marginTop: 0, marginBottom: 12 }}>
                    Assign this wrestler to any number of coach-defined training groups. Primary group
                    is used as the main roster label and group-assignment fallback.
                  </p>

                  {trainingGroups.length === 0 ? (
                    <div style={{ fontSize: 14, color: "#666" }}>
                      No training groups created yet. Coaches can add them from the Calendar page.
                    </div>
                  ) : (
                    <>
                      <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                        <span>Primary training group</span>
                        <select
                          value={form.primaryTrainingGroupId}
                          onChange={(e) => updateField("primaryTrainingGroupId", e.target.value)}
                          disabled={!isCoach}
                          style={{ padding: 10 }}
                        >
                          <option value="">No primary group</option>
                          {trainingGroups
                            .filter((group) => group.active)
                            .map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name}
                              </option>
                            ))}
                        </select>
                      </label>

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {trainingGroups
                          .filter((group) => group.active)
                          .map((group) => (
                            <label
                              key={group.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                border: "1px solid #d1d5db",
                                borderRadius: 999,
                                padding: "8px 12px",
                                background: form.trainingGroupIds.includes(group.id)
                                  ? "#e0f2fe"
                                  : "#fff",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={form.trainingGroupIds.includes(group.id)}
                                onChange={() => toggleTrainingGroup(group.id)}
                                disabled={!isCoach}
                              />
                              <span>{group.name}</span>
                            </label>
                          ))}
                      </div>
                    </>
                  )}
                </div>

                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    padding: 16,
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Style-specific profile plan</div>
                  <p style={{ color: "#666", fontSize: 14, marginTop: 0, marginBottom: 12 }}>
                    Keep separate coaching notes for Folkstyle, Freestyle, and Greco-Roman so the profile feels match-ready for each style.
                  </p>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                    {WRESTLING_STYLES.map((style) => (
                      <button
                        key={style}
                        type="button"
                        onClick={() => setActiveStyleTab(style)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 999,
                          border: "1px solid #d1d5db",
                          background: activeStyleTab === style ? "#111827" : "#fff",
                          color: activeStyleTab === style ? "#fff" : "#111827",
                          cursor: "pointer",
                        }}
                      >
                        {style}
                      </button>
                    ))}
                  </div>

                  {[
                    ["strengths", `${activeStyleTab} strengths`],
                    ["weaknesses", `${activeStyleTab} weaknesses`],
                    ["keyAttacks", `${activeStyleTab} attacks`],
                    ["keyDefense", `${activeStyleTab} defense`],
                    ["goals", `${activeStyleTab} goals`],
                  ].map(([field, label]) => (
                    <label key={field} style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                      <span>{label}</span>
                      <textarea
                        value={activeStyleProfile[field as keyof StyleFormState] as string}
                        onChange={(e) => updateStyleField(field as keyof StyleFormState, e.target.value as never)}
                        disabled={!isCoach && Boolean(activeWrestler && !canEditActiveProfile)}
                        rows={3}
                        placeholder="One item per line"
                        style={{ padding: 10, resize: "vertical" }}
                      />
                    </label>
                  ))}

                  <label style={{ display: "grid", gap: 6 }}>
                    <span>{activeStyleTab} coach notes</span>
                    <textarea
                      value={activeStyleProfile.coachNotes}
                      onChange={(e) => updateStyleField("coachNotes", e.target.value)}
                      disabled={!isCoach}
                      rows={4}
                      style={{ padding: 10, resize: "vertical" }}
                    />
                  </label>
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

              {activeWrestler ? (
                <div
                  style={{
                    marginBottom: 16,
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid #cbd5e1",
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ fontSize: 12, textTransform: "uppercase", color: "#64748b", marginBottom: 6 }}>
                    WrestleWellIQ mat-side cue
                  </div>

                  <strong>{activeWrestleWellIQ.label}</strong>

                  <p style={{ margin: "6px 0 0", color: "#334155", lineHeight: 1.5 }}>
                    {activeWrestleWellIQ.cue}
                  </p>
                </div>
              ) : null}

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

                  <div
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 14,
                      padding: 16,
                      background: "#f8fafc",
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Style-specific mat-side plan</div>
                    <p style={{ color: "#666", fontSize: 14, marginTop: 0, marginBottom: 12 }}>
                      Build separate corner reminders and game plans for the current style so mobile prep stays specific.
                    </p>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                      {WRESTLING_STYLES.map((style) => (
                        <button
                          key={`mat-${style}`}
                          type="button"
                          onClick={() => setActiveStyleTab(style)}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 999,
                            border: "1px solid #d1d5db",
                            background: activeStyleTab === style ? "#111827" : "#fff",
                            color: activeStyleTab === style ? "#fff" : "#111827",
                            cursor: "pointer",
                          }}
                        >
                          {style}
                        </button>
                      ))}
                    </div>

                    {[
                      ["quickReminders", `${activeStyleTab} quick reminders`],
                      ["focusPoints", `${activeStyleTab} focus points`],
                      ["gamePlan", `${activeStyleTab} game plan`],
                      ["recentNotes", `${activeStyleTab} recent notes`],
                    ].map(([field, label]) => (
                      <label key={field} style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                        <span>{label}</span>
                        <textarea
                          value={activeStyleMatSide[field as keyof StyleMatSideFormState]}
                          onChange={(e) =>
                            updateStyleMatSideField(field as keyof StyleMatSideFormState, e.target.value as never)
                          }
                          rows={3}
                          placeholder="One item per line"
                          style={{ padding: 10, resize: "vertical" }}
                        />
                      </label>
                    ))}
                  </div>

                  {(
                    [
                      ["quickReminders", "Quick reminders"],
                      ["warmupChecklist", "Warm-up checklist"],
                      ["strengths", "Strengths override"],
                      ["weaknesses", "Weaknesses override"],
                      ["gamePlan", "Game plan"],
                      ["recentNotes", "Recent notes"],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field} style={{ display: "grid", gap: 6 }}>
                      <span>{label}</span>
                      <textarea
                        value={matSideForm[field]}
                        onChange={(e) => updateMatSideField(field, e.target.value)}
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

            <section
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: 16,
                background: "#fff",
              }}
            >
              <h2 style={{ marginTop: 0 }}>Match History</h2>
              <p style={{ color: "#666", fontSize: 14, marginTop: 0 }}>
                Track wins, losses, event history, notes, weight, and style right inside the wrestler workflow.
              </p>

              {!activeWrestler ? (
                <p>Open a wrestler to view or track match history.</p>
              ) : (
                <div style={{ display: "grid", gap: 18 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {[
                      { label: "Total Matches", value: String(matches.length) },
                      { label: "Wins", value: String(winCount) },
                      { label: "Losses", value: String(lossCount) },
                      { label: "Current Weight", value: activeWrestler.weightClass || "Not set" },
                    ].map((item) => (
                      <div
                        key={item.label}
                        style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: "#f8fafc" }}
                      >
                        <div style={{ fontSize: 12, textTransform: "uppercase", color: "#666", marginBottom: 6 }}>
                          {item.label}
                        </div>
                        <strong style={{ fontSize: 18 }}>{item.value}</strong>
                      </div>
                    ))}
                  </div>

                  {isCoach ? (
                    <div
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 14,
                        padding: 16,
                        background: "#f8fafc",
                        display: "grid",
                        gap: 12,
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>Add match result</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span>Event</span>
                          <input
                            value={matchForm.eventName}
                            onChange={(e) => setMatchForm((prev) => ({ ...prev, eventName: e.target.value }))}
                            style={{ padding: 10 }}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span>Opponent</span>
                          <input
                            value={matchForm.opponentName}
                            onChange={(e) => setMatchForm((prev) => ({ ...prev, opponentName: e.target.value }))}
                            style={{ padding: 10 }}
                          />
                        </label>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span>Date</span>
                          <input
                            type="date"
                            value={matchForm.matchDate}
                            onChange={(e) => setMatchForm((prev) => ({ ...prev, matchDate: e.target.value }))}
                            style={{ padding: 10 }}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span>Style</span>
                          <select
                            value={matchForm.style}
                            onChange={(e) => setMatchForm((prev) => ({ ...prev, style: e.target.value as WrestlingStyle }))}
                            style={{ padding: 10 }}
                          >
                            {WRESTLING_STYLES.map((style) => (
                              <option key={`match-style-${style}`} value={style}>
                                {style}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span>Result</span>
                          <select
                            value={matchForm.result}
                            onChange={(e) => setMatchForm((prev) => ({ ...prev, result: e.target.value as WrestlerMatch["result"] }))}
                            style={{ padding: 10 }}
                          >
                            <option value="win">Win</option>
                            <option value="loss">Loss</option>
                          </select>
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span>Weight</span>
                          <input
                            value={matchForm.weightClass}
                            onChange={(e) => setMatchForm((prev) => ({ ...prev, weightClass: e.target.value }))}
                            style={{ padding: 10 }}
                          />
                        </label>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span>Score</span>
                          <input
                            value={matchForm.score}
                            onChange={(e) => setMatchForm((prev) => ({ ...prev, score: e.target.value }))}
                            style={{ padding: 10 }}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span>Method</span>
                          <input
                            value={matchForm.method}
                            onChange={(e) => setMatchForm((prev) => ({ ...prev, method: e.target.value }))}
                            placeholder="Decision, fall, tech, etc."
                            style={{ padding: 10 }}
                          />
                        </label>
                      </div>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span>Notes</span>
                        <textarea
                          value={matchForm.notes}
                          onChange={(e) => setMatchForm((prev) => ({ ...prev, notes: e.target.value }))}
                          rows={3}
                          style={{ padding: 10, resize: "vertical" }}
                        />
                      </label>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <button onClick={saveMatch} disabled={savingMatch} style={{ padding: "10px 14px", cursor: "pointer" }}>
                          {savingMatch ? "Saving..." : "Add Match Result"}
                        </button>
                        <button onClick={resetMatchForm} style={{ padding: "10px 14px", cursor: "pointer" }}>
                          Reset Match Form
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p style={{ margin: 0 }}>Coaches manage match logging. Athletes can view the running history here.</p>
                  )}

                  {matches.length === 0 ? (
                    <p style={{ margin: 0 }}>No match history logged yet.</p>
                  ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                      {matches.map((match) => (
                        <article
                          key={match.id}
                          style={{
                            border: "1px solid #e5e7eb",
                            borderRadius: 12,
                            padding: 14,
                            background: "#fff",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                            <div>
                              <strong>
                                {match.result === "win" ? "Win" : "Loss"} vs. {match.opponentName}
                              </strong>
                              <div style={{ color: "#666", marginTop: 6, fontSize: 14 }}>
                                {[match.eventName, match.matchDate, match.style, match.weightClass, match.score, match.method]
                                  .filter(Boolean)
                                  .join(" • ")}
                              </div>
                              {match.notes ? (
                                <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5 }}>{match.notes}</div>
                              ) : null}
                            </div>

                            {isCoach ? (
                              <button
                                onClick={() => removeMatch(match.id)}
                                disabled={deletingMatchId === match.id}
                                style={{ padding: "8px 12px", cursor: "pointer", color: "#8a1c1c" }}
                              >
                                {deletingMatchId === match.id ? "Deleting..." : "Delete"}
                              </button>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
    </RequireAuth>
  );
}
