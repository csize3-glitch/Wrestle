import { Link, useLocalSearchParams } from "expo-router";
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
import { ScreenShell } from "../components/screen-shell";

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
  if (!wrestler) {
    return createEmptyForm();
  }

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
      <Text style={{ fontWeight: "700", color: "#0f2748" }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={{
          minHeight: multiline ? 104 : 46,
          borderWidth: 1,
          borderColor: "rgba(15, 39, 72, 0.12)",
          borderRadius: 14,
          paddingHorizontal: 12,
          paddingVertical: multiline ? 12 : 0,
          backgroundColor: "#ffffff",
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
  }, [currentTeam?.id, params.wrestlerId]);

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
    if (appUser?.role !== "athlete") {
      return;
    }

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

  function updateField<K extends keyof AthleteProfileForm>(field: K, value: AthleteProfileForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function saveAthleteProfile() {
    if (!firebaseUser || !currentTeam?.id || appUser?.role !== "athlete") {
      return;
    }

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
            Sign in on the home screen to access your team roster.
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

        <Link href="/mat-side" asChild>
          <Pressable
            style={{
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 999,
              backgroundColor: "#111827",
            }}
          >
            <Text style={{ fontWeight: "700", color: "#fff" }}>Go to Mat-Side</Text>
          </Pressable>
        </Link>
      </View>

      <Text style={{ fontSize: 28, fontWeight: "700", marginBottom: 12 }}>Wrestlers</Text>
      <Text style={{ fontSize: 16, color: "#555", marginBottom: 20 }}>
        {isCoach
          ? "Synced wrestler profiles from the web app. Start on the roster, then jump straight into the mat-side view for the selected wrestler."
          : "Build and update your own wrestler profile here, then use mat-side and practice tools from the same phone."}
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
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 999,
          backgroundColor: "#111827",
          marginBottom: 20,
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "700" }}>{loading ? "Refreshing..." : "Refresh"}</Text>
      </Pressable>

      {loading ? <Text>Loading roster...</Text> : null}

      {!loading && wrestlers.length === 0 && isCoach ? (
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
            No wrestler profiles yet. Add them on the web app and they will appear here.
          </Text>
        </View>
      ) : null}

      {firebaseUser && appUser ? (
        <View style={{ gap: 14 }}>
          {!isCoach ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 16,
                padding: 16,
                backgroundColor: "#fff",
                gap: 14,
              }}
            >
              <Text style={{ fontSize: 22, fontWeight: "700", color: "#091729" }}>
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
                <Text style={{ fontWeight: "700", color: "#0f2748" }}>Styles</Text>
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
                          backgroundColor: active ? "#bf1029" : "#ffffff",
                          borderWidth: 1,
                          borderColor: active ? "#bf1029" : "rgba(15, 39, 72, 0.12)",
                        }}
                      >
                        <Text style={{ color: active ? "#fff" : "#0f2748", fontWeight: "700" }}>
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
                  minHeight: 48,
                  borderRadius: 16,
                  backgroundColor: "#bf1029",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>
                  {saving ? "Saving..." : athleteOwnedWrestler ? "Save My Profile" : "Create My Profile"}
                </Text>
              </Pressable>
            </View>
          ) : null}

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

          {selected ? (
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
                {selected.firstName} {selected.lastName}
              </Text>

              <Text style={{ fontSize: 15, color: "#555", marginTop: 8, lineHeight: 22 }}>
                {[selected.weightClass, selected.grade, selected.schoolOrClub]
                  .filter(Boolean)
                  .join(" • ") || "Add more profile details here to round this out."}
              </Text>

              {selected.styles.length ? (
                <Text style={{ fontSize: 15, color: "#555", marginTop: 8 }}>
                  Styles: {selected.styles.join(", ")}
                </Text>
              ) : null}

              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                <Link href={{ pathname: "/mat-side", params: { wrestlerId: selected.id } }} asChild>
                  <Pressable
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: 999,
                      backgroundColor: "#111827",
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700" }}>
                      {isCoach ? "Open Mat-Side" : "Open My Mat-Side"}
                    </Text>
                  </Pressable>
                </Link>
              </View>

              <SectionList title="Strengths" items={selected.strengths} />
              <SectionList title="Weaknesses" items={selected.weaknesses} />
              <SectionList title="Warm-up Routine" items={selected.warmupRoutine} />
              <SectionList title="Key Attacks" items={selected.keyAttacks} />
              <SectionList title="Key Defense" items={selected.keyDefense} />
              <SectionList title="Goals" items={selected.goals} />

              {selected.coachNotes ? (
                <View style={{ marginTop: 18 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 8 }}>Coach Notes</Text>
                  <Text style={{ fontSize: 15, lineHeight: 22 }}>{selected.coachNotes}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </ScreenShell>
  );
}
