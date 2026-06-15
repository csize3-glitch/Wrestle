import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { db } from "@wrestlewell/firebase/client";
import {
  archiveAthleteGoal,
  completeAthleteGoal,
  createAthleteGoal,
  deleteAthleteGoal,
  getActiveSessionGoal,
  getActiveYearGoal,
  getCurrentGoalSession,
  getPracticeCheckInGoalForAttendance,
  listMyAthleteGoals,
  listWrestlersByOwnerUserId,
  updateAthleteGoal,
} from "@wrestlewell/lib/index";
import type {
  AthleteGoal,
  AthleteGoalSessionName,
  AthleteGoalStatus,
  AthleteGoalType,
  WrestlerProfile,
} from "@wrestlewell/types/index";
import {
  ATHLETE_GOAL_SESSION_NAMES,
  ATHLETE_GOAL_TYPES,
} from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell, WWBadge, WWCard } from "../components/mobile-screen-shell";

type GoalFormState = {
  type: AthleteGoalType;
  title: string;
  description: string;
  status: AthleteGoalStatus;
  sessionName?: AthleteGoalSessionName;
  seasonYear: string;
  practiceEventId?: string;
  practiceAttendanceId?: string;
  coachVisible: boolean;
};

function formatGoalType(type: AthleteGoalType) {
  switch (type) {
    case "practice_check_in":
      return "Practice Goal";
    case "session":
      return "Session Goal";
    case "year":
      return "Year Goal";
  }
}

function createEmptyGoalForm(params?: {
  type?: AthleteGoalType;
  practiceEventId?: string;
  practiceAttendanceId?: string;
}) {
  const currentSession = getCurrentGoalSession();

  return {
    type: params?.type || "session",
    title: "",
    description: "",
    status: "active" as AthleteGoalStatus,
    sessionName: params?.type === "year" ? undefined : currentSession.sessionName,
    seasonYear: String(currentSession.seasonYear),
    practiceEventId: params?.practiceEventId,
    practiceAttendanceId: params?.practiceAttendanceId,
    coachVisible: false,
  } satisfies GoalFormState;
}

function createFormFromGoal(goal: AthleteGoal): GoalFormState {
  return {
    type: goal.type,
    title: goal.title,
    description: goal.description || "",
    status: goal.status,
    sessionName: goal.sessionName,
    seasonYear: goal.seasonYear ? String(goal.seasonYear) : String(new Date().getFullYear()),
    practiceEventId: goal.practiceEventId,
    practiceAttendanceId: goal.practiceAttendanceId,
    coachVisible: goal.coachVisible,
  };
}

function formatCompletedAt(value?: string) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fullName(wrestler?: WrestlerProfile | null) {
  return [wrestler?.firstName, wrestler?.lastName].filter(Boolean).join(" ").trim();
}

