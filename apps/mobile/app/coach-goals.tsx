import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { db } from "@wrestlewell/firebase/client";
import {
  listCoachVisibleGoalsForTeam,
  listWrestlers,
} from "@wrestlewell/lib/index";
import type {
  AthleteGoal,
  AthleteGoalType,
  WrestlerProfile,
} from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell, WWBadge, WWCard } from "../components/mobile-screen-shell";

function formatGoalType(type: AthleteGoalType) {
  switch (type) {
    case "practice_check_in":
      return "Practice Check-In";
    case "session":
      return "Session Goal";
    case "year":
      return "Year Goal";
  }
}

function getWrestlerName(wrestler?: WrestlerProfile | null) {
  return [wrestler?.firstName, wrestler?.lastName].filter(Boolean).join(" ").trim();
}

function formatDate(value?: string) {
  if (!value) return "";

  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function previewDescription(value?: string) {
  const trimmed = value?.trim() || "";
  if (!trimmed) return "";
  if (trimmed.length <= 220) return trimmed;
  return `${trimmed.slice(0, 217).trimEnd()}...`;
}

export default function CoachGoalsScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } = useMobileAuthState();
  const [loading, setLoading] = useState(true);
  const [goals, setGoals] = useState<AthleteGoal[]>([]);
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);

  const isCoach = appUser?.role === "coach";
  const signedIn = Boolean(firebaseUser && appUser);

  useEffect(() => {
    async function load() {
      if (!currentTeam?.id || !isCoach) {
        setGoals([]);
        setWrestlers([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const [goalRows, wrestlerRows] = await Promise.all([
          listCoachVisibleGoalsForTeam(db, currentTeam.id),
          listWrestlers(db, currentTeam.id),
        ]);

        setGoals(
          goalRows
            .slice()
            .sort((a, b) => {
              const aValue = a.createdAt || a.updatedAt || "";
              const bValue = b.createdAt || b.updatedAt || "";
              return bValue.localeCompare(aValue);
            })
        );
        setWrestlers(wrestlerRows);
      } catch (error) {
        console.error("Failed to load coach-shared goals:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [currentTeam?.id, isCoach]);

  const wrestlerNameById = useMemo(
    () =>
      new Map(
        wrestlers.map((wrestler) => [wrestler.id, getWrestlerName(wrestler)] as const)
      ),
    [wrestlers]
  );

  if (authLoading) {
    return (
      <MobileScreenShell title="Shared Goals" subtitle="Loading athlete goals shared with coaches...">
        <Text style={{ color: "#b7c9df" }}>Loading shared goals...</Text>
      </MobileScreenShell>
    );
  }

  if (!signedIn) {
    return (
      <MobileScreenShell
        title="Shared Goals"
        subtitle="Sign in as a coach to review athlete goals."
      >
        <WWCard>
          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
            Sign in required
          </Text>
          <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
            Coaches can review the goals athletes explicitly choose to share.
          </Text>
        </WWCard>
      </MobileScreenShell>
    );
  }

  if (!isCoach) {
    return (
      <MobileScreenShell title="Shared Goals" subtitle="This coach goals inbox is coach-only.">
        <WWCard>
          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
            Access denied
          </Text>
          <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
            Athletes manage their own goals in the Goals screen, and parents do not have access to shared athlete goals in this first version.
          </Text>
        </WWCard>
      </MobileScreenShell>
    );
  }

  return (
    <MobileScreenShell
      title="Shared Goals"
      subtitle="Review the goals athletes marked coach-visible so you can coach toward their current priorities."
      eyebrow="COACH SHARED GOALS"
    >
      <View
        testID="coach-goals-screen"
        accessibilityLabel="coach-goals-screen"
        style={{ gap: 14 }}
      >
        {loading ? (
          <Text style={{ color: "#b7c9df" }}>Loading shared goals...</Text>
        ) : goals.length === 0 ? (
          <WWCard>
            <View
              testID="coach-goals-empty-state"
              accessibilityLabel="coach-goals-empty-state"
              style={{ gap: 8 }}
            >
              <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
                No shared goals yet
              </Text>
              <Text style={{ color: "#b7c9df", lineHeight: 22 }}>
                Athlete goals will appear here once wrestlers choose to mark them coach-visible.
              </Text>
            </View>
          </WWCard>
        ) : (
          goals.map((goal) => {
            const wrestlerName = wrestlerNameById.get(goal.wrestlerId) || "Shared athlete goal";
            const description = previewDescription(goal.description);

            return (
              <WWCard key={goal.id}>
                <View
                  testID="coach-goal-entry-card"
                  accessibilityLabel="coach-goal-entry-card"
                  style={{ gap: 12 }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 12,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#ffffff", fontSize: 21, fontWeight: "900" }}>
                        {goal.title}
                      </Text>
                      <Text style={{ color: "#93c5fd", marginTop: 6 }}>
                        {wrestlerName} • {formatGoalType(goal.type)}
                      </Text>
                    </View>
                    <WWBadge label={goal.status.toUpperCase()} tone={goal.status === "active" ? "green" : goal.status === "completed" ? "white" : "dark"} />
                  </View>

                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    <WWBadge label={formatGoalType(goal.type).toUpperCase()} tone="blue" />
                    {goal.sessionName ? (
                      <WWBadge
                        label={`${goal.sessionName.toUpperCase()}${goal.seasonYear ? ` ${goal.seasonYear}` : ""}`}
                        tone="orange"
                      />
                    ) : null}
                    {!goal.sessionName && goal.seasonYear ? (
                      <WWBadge label={String(goal.seasonYear)} tone="orange" />
                    ) : null}
                    {goal.practiceEventId ? <WWBadge label="PRACTICE LINKED" tone="red" /> : null}
                  </View>

                  {description ? (
                    <Text style={{ color: "#dbeafe", lineHeight: 22 }}>{description}</Text>
                  ) : null}

                  <View style={{ gap: 4 }}>
                    <Text style={{ color: "#b7c9df" }}>
                      Created: {formatDate(goal.createdAt) || "Unknown"}
                    </Text>
                    {goal.completedAt ? (
                      <Text style={{ color: "#b7c9df" }}>
                        Completed: {formatDate(goal.completedAt)}
                      </Text>
                    ) : null}
                    {goal.practiceEventId ? (
                      <Text style={{ color: "#b7c9df" }}>
                        Linked practice event: {goal.practiceEventId}
                      </Text>
                    ) : null}
                    {goal.practiceAttendanceId ? (
                      <Text style={{ color: "#b7c9df" }}>
                        Linked attendance: {goal.practiceAttendanceId}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </WWCard>
            );
          })
        )}
      </View>
    </MobileScreenShell>
  );
}
