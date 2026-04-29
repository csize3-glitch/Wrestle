import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { db } from "@wrestlewell/firebase/client";
import {
  createWrestler,
  listWrestlers,
  updateWrestler,
  WRESTLING_STYLES,
} from "@wrestlewell/lib/index";
import type { WrestlerInput } from "@wrestlewell/lib/index";
import type { WrestlerProfile, WrestlingStyle } from "@wrestlewell/types/index";
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

export default function WrestlersScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } = useMobileAuthState();
  const params = useLocalSearchParams<{ wrestlerId?: string }>();

  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [loading, setLoading] = useState(true);
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