export default function GoalsScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } = useMobileAuthState();
  const params = useLocalSearchParams<{
    createPracticeGoal?: string;
    practiceEventId?: string;
    practiceAttendanceId?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [wrestler, setWrestler] = useState<WrestlerProfile | null>(null);
  const [goals, setGoals] = useState<AthleteGoal[]>([]);
  const [formVisible, setFormVisible] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [form, setForm] = useState<GoalFormState>(createEmptyGoalForm());
  const autoOpenedPracticePrompt = useRef(false);

  const signedIn = Boolean(firebaseUser && appUser);
  const isAthlete = appUser?.role === "athlete";
  const currentSession = useMemo(() => getCurrentGoalSession(), []);
  const currentYear = new Date().getFullYear();

  async function loadGoals() {
    if (!firebaseUser?.uid || !currentTeam?.id || !isAthlete) {
      setWrestler(null);
      setGoals([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const ownedWrestlers = await listWrestlersByOwnerUserId(db, firebaseUser.uid, currentTeam.id);
      const ownWrestler = ownedWrestlers[0] || null;
      setWrestler(ownWrestler);

      if (!ownWrestler) {
        setGoals([]);
        return;
      }

      setGoals(
        await listMyAthleteGoals(db, {
          teamId: currentTeam.id,
          wrestlerId: ownWrestler.id,
          createdByUserId: firebaseUser.uid,
        })
      );
    } catch (error) {
      console.error("Failed to load athlete goals:", error);
      Alert.alert("Goals unavailable", "We couldn’t load your goals right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading) return;
    loadGoals();
  }, [authLoading, currentTeam?.id, firebaseUser?.uid, isAthlete]); // eslint-disable-line react-hooks/exhaustive-deps

  const practiceGoal = useMemo(() => {
    if (params.practiceAttendanceId || params.practiceEventId) {
      return getPracticeCheckInGoalForAttendance(goals, {
        practiceAttendanceId: params.practiceAttendanceId,
        practiceEventId: params.practiceEventId,
      });
    }

    return goals.find((goal) => goal.type === "practice_check_in" && goal.status === "active") || null;
  }, [goals, params.practiceAttendanceId, params.practiceEventId]);

  const sessionGoal = useMemo(
    () => getActiveSessionGoal(goals, currentSession),
    [currentSession, goals]
  );

  const yearGoal = useMemo(
    () => getActiveYearGoal(goals, currentYear),
    [currentYear, goals]
  );

  useEffect(() => {
    if (autoOpenedPracticePrompt.current) return;
    if (!isAthlete || !wrestler) return;
    if (params.createPracticeGoal !== "1") return;
    if (practiceGoal) return;

    autoOpenedPracticePrompt.current = true;
    setEditingGoalId(null);
    setForm(
      createEmptyGoalForm({
        type: "practice_check_in",
        practiceEventId: params.practiceEventId,
        practiceAttendanceId: params.practiceAttendanceId,
      })
    );
    setFormVisible(true);
  }, [
    isAthlete,
    params.createPracticeGoal,
    params.practiceAttendanceId,
    params.practiceEventId,
    practiceGoal,
    wrestler,
  ]);

  const editingGoal = useMemo(
    () => goals.find((goal) => goal.id === editingGoalId) || null,
    [editingGoalId, goals]
  );

  function openCreateGoal(type: AthleteGoalType) {
    setEditingGoalId(null);
    setForm(
      createEmptyGoalForm({
        type,
        practiceEventId:
          type === "practice_check_in" ? params.practiceEventId : undefined,
        practiceAttendanceId:
          type === "practice_check_in" ? params.practiceAttendanceId : undefined,
      })
    );
    setFormVisible(true);
  }

  function openEditGoal(goal: AthleteGoal) {
    setEditingGoalId(goal.id);
    setForm(createFormFromGoal(goal));
    setFormVisible(true);
  }

  function cancelEdit() {
    setEditingGoalId(null);
    setFormVisible(false);
    setForm(createEmptyGoalForm());
  }

  async function handleSave() {
    if (!firebaseUser?.uid || !currentTeam?.id || !wrestler?.id) {
      return;
    }

    if (!form.title.trim()) {
      Alert.alert("Missing title", "Add a clear goal title before saving.");
      return;
    }

    if (form.type === "session" && !form.sessionName) {
      Alert.alert("Missing session", "Choose the current training session for this goal.");
      return;
    }

    const parsedSeasonYear = Number(form.seasonYear);
    if ((form.type === "session" || form.type === "year") && !Number.isFinite(parsedSeasonYear)) {
      Alert.alert("Missing year", "Add a valid season year for this goal.");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        teamId: currentTeam.id,
        wrestlerId: wrestler.id,
        createdByUserId: firebaseUser.uid,
        type: form.type,
        title: form.title,
        description: form.description || undefined,
        status: form.status,
        sessionName: form.type === "session" ? form.sessionName : undefined,
        seasonYear:
          form.type === "session" || form.type === "year" ? parsedSeasonYear : undefined,
        practiceEventId:
          form.type === "practice_check_in" ? form.practiceEventId : undefined,
        practiceAttendanceId:
          form.type === "practice_check_in" ? form.practiceAttendanceId : undefined,
        coachVisible: form.coachVisible,
      } as const;

      if (editingGoalId) {
        await updateAthleteGoal(db, editingGoalId, payload);
      } else {
        await createAthleteGoal(db, payload);
      }

      cancelEdit();
      await loadGoals();
    } catch (error) {
      console.error("Failed to save athlete goal:", error);
      Alert.alert("Save failed", "We couldn’t save your goal right now.");
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete(goal: AthleteGoal) {
    try {
      await completeAthleteGoal(db, goal.id);
      await loadGoals();
    } catch (error) {
      console.error("Failed to complete athlete goal:", error);
      Alert.alert("Update failed", "We couldn’t mark that goal complete.");
    }
  }

  async function handleArchive(goal: AthleteGoal) {
    try {
      await archiveAthleteGoal(db, goal.id);
      await loadGoals();
    } catch (error) {
      console.error("Failed to archive athlete goal:", error);
      Alert.alert("Archive failed", "We couldn’t archive that goal.");
    }
  }

  async function handleDelete(goal: AthleteGoal) {
    Alert.alert("Delete goal?", "This goal will be removed from your tracker.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteAthleteGoal(db, goal.id);
            if (editingGoalId === goal.id) {
              cancelEdit();
            }
            await loadGoals();
          } catch (error) {
            console.error("Failed to delete athlete goal:", error);
            Alert.alert("Delete failed", "We couldn’t remove that goal.");
          }
        },
      },
    ]);
  }

  if (authLoading) {
    return (
      <MobileScreenShell title="Athlete Goals" subtitle="Loading your focus board...">
        <Text style={{ color: "#b7c9df" }}>Loading goals...</Text>
      </MobileScreenShell>
    );
  }

  const topSubtitle =
    params.createPracticeGoal === "1"
      ? "You’re checked in. Capture one clear target for today’s practice before you hit the room."
      : "Track what matters today, this session, and this year.";

  return (
    <MobileScreenShell
      title="Athlete Goals"
      subtitle={topSubtitle}
      eyebrow="FOCUS BOARD"
    >
      <View style={{ gap: 14 }}>
        {!signedIn ? (
          <WWCard>
            <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
              Sign in required
            </Text>
            <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
              Sign in as an athlete to set and track personal goals.
            </Text>
          </WWCard>
        ) : !isAthlete ? (
          <WWCard>
            <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
              Athlete goals only
            </Text>
            <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
              This first goals release is built for athlete self-tracking. Parents do not see goals, and coaches only see goals the athlete marks coach-visible.
            </Text>
          </WWCard>
        ) : loading ? (
          <Text style={{ color: "#b7c9df" }}>Loading goals...</Text>
        ) : !wrestler ? (
          <WWCard>
            <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
              No wrestler profile yet
            </Text>
            <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
              Connect your wrestler profile first so your goals can stay tied to your athlete record.
            </Text>
          </WWCard>
        ) : (
          <>
            <WWCard>
              <View style={{ gap: 12 }}>
                <WWBadge label="ATHLETE ONLY" tone="white" />
                <Text style={{ color: "#ffffff", fontSize: 24, fontWeight: "900" }}>
                  {fullName(wrestler) || "My Goals"}
                </Text>
                <Text style={{ color: "#b7c9df", lineHeight: 22 }}>
                  Set one practice goal, one current session goal, and one year goal so your journal and training stay pointed at the same targets.
                </Text>
              </View>
            </WWCard>

            {formVisible ? (
              <WWCard>
                <View style={{ gap: 12 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#ffffff", fontSize: 22, fontWeight: "900" }}>
                        {editingGoal ? "Edit goal" : "New goal"}
                      </Text>
                      <Text style={{ color: "#b7c9df", marginTop: 6, lineHeight: 20 }}>
                        Keep it specific enough that you can complete it or carry it forward.
                      </Text>
                    </View>
                    <WWBadge label={form.status.toUpperCase()} tone={form.status === "active" ? "green" : form.status === "completed" ? "white" : "dark"} />
                  </View>

                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    {ATHLETE_GOAL_TYPES.map((type: AthleteGoalType) => {
                      const active = form.type === type;
                      const testId =
                        type === "practice_check_in"
                          ? "goal-type-practice-button"
                          : type === "session"
                            ? "goal-type-session-button"
                            : "goal-type-year-button";

                      return (
                        <Pressable
                          key={type}
                          testID={testId}
                          accessibilityLabel={testId}
                          onPress={() =>
                            setForm((current) => ({
                              ...current,
                              type,
                              sessionName:
                                type === "session"
                                  ? current.sessionName || currentSession.sessionName
                                  : undefined,
                              practiceEventId:
                                type === "practice_check_in"
                                  ? current.practiceEventId || params.practiceEventId
                                  : undefined,
                              practiceAttendanceId:
                                type === "practice_check_in"
                                  ? current.practiceAttendanceId || params.practiceAttendanceId
                                  : undefined,
                            }))
                          }
                          style={({ pressed }) => ({
                            paddingHorizontal: 12,
                            paddingVertical: 9,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: active ? "#ffffff" : "#315c86",
                            backgroundColor: active ? "#ffffff" : pressed ? "#173b67" : "#102f52",
                          })}
                        >
                          <Text style={{ color: active ? "#061a33" : "#dbeafe", fontWeight: "900", fontSize: 12 }}>
                            {formatGoalType(type)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <TextInput
                    testID="goal-title-input"
                    accessibilityLabel="goal-title-input"
                    value={form.title}
                    onChangeText={(title) => setForm((current) => ({ ...current, title }))}
                    placeholder="Goal title"
                    placeholderTextColor="#6b87aa"
                    style={{
                      borderRadius: 18,
                      borderWidth: 1,
                      borderColor: "#21486e",
                      backgroundColor: "#0b2542",
                      color: "#ffffff",
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      fontSize: 16,
                      fontWeight: "700",
                    }}
                  />

                  <TextInput
                    testID="goal-description-input"
                    accessibilityLabel="goal-description-input"
                    value={form.description}
                    onChangeText={(description) => setForm((current) => ({ ...current, description }))}
                    placeholder="Why does this matter? What will success look like?"
                    placeholderTextColor="#6b87aa"
                    multiline
                    textAlignVertical="top"
                    style={{
                      minHeight: 120,
                      borderRadius: 18,
                      borderWidth: 1,
                      borderColor: "#21486e",
                      backgroundColor: "#0b2542",
                      color: "#ffffff",
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      fontSize: 15,
                      lineHeight: 22,
                    }}
                  />

                  {form.type === "session" ? (
                    <View style={{ gap: 8 }}>
                      <Text style={{ color: "#93c5fd", fontWeight: "900", letterSpacing: 0.7 }}>
                        SESSION
                      </Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {ATHLETE_GOAL_SESSION_NAMES.map((sessionName: AthleteGoalSessionName) => {
                          const active = form.sessionName === sessionName;
                          const testId = `goal-session-${sessionName.toLowerCase()}-button`;
                          return (
                            <Pressable
                              key={sessionName}
                              testID={testId}
                              accessibilityLabel={testId}
                              onPress={() => setForm((current) => ({ ...current, sessionName }))}
                              style={({ pressed }) => ({
                                paddingHorizontal: 12,
                                paddingVertical: 9,
                                borderRadius: 999,
                                borderWidth: 1,
                                borderColor: active ? "#f87171" : "#315c86",
                                backgroundColor: active
                                  ? "rgba(191,16,41,0.22)"
                                  : pressed
                                    ? "#173b67"
                                    : "#102f52",
                              })}
                            >
                              <Text style={{ color: active ? "#fecaca" : "#dbeafe", fontWeight: "900", fontSize: 12 }}>
                                {sessionName}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ) : null}

                  {(form.type === "session" || form.type === "year") ? (
                    <TextInput
                      value={form.seasonYear}
                      onChangeText={(seasonYear) =>
                        setForm((current) => ({ ...current, seasonYear }))
                      }
                      keyboardType="number-pad"
                      placeholder="Season year"
                      placeholderTextColor="#6b87aa"
                      style={{
                        borderRadius: 18,
                        borderWidth: 1,
                        borderColor: "#21486e",
                        backgroundColor: "#0b2542",
                        color: "#ffffff",
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        fontSize: 15,
                      }}
                    />
                  ) : null}

                  {form.type === "practice_check_in" ? (
                    <Text style={{ color: "#93c5fd", lineHeight: 20 }}>
                      This goal will be linked to today’s practice attendance when available.
                    </Text>
                  ) : null}

                  <Pressable
                    testID="goal-coach-visible-toggle"
                    accessibilityLabel="goal-coach-visible-toggle"
                    onPress={() =>
                      setForm((current) => ({
                        ...current,
                        coachVisible: !current.coachVisible,
                      }))
                    }
                    style={({ pressed }) => ({
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: form.coachVisible ? "#f87171" : "#315c86",
                      backgroundColor: form.coachVisible
                        ? "rgba(191,16,41,0.18)"
                        : pressed
                          ? "#173b67"
                          : "#102f52",
                      padding: 14,
                    })}
                  >
                    <Text style={{ color: "#ffffff", fontWeight: "900", fontSize: 16 }}>
                      {form.coachVisible ? "Coach can read this goal" : "Keep this goal private"}
                    </Text>
                  </Pressable>

                  <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                    <Pressable
                      testID="goal-save-button"
                      accessibilityLabel="goal-save-button"
                      onPress={handleSave}
                      style={({ pressed }) => ({
                        flex: 1,
                        minWidth: 150,
                        paddingVertical: 13,
                        borderRadius: 16,
                        alignItems: "center",
                        backgroundColor: pressed ? "#991b1b" : "#bf1029",
                      })}
                    >
                      <Text style={{ color: "#ffffff", fontWeight: "900" }}>
                        {saving ? "Saving..." : editingGoal ? "Save Changes" : "Save Goal"}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={cancelEdit}
                      style={({ pressed }) => ({
                        flex: 1,
                        minWidth: 120,
                        paddingVertical: 13,
                        borderRadius: 16,
                        alignItems: "center",
                        borderWidth: 1,
                        borderColor: "#315c86",
                        backgroundColor: pressed ? "#173b67" : "#102f52",
                      })}
                    >
                      <Text style={{ color: "#dbeafe", fontWeight: "900" }}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              </WWCard>
            ) : null}

            <GoalSection
              title="Today’s Practice Goal"
              subtitle="One thing to hit today once you step on the mat."
              goal={practiceGoal}
              emptyCopy="No practice goal set yet."
              createLabel="Add Practice Goal"
              onCreate={() => openCreateGoal("practice_check_in")}
              onEdit={openEditGoal}
              onComplete={handleComplete}
              onArchive={handleArchive}
              onDelete={handleDelete}
            />

            <GoalSection
              title={`Current Session Goal · ${currentSession.sessionName} ${currentSession.seasonYear}`}
              subtitle="A target for this training block."
              goal={sessionGoal}
              emptyCopy="No active session goal yet."
              createLabel="Add Session Goal"
              onCreate={() => openCreateGoal("session")}
              onEdit={openEditGoal}
              onComplete={handleComplete}
              onArchive={handleArchive}
              onDelete={handleDelete}
            />

            <GoalSection
              title={`Year Goal · ${currentYear}`}
              subtitle="Your big target for the full year."
              goal={yearGoal}
              emptyCopy="No active year goal yet."
              createLabel="Add Year Goal"
              onCreate={() => openCreateGoal("year")}
              onEdit={openEditGoal}
              onComplete={handleComplete}
              onArchive={handleArchive}
              onDelete={handleDelete}
            />
          </>
        )}
      </View>
    </MobileScreenShell>
  );
}

function GoalSection({
  title,
  subtitle,
  goal,
  emptyCopy,
  createLabel,
  onCreate,
  onEdit,
  onComplete,
  onArchive,
  onDelete,
}: {
  title: string;
  subtitle: string;
  goal: AthleteGoal | null;
  emptyCopy: string;
  createLabel: string;
  onCreate: () => void;
  onEdit: (goal: AthleteGoal) => void;
  onComplete: (goal: AthleteGoal) => void;
  onArchive: (goal: AthleteGoal) => void;
  onDelete: (goal: AthleteGoal) => void;
}) {
  return (
    <WWCard>
      <View style={{ gap: 12 }}>
        <View style={{ gap: 6 }}>
          <Text style={{ color: "#ffffff", fontSize: 22, fontWeight: "900" }}>{title}</Text>
          <Text style={{ color: "#b7c9df", lineHeight: 21 }}>{subtitle}</Text>
        </View>

        {!goal ? (
          <>
            <Text style={{ color: "#93c5fd" }}>{emptyCopy}</Text>
            <Pressable
              testID="goals-create-button"
              accessibilityLabel="goals-create-button"
              onPress={onCreate}
              style={({ pressed }) => ({
                alignSelf: "flex-start",
                paddingHorizontal: 16,
                paddingVertical: 11,
                borderRadius: 999,
                backgroundColor: pressed ? "#991b1b" : "#bf1029",
              })}
            >
              <Text style={{ color: "#ffffff", fontWeight: "900" }}>{createLabel}</Text>
            </Pressable>
          </>
        ) : (
          <View testID="goal-entry-card" accessibilityLabel="goal-entry-card" style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#ffffff", fontSize: 21, fontWeight: "900" }}>
                  {goal.title}
                </Text>
                {goal.description ? (
                  <Text style={{ color: "#dbeafe", lineHeight: 21, marginTop: 8 }}>
                    {goal.description}
                  </Text>
                ) : null}
              </View>
              <WWBadge
                label={goal.coachVisible ? "COACH-VISIBLE" : "PRIVATE"}
                tone={goal.coachVisible ? "red" : "dark"}
              />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <WWBadge label={formatGoalType(goal.type).toUpperCase()} tone="blue" />
              <WWBadge label={goal.status.toUpperCase()} tone={goal.status === "active" ? "green" : goal.status === "completed" ? "white" : "dark"} />
              {goal.sessionName ? (
                <WWBadge label={`${goal.sessionName.toUpperCase()} ${goal.seasonYear || ""}`.trim()} tone="orange" />
              ) : null}
              {goal.type === "year" && goal.seasonYear ? (
                <WWBadge label={String(goal.seasonYear)} tone="orange" />
              ) : null}
            </View>

            {goal.status === "completed" && goal.completedAt ? (
              <Text style={{ color: "#93c5fd" }}>
                Completed {formatCompletedAt(goal.completedAt)}
              </Text>
            ) : null}

            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <Pressable
                onPress={() => onEdit(goal)}
                style={({ pressed }) => ({
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 999,
                  backgroundColor: pressed ? "#ffffff" : "#e2e8f0",
                })}
              >
                <Text style={{ color: "#061a33", fontWeight: "900" }}>Edit</Text>
              </Pressable>

              {goal.status === "active" ? (
                <Pressable
                  testID="goal-complete-button"
                  accessibilityLabel="goal-complete-button"
                  onPress={() => onComplete(goal)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: "#86efac",
                    backgroundColor: pressed ? "#166534" : "#14532d",
                  })}
                >
                  <Text style={{ color: "#dcfce7", fontWeight: "900" }}>Complete</Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => onArchive(goal)}
                style={({ pressed }) => ({
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: "#315c86",
                  backgroundColor: pressed ? "#173b67" : "#102f52",
                })}
              >
                <Text style={{ color: "#dbeafe", fontWeight: "900" }}>Archive</Text>
              </Pressable>

              <Pressable
                onPress={() => onDelete(goal)}
                style={({ pressed }) => ({
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 999,
                  backgroundColor: pressed ? "#7f1d1d" : "#991b1b",
                })}
              >
                <Text style={{ color: "#ffffff", fontWeight: "900" }}>Delete</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </WWCard>
  );
}
