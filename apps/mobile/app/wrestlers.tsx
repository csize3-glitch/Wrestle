import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@wrestlewell/firebase/client";
import {
  createWrestler,
  getAppUser,
  listWrestlers,
  updateWrestler,
  WRESTLING_STYLES,
} from "@wrestlewell/lib/index";
import type { WrestlerInput } from "@wrestlewell/lib/index";
import {
  COLLECTIONS,
  type AppUser,
  type VarkStyle,
  type WrestlerMatch,
  type WrestlerProfile,
  type WrestlingStyle,
} from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell } from "../components/mobile-screen-shell";
import { TeamInviteCard } from "../components/team-invite-card";

type AthleteProfileForm = {
  firstName: string;
  lastName: string;
  grade: string;
  weightClass: string;
  schoolOrClub: string;
  styles: WrestlingStyle[];
  strengths: string;
  weaknesses: string;
  warmupRoutine: string;
  keyAttacks: string;
  keyDefense: string;
  goals: string;
};

type StyleRecord = {
  wins: number;
  losses: number;
};

function createEmptyForm(): AthleteProfileForm {
  return {
    firstName: "",
    lastName: "",
    grade: "",
    weightClass: "",
    schoolOrClub: "",
    styles: [],
    strengths: "",
    weaknesses: "",
    warmupRoutine: "",
    keyAttacks: "",
    keyDefense: "",
    goals: "",
  };
}

function listToText(items: string[]) {
  return items.join("\n");
}

