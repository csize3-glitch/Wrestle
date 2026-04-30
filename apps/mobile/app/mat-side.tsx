import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "@wrestlewell/firebase/client";
import {
  getAppUser,
  getMatSideSummary,
  listWrestlers,
  mergeMatSideSummaryWithProfile,
} from "@wrestlewell/lib/index";
import {
  COLLECTIONS,
  type AppUser,
  type MatSideSummary,
  type StyleMatSideSection,
  type VarkStyle,
  type WrestlerMatch,
  type WrestlerProfile,
  type WrestlingStyle,
} from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell } from "../components/mobile-screen-shell";

const STYLE_OPTIONS: WrestlingStyle[] = ["Folkstyle", "Freestyle", "Greco-Roman"];

type StyleRecord = {
  wins: number;
  losses: number;
};

type MatSideEditForm = {
  quickReminders: string;
  warmupChecklist: string;
  strengths: string;
  weaknesses: string;
  gamePlan: string;
  recentNotes: string;
  styleQuickReminders: string;
  styleFocusPoints: string;
  styleGamePlan: string;
  styleRecentNotes: string;
};

function listToText(items?: string[]) {
  return (items || []).join("\n");
}

function textToList(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createEmptyEditForm(): MatSideEditForm {
  return {
    quickReminders: "",
    warmupChecklist: "",
    strengths: "",
    weaknesses: "",
    gamePlan: "",
    recentNotes: "",
    styleQuickReminders: "",
    styleFocusPoints: "",
    styleGamePlan: "",
    styleRecentNotes: "",
  };
}

function createEditFormFromSummary(
  summary: ReturnType<typeof mergeMatSideSummaryWithProfile> | null,
  activeStyle: WrestlingStyle
): MatSideEditForm {
  const stylePlan = summary?.stylePlans?.[activeStyle];

  return {
    quickReminders: listToText(summary?.quickReminders),
    warmupChecklist: listToText(summary?.warmupChecklist),
    strengths: listToText(summary?.strengths),
    weaknesses: listToText(summary?.weaknesses),
    gamePlan: listToText(summary?.gamePlan),
    recentNotes: listToText(summary?.recentNotes),
    styleQuickReminders: listToText(stylePlan?.quickReminders),
    styleFocusPoints: listToText(stylePlan?.focusPoints),
    styleGamePlan: listToText(stylePlan?.gamePlan),
    styleRecentNotes: listToText(stylePlan?.recentNotes),
  };
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

function sortValue(value: unknown) {
  if (!value) return "";

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    return new Date((value as { seconds: number }).seconds * 1000).toISOString();
  }

  return String(value);
}

function createEmptyStyleRecord(): StyleRecord {
  return {
    wins: 0,
    losses: 0,
  };
}

function formatRecord(record: StyleRecord) {
  return `${record.wins}-${record.losses}`;
}

function getOverallRecord(matches: WrestlerMatch[]) {
  return matches.reduce((record, match) => {
    if (match.result === "win") {
      record.wins += 1;
    }

    if (match.result === "loss") {
      record.losses += 1;
    }

    return record;
  }, createEmptyStyleRecord());
}

function getStyleRecord(matches: WrestlerMatch[], style: WrestlingStyle) {
  return matches
    .filter((match) => match.style === style)
    .reduce((record, match) => {
      if (match.result === "win") {
        record.wins += 1;
      }

      if (match.result === "loss") {
        record.losses += 1;
      }

      return record;
    }, createEmptyStyleRecord());
}

function formatMatchDate(value?: string) {
  if (!value) return "Date not set";

  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function listWrestlerMatchHistory(teamId: string, wrestlerId: string) {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.WRESTLER_MATCHES),
      where("teamId", "==", teamId),
      where("wrestlerId", "==", wrestlerId)
    )
  );

  return snapshot.docs
    .map((matchDoc) => ({
      id: matchDoc.id,
      ...(matchDoc.data() as Omit<WrestlerMatch, "id">),
    }))
    .sort((a, b) => {
      const aDate = sortValue(a.matchDate);
      const bDate = sortValue(b.matchDate);

      if (aDate !== bDate) {
        return bDate.localeCompare(aDate);
      }

      return sortValue(b.createdAt).localeCompare(sortValue(a.createdAt));
    });
}

