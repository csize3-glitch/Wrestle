import { router, useLocalSearchParams } from "expo-router";
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
import { MobileScreenShell } from "../components/mobile-screen-shell";

function SummarySection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <View style={{ marginTop: 18 }}>
      <Text
        style={{
          fontSize: 16,
          fontWeight: "900",
          marginBottom: 8,
          color: "#ffffff",
        }}
      >
        {title}
      </Text>

      <View style={{ gap: 5 }}>
        {items.map((item) => (
          <Text
            key={`${title}-${item}`}
            style={{ fontSize: 15, lineHeight: 22, color: "#dbeafe" }}
          >
            • {item}
          </Text>
        ))}
      </View>
    </View>
  );
}

export default function MatSideScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } =
    useMobileAuthState();
  const params = useLocalSearchParams<{ wrestlerId?: string }>();
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeStyle, setActiveStyle] = useState<
    "Folkstyle" | "Freestyle" | "Greco-Roman"
  >("Folkstyle");
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
      const requestedId =
        typeof params.wrestlerId === "string" ? params.wrestlerId : null;
      const preferredId = requestedId ?? prev ?? ownWrestler?.id ?? null;

      return preferredId &&
        rows.some((row: WrestlerProfile) => row.id === preferredId)
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
  }, [currentTeam?.id, params.wrestlerId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    () =>
      wrestlers.find((wrestler: WrestlerProfile) => wrestler.id === selectedId) ||
      null,
    [selectedId, wrestlers]
  );

  const resolvedSummary = useMemo(() => {
    if (!selectedWrestler) {
      return null;
    }

    return mergeMatSideSummaryWithProfile(selectedWrestler, summary);
  }, [selectedWrestler, summary]);

  useEffect(() => {
    if (!selectedWrestler) {
      setActiveStyle("Folkstyle");
      return;
    }

    if (selectedWrestler.styles.includes(activeStyle)) {
      return;
    }

    setActiveStyle(selectedWrestler.styles[0] || "Folkstyle");
  }, [activeStyle, selectedWrestler]);

  const activeStylePlan = resolvedSummary?.stylePlans?.[activeStyle] || null;

  return (
    <MobileScreenShell
      title="Mat-Side"
      subtitle={
        isCoach
          ? "Quick coaching view for reminders, warm-up, strengths, weaknesses, and match plan."
          : "Your match-prep view for reminders, warm-up, strengths, weaknesses, and game plan."
      }
    >
      {!authLoading && (!firebaseUser || !appUser) ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#21486e",
            borderRadius: 24,
            padding: 18,
            backgroundColor: "#0b2542",
            marginBottom: 18,
            gap: 10,
          }}
        >
          <Text style={{ fontSize: 22, fontWeight: "900", color: "#ffffff" }}>
            Sign in required
          </Text>

          <Text style={{ fontSize: 15, color: "#b7c9df", lineHeight: 22 }}>
            Sign in on the home screen to access team mat-side summaries.
          </Text>

          <Pressable
            onPress={() => router.push("/")}
            style={{
              alignSelf: "flex-start",
              paddingHorizontal: 16,
              paddingVertical: 11,
              borderRadius: 999,
              backgroundColor: "#bf1029",
            }}
          >
            <Text style={{ color: "#ffffff", fontWeight: "900" }}>Go Home</Text>
          </Pressable>
        </View>
      ) : null}

      {!isCoach ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#21486e",
            borderRadius: 20,
            padding: 16,
            backgroundColor: "#0b2542",
            marginBottom: 18,
          }}
        >
          <Text style={{ fontSize: 15, color: "#b7c9df", lineHeight: 22 }}>
            This view is focused on your athlete profile. Saved coach mat-side notes
            appear here automatically when available.
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
          paddingHorizontal: 16,
          paddingVertical: 11,
          borderRadius: 999,
          backgroundColor: "#ffffff",
          marginBottom: 20,
        }}
      >
        <Text style={{ color: "#061a33", fontWeight: "900" }}>
          {loading ? "Refreshing..." : "Refresh"}
        </Text>
      </Pressable>

      {loading ? (
        <Text style={{ color: "#b7c9df", marginBottom: 16 }}>
          Loading wrestlers...
        </Text>
      ) : null}

      {!loading && wrestlers.length === 0 ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#21486e",
            borderRadius: 20,
            padding: 18,
            backgroundColor: "#0b2542",
          }}
        >
          <Text style={{ fontSize: 16, lineHeight: 22, color: "#b7c9df" }}>
            No wrestler profiles yet. Add them on the web app and mat-side
            summaries will appear here.
          </Text>
        </View>
      ) : null}

      {firebaseUser && appUser && wrestlers.length > 0 ? (
        <View style={{ gap: 14 }}>
          {isCoach ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: "#21486e",
                borderRadius: 24,
                padding: 16,
                backgroundColor: "#0b2542",
              }}
            >
              <Text
                style={{
                  fontSize: 19,
                  fontWeight: "900",
                  marginBottom: 12,
                  color: "#ffffff",
                }}
              >
                Roster
              </Text>

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
                        borderColor: isActive ? "#ffffff" : "#315c86",
                        borderRadius: 16,
                        padding: 13,
                        backgroundColor: isActive ? "#173b67" : "#102f52",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 16,
                          fontWeight: "900",
                          color: "#ffffff",
                        }}
                      >
                        {fullName || "Unnamed Wrestler"}
                      </Text>

                      <Text
                        style={{
                          fontSize: 14,
                          color: "#b7c9df",
                          marginTop: 4,
                        }}
                      >
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
                borderColor: "#21486e",
                borderRadius: 24,
                padding: 16,
                backgroundColor: "#0b2542",
              }}
            >
              <Text style={{ fontSize: 24, fontWeight: "900", color: "#ffffff" }}>
                {selectedWrestler.firstName} {selectedWrestler.lastName}
              </Text>

              <Text
                style={{
                  fontSize: 15,
                  color: "#b7c9df",
                  marginTop: 8,
                  lineHeight: 22,
                }}
              >
                {[selectedWrestler.weightClass, selectedWrestler.grade, selectedWrestler.schoolOrClub]
                  .filter(Boolean)
                  .join(" • ") || "Add more wrestler details on the web app."}
              </Text>

              {selectedWrestler.styles.length > 0 ? (
                <View
                  style={{
                    flexDirection: "row",
                    gap: 8,
                    flexWrap: "wrap",
                    marginTop: 14,
                  }}
                >
                  {selectedWrestler.styles.map((style) => (
                    <Pressable
                      key={`style-${style}`}
                      onPress={() => setActiveStyle(style)}
                      style={{
                        paddingHorizontal: 13,
                        paddingVertical: 9,
                        borderRadius: 999,
                        backgroundColor:
                          activeStyle === style ? "#bf1029" : "#102f52",
                        borderWidth: 1,
                        borderColor:
                          activeStyle === style ? "#bf1029" : "#315c86",
                      }}
                    >
                      <Text
                        style={{
                          color: "#ffffff",
                          fontWeight: "900",
                        }}
                      >
                        {style}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/wrestlers",
                    params: { wrestlerId: selectedWrestler.id },
                  } as any)
                }
                style={{
                  marginTop: 16,
                  alignSelf: "flex-start",
                  paddingHorizontal: 16,
                  paddingVertical: 11,
                  borderRadius: 999,
                  backgroundColor: "#ffffff",
                }}
              >
                <Text style={{ fontWeight: "900", color: "#061a33" }}>
                  Open Full Profile
                </Text>
              </Pressable>

              <View
                style={{
                  marginTop: 14,
                  padding: 13,
                  borderRadius: 16,
                  backgroundColor: summary ? "#102f52" : "#071d36",
                  borderWidth: 1,
                  borderColor: summary ? "#315c86" : "#21486e",
                }}
              >
                <Text style={{ fontSize: 14, color: "#b7c9df", lineHeight: 20 }}>
                  {loadingSummary
                    ? "Loading summary..."
                    : summary
                      ? "Showing saved mat-side summary."
                      : "No saved summary yet. Using wrestler profile fallback."}
                </Text>
              </View>

              {activeStylePlan ? (
                <>
                  <SummarySection
                    title={`${activeStyle} Quick Reminders`}
                    items={activeStylePlan.quickReminders}
                  />
                  <SummarySection
                    title={`${activeStyle} Focus Points`}
                    items={activeStylePlan.focusPoints}
                  />
                  <SummarySection
                    title={`${activeStyle} Game Plan`}
                    items={activeStylePlan.gamePlan}
                  />
                  <SummarySection
                    title={`${activeStyle} Recent Notes`}
                    items={activeStylePlan.recentNotes}
                  />
                </>
              ) : null}

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
    </MobileScreenShell>
  );
}