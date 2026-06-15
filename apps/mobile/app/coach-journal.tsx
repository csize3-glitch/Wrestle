import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { db } from "@wrestlewell/firebase/client";
import {
  listCoachVisibleJournalEntriesForTeam,
  listWrestlers,
} from "@wrestlewell/lib/index";
import type {
  AthleteJournalEntry,
  WrestlerProfile,
} from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell, WWBadge, WWCard } from "../components/mobile-screen-shell";

function formatPracticeDate(value: string) {
  if (!value) return "Date not set";

  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getWrestlerName(wrestler?: WrestlerProfile | null) {
  return [wrestler?.firstName, wrestler?.lastName].filter(Boolean).join(" ").trim();
}

function previewBody(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 220) return trimmed;
  return `${trimmed.slice(0, 217).trimEnd()}...`;
}

export default function CoachJournalScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } = useMobileAuthState();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<AthleteJournalEntry[]>([]);
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);

  const isCoach = appUser?.role === "coach";
  const signedIn = Boolean(firebaseUser && appUser);

  useEffect(() => {
    async function load() {
      if (!currentTeam?.id || !isCoach) {
        setEntries([]);
        setWrestlers([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const [journalRows, wrestlerRows] = await Promise.all([
          listCoachVisibleJournalEntriesForTeam(db, currentTeam.id),
          listWrestlers(db, currentTeam.id),
        ]);
        setEntries(journalRows);
        setWrestlers(wrestlerRows);
      } catch (error) {
        console.error("Failed to load coach journal reflections:", error);
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
      <MobileScreenShell
        title="Athlete Reflections"
        subtitle="Loading shared athlete journal entries..."
      >
        <Text style={{ color: "#b7c9df" }}>Loading reflections...</Text>
      </MobileScreenShell>
    );
  }

  if (!signedIn) {
    return (
      <MobileScreenShell
        title="Athlete Reflections"
        subtitle="Sign in as a coach to read athlete reflections shared with staff."
      >
        <WWCard>
          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
            Sign in required
          </Text>
          <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
            Coaches can read the private reflections athletes explicitly choose to share.
          </Text>
        </WWCard>
      </MobileScreenShell>
    );
  }

  if (!isCoach) {
    return (
      <MobileScreenShell
        title="Athlete Reflections"
        subtitle="This reflection inbox is coach-only."
      >
        <WWCard>
          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
            Access denied
          </Text>
          <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
            Athletes use their own Journal screen, and parents do not have access to athlete reflections in this first version.
          </Text>
        </WWCard>
      </MobileScreenShell>
    );
  }

  return (
    <MobileScreenShell
      title="Athlete Reflections"
      subtitle="Read the journal entries athletes marked coach-visible so you can understand mindset, recovery, and what they want help with."
      eyebrow="COACH SHARED JOURNAL"
    >
      <View style={{ gap: 14 }}>
        {loading ? (
          <Text style={{ color: "#b7c9df" }}>Loading reflections...</Text>
        ) : entries.length === 0 ? (
          <WWCard>
            <View
              testID="coach-journal-empty-state"
              accessibilityLabel="coach-journal-empty-state"
              style={{ gap: 8 }}
            >
              <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
                No shared reflections yet
              </Text>
              <Text style={{ color: "#b7c9df", lineHeight: 22 }}>
                Athlete journal entries will appear here once wrestlers choose to mark them coach-visible.
              </Text>
            </View>
          </WWCard>
        ) : (
          entries.map((entry) => {
            const wrestlerName =
              wrestlerNameById.get(entry.wrestlerId) || "Shared athlete reflection";

            return (
              <WWCard key={entry.id}>
                <View
                  testID="coach-journal-entry-card"
                  accessibilityLabel="coach-journal-entry-card"
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
                        {entry.title}
                      </Text>
                      <Text style={{ color: "#93c5fd", marginTop: 6 }}>
                        {wrestlerName} • {formatPracticeDate(entry.practiceDate)} • {entry.mood}
                      </Text>
                    </View>
                    <WWBadge label="SHARED" tone="red" />
                  </View>

                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {entry.tags.map((tag) => (
                      <WWBadge key={`${entry.id}-${tag}`} label={tag.toUpperCase()} tone="blue" />
                    ))}
                  </View>

                  <Text style={{ color: "#dbeafe", lineHeight: 22 }}>
                    {previewBody(entry.body)}
                  </Text>

                  {entry.body.trim().length > 220 ? (
                    <Text style={{ color: "#b7c9df", lineHeight: 22 }}>{entry.body.trim()}</Text>
                  ) : null}
                </View>
              </WWCard>
            );
          })
        )}
      </View>
    </MobileScreenShell>
  );
}