function WrestleWellIQMatSideCard({
  summary,
}: {
  summary: ReturnType<typeof getWrestleWellIQSummary>;
}) {
  return (
    <View
      style={{
        marginTop: 14,
        padding: 14,
        borderRadius: 18,
        backgroundColor: summary.completed ? "#052e1b" : "#431407",
        borderWidth: 1,
        borderColor: summary.completed ? "#166534" : "#9a3412",
      }}
    >
      <Text
        style={{
          color: summary.completed ? "#bbf7d0" : "#fed7aa",
          fontSize: 12,
          fontWeight: "900",
          letterSpacing: 1,
          marginBottom: 6,
        }}
      >
        WRESTLEWELLIQ MAT-SIDE CUE
      </Text>

      <Text style={{ color: "#ffffff", fontSize: 17, fontWeight: "900" }}>
        {summary.label}
      </Text>

      <Text style={{ color: "#dbeafe", fontSize: 14, lineHeight: 21, marginTop: 8 }}>
        {summary.cue}
      </Text>
    </View>
  );
}

function RecentMatchHistoryCard({
  matches,
  activeStyle,
  loading,
}: {
  matches: WrestlerMatch[];
  activeStyle: WrestlingStyle;
  loading: boolean;
}) {
  const overallRecord = getOverallRecord(matches);
  const activeStyleRecord = getStyleRecord(matches, activeStyle);
  const recentMatches = matches.slice(0, 3);

  return (
    <View
      style={{
        marginTop: 14,
        padding: 14,
        borderRadius: 18,
        backgroundColor: "#102f52",
        borderWidth: 1,
        borderColor: "#315c86",
      }}
    >
      <Text
        style={{
          color: "#93c5fd",
          fontSize: 12,
          fontWeight: "900",
          letterSpacing: 1,
          marginBottom: 6,
        }}
      >
        RECENT MATCH HISTORY
      </Text>

      {loading ? (
        <Text style={{ color: "#b7c9df", fontSize: 14, lineHeight: 21 }}>
          Loading recent matches...
        </Text>
      ) : matches.length === 0 ? (
        <Text style={{ color: "#b7c9df", fontSize: 14, lineHeight: 21 }}>
          No match history saved yet. Completed Match-Day results will appear here.
        </Text>
      ) : (
        <>
          <View
            style={{
              flexDirection: "row",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <View
              style={{
                flex: 1,
                minWidth: 120,
                borderRadius: 16,
                padding: 12,
                backgroundColor: "#061a33",
                borderWidth: 1,
                borderColor: "#21486e",
              }}
            >
              <Text style={{ color: "#93c5fd", fontSize: 12, fontWeight: "900" }}>
                OVERALL
              </Text>

              <Text style={{ color: "#ffffff", fontSize: 24, fontWeight: "900", marginTop: 3 }}>
                {formatRecord(overallRecord)}
              </Text>
            </View>

            <View
              style={{
                flex: 1,
                minWidth: 120,
                borderRadius: 16,
                padding: 12,
                backgroundColor: "#061a33",
                borderWidth: 1,
                borderColor: "#21486e",
              }}
            >
              <Text style={{ color: "#93c5fd", fontSize: 12, fontWeight: "900" }}>
                {activeStyle.toUpperCase()}
              </Text>

              <Text style={{ color: "#ffffff", fontSize: 24, fontWeight: "900", marginTop: 3 }}>
                {formatRecord(activeStyleRecord)}
              </Text>
            </View>
          </View>

          <View style={{ gap: 10 }}>
            {recentMatches.map((match) => (
              <View
                key={match.id}
                style={{
                  borderWidth: 1,
                  borderColor: "#315c86",
                  borderRadius: 16,
                  padding: 12,
                  backgroundColor: "#0b2542",
                }}
              >
                <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "900" }}>
                  {match.result === "win" ? "Win" : "Loss"} vs{" "}
                  {match.opponentName || "Unknown opponent"}
                </Text>

                <Text style={{ color: "#b7c9df", fontSize: 14, lineHeight: 20, marginTop: 5 }}>
                  {[
                    match.style,
                    match.weightClass,
                    match.score,
                    match.method,
                    match.roundName,
                    match.boutNumber ? `Bout ${match.boutNumber}` : "",
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </Text>

                <Text style={{ color: "#93c5fd", fontSize: 13, marginTop: 5 }}>
                  {match.eventName || "Tournament"} • {formatMatchDate(match.matchDate)}
                </Text>

                {match.notes ? (
                  <Text style={{ color: "#dbeafe", fontSize: 14, lineHeight: 20, marginTop: 7 }}>
                    {match.notes}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

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

function EditField({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: "#ffffff", fontWeight: "900" }}>{label}</Text>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || "One item per line"}
        placeholderTextColor="#7c8da3"
        multiline
        textAlignVertical="top"
        style={{
          minHeight: 104,
          borderWidth: 1,
          borderColor: "#315c86",
          borderRadius: 16,
          paddingHorizontal: 13,
          paddingVertical: 12,
          backgroundColor: "#102f52",
          color: "#ffffff",
        }}
      />
    </View>
  );
}

function ActionPill({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? "#bf1029" : "#315c86",
        backgroundColor: active ? "#bf1029" : pressed ? "#173b67" : "#102f52",
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <Text style={{ color: "#ffffff", fontWeight: "900" }}>{label}</Text>
    </Pressable>
  );
}

export default function MatSideScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } =
    useMobileAuthState();
  const params = useLocalSearchParams<{ wrestlerId?: string }>();

  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [wrestlerUsers, setWrestlerUsers] = useState<Record<string, AppUser>>({});
  const [wrestlerMatches, setWrestlerMatches] = useState<WrestlerMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeStyle, setActiveStyle] = useState<WrestlingStyle>("Folkstyle");
  const [summary, setSummary] = useState<MatSideSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm, setEditForm] = useState<MatSideEditForm>(createEmptyEditForm);
  const [savingSummary, setSavingSummary] = useState(false);

  const isCoach = appUser?.role === "coach";

  async function refreshRoster() {
    if (!currentTeam?.id) {
      setWrestlers([]);
      setWrestlerUsers({});
      setWrestlerMatches([]);
      setSelectedId(null);
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

  async function refreshSummary(wrestlerId = selectedId) {
    if (!wrestlerId) {
      setSummary(null);
      return;
    }

    try {
      setLoadingSummary(true);
      setSummary(await getMatSideSummary(db, wrestlerId));
    } catch (error) {
      console.error("Failed to load mat-side summary:", error);
    } finally {
      setLoadingSummary(false);
    }
  }

  async function refreshMatchHistory(wrestlerId = selectedId) {
    if (!currentTeam?.id || !wrestlerId) {
      setWrestlerMatches([]);
      return;
    }

    try {
      setLoadingMatches(true);
      setWrestlerMatches(await listWrestlerMatchHistory(currentTeam.id, wrestlerId));
    } catch (error) {
      console.error("Failed to load mat-side match history:", error);
      setWrestlerMatches([]);
    } finally {
      setLoadingMatches(false);
    }
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
    refreshSummary(selectedId);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refreshMatchHistory(selectedId);
  }, [currentTeam?.id, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedWrestler = useMemo(
    () =>
      wrestlers.find((wrestler: WrestlerProfile) => wrestler.id === selectedId) ||
      null,
    [selectedId, wrestlers]
  );

  const selectedUser = selectedWrestler?.ownerUserId
    ? wrestlerUsers[selectedWrestler.ownerUserId] || null
    : null;

  const selectedWrestleWellIQ = getWrestleWellIQSummary(selectedUser);

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

  function openEditMatSide() {
    if (!isCoach || !selectedWrestler || !resolvedSummary) return;

    setEditForm(createEditFormFromSummary(resolvedSummary, activeStyle));
    setEditModalVisible(true);
  }

  function updateEditField<K extends keyof MatSideEditForm>(field: K, value: MatSideEditForm[K]) {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  }

  async function saveMatSideSummary() {
    if (!isCoach || !selectedWrestler) return;

    try {
      setSavingSummary(true);

      const existingStylePlans = summary?.stylePlans || {};
      const nextStylePlan: StyleMatSideSection = {
        quickReminders: textToList(editForm.styleQuickReminders),
        focusPoints: textToList(editForm.styleFocusPoints),
        gamePlan: textToList(editForm.styleGamePlan),
        recentNotes: textToList(editForm.styleRecentNotes),
      };

      const nextSummary: MatSideSummary = {
        wrestlerId: selectedWrestler.id,
        quickReminders: textToList(editForm.quickReminders),
        warmupChecklist: textToList(editForm.warmupChecklist),
        strengths: textToList(editForm.strengths),
        weaknesses: textToList(editForm.weaknesses),
        gamePlan: textToList(editForm.gamePlan),
        recentNotes: textToList(editForm.recentNotes),
        stylePlans: {
          ...existingStylePlans,
          [activeStyle]: nextStylePlan,
        },
        updatedAt: new Date().toISOString(),
      };

      await setDoc(doc(db, COLLECTIONS.MAT_SIDE_SUMMARIES, selectedWrestler.id), nextSummary, {
        merge: true,
      });

      setSummary(nextSummary);
      setEditModalVisible(false);
      Alert.alert("Mat-Side saved", "These notes will now appear in Match-Day.");
    } catch (error) {
      console.error("Failed to save mat-side summary:", error);
      Alert.alert("Save failed", "There was a problem saving these mat-side notes.");
    } finally {
      setSavingSummary(false);
    }
  }

  return (
    <MobileScreenShell
      title="Mat-Side"
      subtitle={
        isCoach
          ? "Quick coaching view for reminders, warm-up, strengths, weaknesses, match history, and match plan."
          : "Your match-prep view for reminders, warm-up, strengths, weaknesses, history, and game plan."
      }
    >
      <Modal
        visible={editModalVisible}
        animationType="slide"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <ScrollView
          style={{ flex: 1, backgroundColor: "#061a33" }}
          contentContainerStyle={{ padding: 18, gap: 14 }}
        >
          <Text style={{ color: "#ffffff", fontSize: 28, fontWeight: "900" }}>
            Edit Mat-Side
          </Text>

          {selectedWrestler ? (
            <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22 }}>
              {selectedWrestler.firstName} {selectedWrestler.lastName} • Active style: {activeStyle}
            </Text>
          ) : null}

          <View
            style={{
              borderWidth: 1,
              borderColor: "#315c86",
              borderRadius: 18,
              padding: 13,
              backgroundColor: "#102f52",
            }}
          >
            <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "900" }}>
              Coach note format
            </Text>

            <Text style={{ color: "#b7c9df", fontSize: 14, lineHeight: 20, marginTop: 6 }}>
              Put one item per line. These notes save to the wrestler’s mat-side summary and show in Match-Day.
            </Text>
          </View>

          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
            General Mat-Side Notes
          </Text>

          <EditField
            label="Quick Reminders"
            value={editForm.quickReminders}
            onChangeText={(value) => updateEditField("quickReminders", value)}
          />

          <EditField
            label="Warm-up Checklist"
            value={editForm.warmupChecklist}
            onChangeText={(value) => updateEditField("warmupChecklist", value)}
          />

          <EditField
            label="Strengths"
            value={editForm.strengths}
            onChangeText={(value) => updateEditField("strengths", value)}
          />

          <EditField
            label="Weaknesses"
            value={editForm.weaknesses}
            onChangeText={(value) => updateEditField("weaknesses", value)}
          />

          <EditField
            label="Game Plan"
            value={editForm.gamePlan}
            onChangeText={(value) => updateEditField("gamePlan", value)}
          />

          <EditField
            label="Recent Notes"
            value={editForm.recentNotes}
            onChangeText={(value) => updateEditField("recentNotes", value)}
          />

          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900", marginTop: 8 }}>
            {activeStyle} Style-Specific Notes
          </Text>

          <EditField
            label={`${activeStyle} Quick Reminders`}
            value={editForm.styleQuickReminders}
            onChangeText={(value) => updateEditField("styleQuickReminders", value)}
          />

          <EditField
            label={`${activeStyle} Focus Points`}
            value={editForm.styleFocusPoints}
            onChangeText={(value) => updateEditField("styleFocusPoints", value)}
          />

          <EditField
            label={`${activeStyle} Game Plan`}
            value={editForm.styleGamePlan}
            onChangeText={(value) => updateEditField("styleGamePlan", value)}
          />

          <EditField
            label={`${activeStyle} Recent Notes`}
            value={editForm.styleRecentNotes}
            onChangeText={(value) => updateEditField("styleRecentNotes", value)}
          />

          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <ActionPill
              label={savingSummary ? "Saving..." : "Save Mat-Side"}
              active
              onPress={saveMatSideSummary}
              disabled={savingSummary}
            />

            <ActionPill
              label="Cancel"
              onPress={() => setEditModalVisible(false)}
              disabled={savingSummary}
            />
          </View>
        </ScrollView>
      </Modal>

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
                  const wrestlerSummary = getWrestleWellIQSummary(
                    wrestler.ownerUserId ? wrestlerUsers[wrestler.ownerUserId] : null
                  );

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

                      <Text
                        style={{
                          fontSize: 13,
                          color: wrestlerSummary.completed ? "#bbf7d0" : "#fed7aa",
                          marginTop: 6,
                          fontWeight: "900",
                        }}
                      >
                        {wrestlerSummary.label}
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

              <WrestleWellIQMatSideCard summary={selectedWrestleWellIQ} />

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

              {isCoach ? (
                <Pressable
                  onPress={openEditMatSide}
                  style={{
                    marginTop: 14,
                    alignSelf: "flex-start",
                    paddingHorizontal: 16,
                    paddingVertical: 11,
                    borderRadius: 999,
                    backgroundColor: "#bf1029",
                  }}
                >
                  <Text style={{ fontWeight: "900", color: "#ffffff" }}>
                    Edit Mat-Side
                  </Text>
                </Pressable>
              ) : null}

              <RecentMatchHistoryCard
                matches={wrestlerMatches}
                activeStyle={activeStyle}
                loading={loadingMatches}
              />

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