function textToList(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createFormFromWrestler(wrestler: WrestlerProfile | null): AthleteProfileForm {
  if (!wrestler) return createEmptyForm();

  return {
    firstName: wrestler.firstName || "",
    lastName: wrestler.lastName || "",
    grade: wrestler.grade || "",
    weightClass: wrestler.weightClass || "",
    schoolOrClub: wrestler.schoolOrClub || "",
    styles: wrestler.styles || [],
    strengths: listToText(wrestler.strengths),
    weaknesses: listToText(wrestler.weaknesses),
    warmupRoutine: listToText(wrestler.warmupRoutine),
    keyAttacks: listToText(wrestler.keyAttacks),
    keyDefense: listToText(wrestler.keyDefense),
    goals: listToText(wrestler.goals),
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

function createEmptyStyleRecords(): Record<WrestlingStyle, StyleRecord> {
  return {
    Folkstyle: { wins: 0, losses: 0 },
    Freestyle: { wins: 0, losses: 0 },
    "Greco-Roman": { wins: 0, losses: 0 },
  };
}

function formatRecord(record: StyleRecord) {
  return `${record.wins}-${record.losses}`;
}

function getOverallRecord(matches: WrestlerMatch[]): StyleRecord {
  return matches.reduce(
    (record, match) => {
      if (match.result === "win") {
        record.wins += 1;
      }

      if (match.result === "loss") {
        record.losses += 1;
      }

      return record;
    },
    { wins: 0, losses: 0 }
  );
}

function getRecordByStyle(matches: WrestlerMatch[]) {
  const records = createEmptyStyleRecords();

  matches.forEach((match) => {
    if (match.result !== "win" && match.result !== "loss") return;

    const style = match.style;
    if (!records[style]) return;

    if (match.result === "win") {
      records[style].wins += 1;
    } else {
      records[style].losses += 1;
    }
  });

  return records;
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
      const aDate = a.matchDate || "";
      const bDate = b.matchDate || "";

      if (aDate !== bDate) {
        return bDate.localeCompare(aDate);
      }

      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
}

function SectionList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;

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

function Field({
  label,
  multiline,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  multiline?: boolean;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontWeight: "900", color: "#ffffff" }}>{label}</Text>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#7c8da3"
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={{
          minHeight: multiline ? 104 : 48,
          borderWidth: 1,
          borderColor: "#315c86",
          borderRadius: 16,
          paddingHorizontal: 13,
          paddingVertical: multiline ? 12 : 0,
          backgroundColor: "#102f52",
          color: "#ffffff",
        }}
      />
    </View>
  );
}

function WrestleWellIQCard({ summary }: { summary: ReturnType<typeof getWrestleWellIQSummary> }) {
  return (
    <View
      style={{
        marginTop: 16,
        borderWidth: 1,
        borderColor: summary.completed ? "#166534" : "#9a3412",
        borderRadius: 20,
        padding: 14,
        backgroundColor: summary.completed ? "#052e1b" : "#431407",
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
        WRESTLEWELLIQ
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

function MatchHistoryCard({ matches }: { matches: WrestlerMatch[] }) {
  const overallRecord = getOverallRecord(matches);
  const styleRecords = getRecordByStyle(matches);
  const recentMatches = matches.slice(0, 8);

  return (
    <View
      style={{
        marginTop: 18,
        borderWidth: 1,
        borderColor: "#315c86",
        borderRadius: 20,
        padding: 14,
        backgroundColor: "#102f52",
      }}
    >
      <Text
        style={{
          color: "#ffffff",
          fontSize: 18,
          fontWeight: "900",
          marginBottom: 8,
        }}
      >
        Match History
      </Text>

      {matches.length === 0 ? (
        <Text style={{ color: "#b7c9df", fontSize: 14, lineHeight: 21 }}>
          No saved match history yet. Complete matches from Match-Day to build this wrestler’s record.
        </Text>
      ) : (
        <>
          <View
            style={{
              borderRadius: 18,
              padding: 13,
              backgroundColor: "#061a33",
              borderWidth: 1,
              borderColor: "#21486e",
              marginBottom: 12,
            }}
          >
            <Text style={{ color: "#93c5fd", fontSize: 12, fontWeight: "900" }}>
              OVERALL RECORD
            </Text>

            <Text style={{ color: "#ffffff", fontSize: 30, fontWeight: "900", marginTop: 4 }}>
              {formatRecord(overallRecord)}
            </Text>

            <Text style={{ color: "#b7c9df", fontSize: 13, marginTop: 2 }}>
              {matches.length} saved match{matches.length === 1 ? "" : "es"}
            </Text>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {WRESTLING_STYLES.map((style) => (
              <View
                key={style}
                style={{
                  flex: 1,
                  minWidth: 120,
                  borderRadius: 16,
                  padding: 12,
                  backgroundColor: "#0b2542",
                  borderWidth: 1,
                  borderColor: "#315c86",
                }}
              >
                <Text style={{ color: "#93c5fd", fontSize: 12, fontWeight: "900" }}>
                  {style}
                </Text>

                <Text style={{ color: "#ffffff", fontSize: 22, fontWeight: "900", marginTop: 4 }}>
                  {formatRecord(styleRecords[style])}
                </Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 16, gap: 10 }}>
            <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "900" }}>
              Recent Matches
            </Text>

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

export default function WrestlersScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } = useMobileAuthState();
  const params = useLocalSearchParams<{ wrestlerId?: string }>();

  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [wrestlerUsers, setWrestlerUsers] = useState<Record<string, AppUser>>({});
  const [wrestlerMatches, setWrestlerMatches] = useState<WrestlerMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AthleteProfileForm>(createEmptyForm);

  const isCoach = appUser?.role === "coach";

  const teamName =
    currentTeam?.name ||
    currentTeam?.teamName ||
    currentTeam?.displayName ||
    "Your Team";

  async function refresh() {
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
        await refresh();
      } catch (error) {
        console.error("Failed to load wrestlers:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [currentTeam?.id, params.wrestlerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(
    () => wrestlers.find((wrestler: WrestlerProfile) => wrestler.id === selectedId) || null,
    [selectedId, wrestlers]
  );

  useEffect(() => {
    async function loadMatchHistory() {
      if (!currentTeam?.id || !selected?.id) {
        setWrestlerMatches([]);
        return;
      }

      try {
        setLoadingMatches(true);
        setWrestlerMatches(await listWrestlerMatchHistory(currentTeam.id, selected.id));
      } catch (error) {
        console.error("Failed to load wrestler match history:", error);
        setWrestlerMatches([]);
      } finally {
        setLoadingMatches(false);
      }
    }

    loadMatchHistory();
  }, [currentTeam?.id, selected?.id]);

  const selectedUser = selected?.ownerUserId ? wrestlerUsers[selected.ownerUserId] || null : null;
  const selectedWrestleWellIQ = getWrestleWellIQSummary(selectedUser);

  const athleteOwnedWrestler = useMemo(
    () =>
      appUser?.role === "athlete" && firebaseUser
        ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) || null
        : null,
    [appUser?.role, firebaseUser, wrestlers]
  );

  useEffect(() => {
    if (appUser?.role !== "athlete") return;
    setForm(createFormFromWrestler(athleteOwnedWrestler));
  }, [appUser?.role, athleteOwnedWrestler]);

  function toggleStyle(style: WrestlingStyle) {
    setForm((prev) => ({
      ...prev,
      styles: prev.styles.includes(style)
        ? prev.styles.filter((item) => item !== style)
        : [...prev.styles, style],
    }));
  }

  function updateField<K extends keyof AthleteProfileForm>(
    field: K,
    value: AthleteProfileForm[K]
  ) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function saveAthleteProfile() {
    if (!firebaseUser || !currentTeam?.id || appUser?.role !== "athlete") return;

    if (!form.firstName.trim() || !form.lastName.trim()) {
      Alert.alert("Profile incomplete", "Please add your first and last name before saving.");
      return;
    }

    const payload: WrestlerInput = {
      teamId: currentTeam.id,
      ownerUserId: firebaseUser.uid,
      firstName: form.firstName,
      lastName: form.lastName,
      grade: form.grade,
      weightClass: form.weightClass,
      schoolOrClub: form.schoolOrClub,
      styles: form.styles,
      strengths: textToList(form.strengths),
      weaknesses: textToList(form.weaknesses),
      warmupRoutine: textToList(form.warmupRoutine),
      keyAttacks: textToList(form.keyAttacks),
      keyDefense: textToList(form.keyDefense),
      goals: textToList(form.goals),
      coachNotes: athleteOwnedWrestler?.coachNotes,
    };

    try {
      setSaving(true);

      if (athleteOwnedWrestler?.id) {
        await updateWrestler(db, athleteOwnedWrestler.id, payload);
      } else {
        await createWrestler(db, payload);
      }

      await refresh();
      Alert.alert("Profile saved", "Your wrestler profile is now updated on mobile.");
    } catch (error) {
      console.error("Failed to save athlete wrestler profile:", error);
      Alert.alert("Save failed", "There was a problem saving your wrestler profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <MobileScreenShell
      title="Wrestlers"
      subtitle={
        isCoach
          ? "Review your team roster, invite athletes and coaches, and open mat-side notes."
          : "Build your wrestler profile and keep your mat-side details ready."
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
            Sign in on the home screen to access your team roster.
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
            Your profile is editable on mobile. Coaches can still add coach-only notes on the website.
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => {
          setLoading(true);
          refresh().finally(() => setLoading(false));
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
        <Text style={{ color: "#b7c9df", marginBottom: 16 }}>Loading roster...</Text>
      ) : null}

      {firebaseUser && appUser ? (
        <View style={{ gap: 14 }}>
          {isCoach && currentTeam ? (
            <TeamInviteCard
              teamName={teamName}
              teamCode={currentTeam.teamCode}
              coachInviteCode={currentTeam.coachInviteCode}
            />
          ) : null}

          {!loading && wrestlers.length === 0 && isCoach ? (
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
                No wrestler profiles yet. Share your team code above or add wrestlers on the web app.
              </Text>
            </View>
          ) : null}

          {!isCoach ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: "#21486e",
                borderRadius: 24,
                padding: 16,
                backgroundColor: "#0b2542",
                gap: 14,
              }}
            >
              <Text style={{ fontSize: 23, fontWeight: "900", color: "#ffffff" }}>
                {athleteOwnedWrestler ? "My Profile" : "Create My Profile"}
              </Text>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="First Name"
                    value={form.firstName}
                    onChangeText={(value) => updateField("firstName", value)}
                    placeholder="Chris"
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Field
                    label="Last Name"
                    value={form.lastName}
                    onChangeText={(value) => updateField("lastName", value)}
                    placeholder="Miller"
                  />
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Grade"
                    value={form.grade}
                    onChangeText={(value) => updateField("grade", value)}
                    placeholder="10th"
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Field
                    label="Weight Class"
                    value={form.weightClass}
                    onChangeText={(value) => updateField("weightClass", value)}
                    placeholder="132"
                  />
                </View>
              </View>

              <Field
                label="School or Club"
                value={form.schoolOrClub}
                onChangeText={(value) => updateField("schoolOrClub", value)}
                placeholder="Bearcats Wrestling Club"
              />

              <View style={{ gap: 8 }}>
                <Text style={{ fontWeight: "900", color: "#ffffff" }}>Styles</Text>

                <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                  {WRESTLING_STYLES.map((style) => {
                    const active = form.styles.includes(style);

                    return (
                      <Pressable
                        key={style}
                        onPress={() => toggleStyle(style)}
                        style={{
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 999,
                          backgroundColor: active ? "#bf1029" : "#102f52",
                          borderWidth: 1,
                          borderColor: active ? "#bf1029" : "#315c86",
                        }}
                      >
                        <Text
                          style={{
                            color: active ? "#ffffff" : "#dbeafe",
                            fontWeight: "900",
                          }}
                        >
                          {style}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <Field
                label="Strengths"
                value={form.strengths}
                onChangeText={(value) => updateField("strengths", value)}
                placeholder="One item per line"
                multiline
              />

              <Field
                label="Weaknesses"
                value={form.weaknesses}
                onChangeText={(value) => updateField("weaknesses", value)}
                placeholder="One item per line"
                multiline
              />

              <Field
                label="Warm-up Routine"
                value={form.warmupRoutine}
                onChangeText={(value) => updateField("warmupRoutine", value)}
                placeholder="One item per line"
                multiline
              />

              <Field
                label="Key Attacks"
                value={form.keyAttacks}
                onChangeText={(value) => updateField("keyAttacks", value)}
                placeholder="One item per line"
                multiline
              />

              <Field
                label="Key Defense"
                value={form.keyDefense}
                onChangeText={(value) => updateField("keyDefense", value)}
                placeholder="One item per line"
                multiline
              />

              <Field
                label="Goals"
                value={form.goals}
                onChangeText={(value) => updateField("goals", value)}
                placeholder="One item per line"
                multiline
              />

              <Pressable
                onPress={saveAthleteProfile}
                style={{
                  minHeight: 50,
                  borderRadius: 18,
                  backgroundColor: "#bf1029",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>
                  {saving
                    ? "Saving..."
                    : athleteOwnedWrestler
                      ? "Save My Profile"
                      : "Create My Profile"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {isCoach && wrestlers.length > 0 ? (
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
                      <Text style={{ fontSize: 16, fontWeight: "900", color: "#ffffff" }}>
                        {fullName || "Unnamed Wrestler"}
                      </Text>

                      <Text style={{ fontSize: 14, color: "#b7c9df", marginTop: 4 }}>
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

          {selected ? (
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
                {selected.firstName} {selected.lastName}
              </Text>

              <Text style={{ fontSize: 15, color: "#b7c9df", marginTop: 8, lineHeight: 22 }}>
                {[selected.weightClass, selected.grade, selected.schoolOrClub]
                  .filter(Boolean)
                  .join(" • ") || "Add more profile details here to round this out."}
              </Text>

              {selected.styles.length ? (
                <Text style={{ fontSize: 15, color: "#93c5fd", marginTop: 8, fontWeight: "800" }}>
                  Styles: {selected.styles.join(", ")}
                </Text>
              ) : null}

              <WrestleWellIQCard summary={selectedWrestleWellIQ} />

              {loadingMatches ? (
                <View
                  style={{
                    marginTop: 18,
                    borderWidth: 1,
                    borderColor: "#315c86",
                    borderRadius: 20,
                    padding: 14,
                    backgroundColor: "#102f52",
                  }}
                >
                  <Text style={{ color: "#b7c9df", fontSize: 14 }}>
                    Loading match history...
                  </Text>
                </View>
              ) : (
                <MatchHistoryCard matches={wrestlerMatches} />
              )}

              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/mat-side",
                      params: { wrestlerId: selected.id },
                    } as any)
                  }
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 11,
                    borderRadius: 999,
                    backgroundColor: "#bf1029",
                  }}
                >
                  <Text style={{ color: "#ffffff", fontWeight: "900" }}>
                    {isCoach ? "Open Mat-Side" : "Open My Mat-Side"}
                  </Text>
                </Pressable>
              </View>

              <SectionList title="Strengths" items={selected.strengths} />
              <SectionList title="Weaknesses" items={selected.weaknesses} />
              <SectionList title="Warm-up Routine" items={selected.warmupRoutine} />
              <SectionList title="Key Attacks" items={selected.keyAttacks} />
              <SectionList title="Key Defense" items={selected.keyDefense} />
              <SectionList title="Goals" items={selected.goals} />

              {selected.coachNotes ? (
                <View style={{ marginTop: 18 }}>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "900",
                      marginBottom: 8,
                      color: "#ffffff",
                    }}
                  >
                    Coach Notes
                  </Text>

                  <Text style={{ fontSize: 15, lineHeight: 22, color: "#dbeafe" }}>
                    {selected.coachNotes}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </MobileScreenShell>
  );
}