import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { db } from "@wrestlewell/firebase/client";
import {
  getMatSideSummary,
  listWrestlers,
  mergeMatSideSummaryWithProfile,
} from "@wrestlewell/lib/index";
import type { MatSideSummary, WrestlerProfile } from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { ScreenShell } from "../components/screen-shell";

function SummarySection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <View style={{ marginTop: 18 }}>
      <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 8 }}>{title}</Text>
      {items.map((item) => (
        <Text key={`${title}-${item}`} style={{ fontSize: 15, lineHeight: 22, marginBottom: 4 }}>
          • {item}
        </Text>
      ))}
    </View>
  );
}

export default function MatSideScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } = useMobileAuthState();
  const params = useLocalSearchParams<{ wrestlerId?: string }>();
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<MatSideSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const isCoach = appUser?.role === "coach";

  async function refreshRoster() {
    if (!currentTeam?.id) {
      setWrestlers([]);
      setSelectedId(null);
      return;
    }

    const rows = await listWrestlers(db, currentTeam.id);
    setWrestlers(rows);
    const ownWrestler =
      appUser?.role === "athlete" && firebaseUser
        ? rows.find((row) => row.ownerUserId === firebaseUser.uid) || null
        : null;

    if (!rows.length) {
      setSelectedId(null);
      return;
    }

    setSelectedId((prev: string | null) => {
      const requestedId = typeof params.wrestlerId === "string" ? params.wrestlerId : null;
      const preferredId = requestedId ?? prev ?? ownWrestler?.id ?? null;
      return preferredId && rows.some((row: WrestlerProfile) => row.id === preferredId)
        ? preferredId
        : ownWrestler?.id || rows[0].id;
    });
  }

  useEffect(() => {
    async function load() {
      try {
        await refreshRoster();
      } catch (error) {
        console.error("Failed to load mat-side roster:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [currentTeam?.id, params.wrestlerId]);

  useEffect(() => {
    async function loadSummary() {
      if (!selectedId) {
        setSummary(null);
        return;
      }

      try {
        setLoadingSummary(true);
        setSummary(await getMatSideSummary(db, selectedId));
      } catch (error) {
        console.error("Failed to load mat-side summary:", error);
      } finally {
        setLoadingSummary(false);
      }
    }

    loadSummary();
  }, [selectedId]);

  const selectedWrestler = useMemo(
    () => wrestlers.find((wrestler: WrestlerProfile) => wrestler.id === selectedId) || null,
    [selectedId, wrestlers]
  );

  const resolvedSummary = useMemo(() => {
    if (!selectedWrestler) {
      return null;
    }

    return mergeMatSideSummaryWithProfile(selectedWrestler, summary);
  }, [selectedWrestler, summary]);

  return (
    <ScreenShell>
      {!authLoading && (!firebaseUser || !appUser) ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#ddd",
            borderRadius: 16,
            padding: 18,
            backgroundColor: "#fff",
            marginBottom: 18,
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: "800", color: "#091729" }}>Sign in required</Text>
          <Text style={{ fontSize: 15, color: "#5f6d83", lineHeight: 22, marginTop: 8 }}>
            Sign in on the home screen to access team mat-side summaries.
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <Link href="/" asChild>
          <Pressable
            style={{
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 999,
              backgroundColor: "#e5e7eb",
            }}
          >
            <Text style={{ fontWeight: "700", color: "#111827" }}>Home</Text>
          </Pressable>
        </Link>

        <Link
          href={selectedWrestler ? { pathname: "/wrestlers", params: { wrestlerId: selectedWrestler.id } } : "/wrestlers"}
          asChild
        >
          <Pressable
            style={{
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 999,
              backgroundColor: "#111827",
            }}
          >
            <Text style={{ fontWeight: "700", color: "#fff" }}>Back to Wrestlers</Text>
          </Pressable>
        </Link>
      </View>

      <Text style={{ fontSize: 28, fontWeight: "700", marginBottom: 12 }}>Mat-Side Summary</Text>
      <Text style={{ fontSize: 16, color: "#555", marginBottom: 20 }}>
        {isCoach
          ? "Quick coaching view for reminders, warm-up, strengths, weaknesses, and match plan."
          : "Your personal match-prep view for reminders, warm-up, strengths, weaknesses, and game plan."}
      </Text>

      {!isCoach ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#ddd",
            borderRadius: 14,
            padding: 16,
            backgroundColor: "#fff",
            marginBottom: 18,
          }}
        >
          <Text style={{ fontSize: 15, color: "#5f6d83", lineHeight: 22 }}>
            This view is focused on your athlete profile. Saved coach mat-side notes appear here automatically when available.
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => {
          setLoading(true);
          refreshRoster().finally(() => setLoading(false));
        }}
        style={{
          alignSelf: "flex-start",
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 999,
          backgroundColor: "#111827",
          marginBottom: 20,
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "700" }}>{loading ? "Refreshing..." : "Refresh"}</Text>
      </Pressable>

      {loading ? <Text>Loading wrestlers...</Text> : null}

      {!loading && wrestlers.length === 0 ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#ddd",
            borderRadius: 14,
            padding: 18,
            backgroundColor: "#fff",
          }}
        >
          <Text style={{ fontSize: 16, lineHeight: 22 }}>
            No wrestler profiles yet. Add them on the web app and mat-side summaries will appear here.
          </Text>
        </View>
      ) : null}

      {firebaseUser && appUser && wrestlers.length > 0 ? (
        <View style={{ gap: 14 }}>
          {isCoach ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: "#ddd",
              borderRadius: 16,
              padding: 16,
              backgroundColor: "#fff",
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 12 }}>Roster</Text>
            <View style={{ gap: 10 }}>
              {wrestlers.map((wrestler: WrestlerProfile) => {
                const isActive = wrestler.id === selectedId;
                const fullName = `${wrestler.firstName} ${wrestler.lastName}`.trim();

                return (
                  <Pressable
                    key={wrestler.id}
                    onPress={() => setSelectedId(wrestler.id)}
                    style={{
                      borderWidth: 1,
                      borderColor: isActive ? "#111827" : "#e5e7eb",
                      borderRadius: 12,
                      padding: 12,
                      backgroundColor: isActive ? "#f3f4f6" : "#fff",
                    }}
                  >
                    <Text style={{ fontSize: 16, fontWeight: "700" }}>{fullName || "Unnamed Wrestler"}</Text>
                    <Text style={{ fontSize: 14, color: "#555", marginTop: 4 }}>
                      {[wrestler.weightClass, wrestler.grade, wrestler.schoolOrClub]
                        .filter(Boolean)
                        .join(" • ") || "Profile details in progress"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          ) : null}

          {selectedWrestler && resolvedSummary ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 16,
                padding: 16,
                backgroundColor: "#fff",
              }}
            >
              <Text style={{ fontSize: 22, fontWeight: "700" }}>
                {selectedWrestler.firstName} {selectedWrestler.lastName}
              </Text>
              <Text style={{ fontSize: 15, color: "#555", marginTop: 8, lineHeight: 22 }}>
                {[selectedWrestler.weightClass, selectedWrestler.grade, selectedWrestler.schoolOrClub]
                  .filter(Boolean)
                  .join(" • ") || "Add more wrestler details on the web app."}
              </Text>

              <Link href={{ pathname: "/wrestlers", params: { wrestlerId: selectedWrestler.id } }} asChild>
                <Pressable
                  style={{
                    marginTop: 16,
                    alignSelf: "flex-start",
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 999,
                    backgroundColor: "#e5e7eb",
                  }}
                >
                  <Text style={{ fontWeight: "700", color: "#111827" }}>Open Full Profile</Text>
                </Pressable>
              </Link>

              <View
                style={{
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 12,
                  backgroundColor: summary ? "#eef6ff" : "#f9fafb",
                }}
              >
                <Text style={{ fontSize: 14, color: "#555", lineHeight: 20 }}>
                  {loadingSummary
                    ? "Loading summary..."
                    : summary
                      ? "Showing saved mat-side summary."
                      : "No saved summary yet. Using wrestler profile fallback."}
                </Text>
              </View>

              <SummarySection title="Quick Reminders" items={resolvedSummary.quickReminders} />
              <SummarySection title="Warm-up Checklist" items={resolvedSummary.warmupChecklist} />
              <SummarySection title="Strengths" items={resolvedSummary.strengths} />
              <SummarySection title="Weaknesses" items={resolvedSummary.weaknesses} />
              <SummarySection title="Game Plan" items={resolvedSummary.gamePlan} />
              <SummarySection title="Recent Notes" items={resolvedSummary.recentNotes} />
            </View>
          ) : null}
        </View>
      ) : null}
    </ScreenShell>
  );
}
