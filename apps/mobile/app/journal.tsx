import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { db } from "@wrestlewell/firebase/client";
import {
  createJournalEntry,
  deleteJournalEntry,
  listMyJournalEntries,
  listWrestlersByOwnerUserId,
  updateJournalEntry,
} from "@wrestlewell/lib/index";
import type {
  AthleteJournalEntry,
  AthleteJournalMood,
  AthleteJournalTag,
  WrestlerProfile,
} from "@wrestlewell/types/index";
import {
  ATHLETE_JOURNAL_MOODS,
  ATHLETE_JOURNAL_TAGS,
} from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import {
  MobileScreenShell,
  WWBadge,
  WWCard,
} from "../components/mobile-screen-shell";

type JournalFormState = {
  title: string;
  body: string;
  mood: AthleteJournalMood;
  practiceDate: string;
  tags: AthleteJournalTag[];
  coachVisible: boolean;
};

function getTodayKey() {
  return new Date().toISOString().split("T")[0];
}

function createEmptyJournalForm(): JournalFormState {
  return {
    title: "",
    body: "",
    mood: "Okay",
    practiceDate: getTodayKey(),
    tags: ["Practice"],
    coachVisible: false,
  };
}

function createFormFromEntry(entry: AthleteJournalEntry): JournalFormState {
  return {
    title: entry.title,
    body: entry.body,
    mood: entry.mood,
    practiceDate: entry.practiceDate || getTodayKey(),
    tags: entry.tags,
    coachVisible: entry.coachVisible,
  };
}

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

function previewBody(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 150) return trimmed;
  return `${trimmed.slice(0, 147).trimEnd()}...`;
}

function fullName(wrestler?: WrestlerProfile | null) {
  return [wrestler?.firstName, wrestler?.lastName].filter(Boolean).join(" ").trim();
}

export default function JournalScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } = useMobileAuthState();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [wrestler, setWrestler] = useState<WrestlerProfile | null>(null);
  const [entries, setEntries] = useState<AthleteJournalEntry[]>([]);
  const [formVisible, setFormVisible] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [form, setForm] = useState<JournalFormState>(createEmptyJournalForm());

  const signedIn = Boolean(firebaseUser && appUser);
  const isAthlete = appUser?.role === "athlete";

  if (authLoading) {
    return (
      <MobileScreenShell
        title="Athlete Journal"
        subtitle="Loading your private reflections..."
      >
        <Text style={{ color: "#b7c9df" }}>Loading your journal...</Text>
      </MobileScreenShell>
    );
  }

  async function loadJournal() {
    if (!firebaseUser?.uid || !currentTeam?.id || !isAthlete) {
      setWrestler(null);
      setEntries([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const ownedWrestlers = await listWrestlersByOwnerUserId(
        db,
        firebaseUser.uid,
        currentTeam.id
      );
      const ownWrestler = ownedWrestlers[0] || null;
      setWrestler(ownWrestler);

      if (!ownWrestler) {
        setEntries([]);
        return;
      }

      setEntries(
        await listMyJournalEntries(db, {
          teamId: currentTeam.id,
          wrestlerId: ownWrestler.id,
          createdByUserId: firebaseUser.uid,
        })
      );
    } catch (error) {
      console.error("Failed to load journal entries:", error);
      Alert.alert("Journal unavailable", "We couldn’t load your journal entries right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadJournal();
  }, [currentTeam?.id, firebaseUser?.uid, isAthlete]); // eslint-disable-line react-hooks/exhaustive-deps

  const editingEntry = useMemo(
    () => entries.find((entry) => entry.id === editingEntryId) || null,
    [editingEntryId, entries]
  );

  function startCreate() {
    setEditingEntryId(null);
    setForm(createEmptyJournalForm());
    setFormVisible(true);
  }

  function startEdit(entry: AthleteJournalEntry) {
    setEditingEntryId(entry.id);
    setForm(createFormFromEntry(entry));
    setFormVisible(true);
  }

  function cancelEdit() {
    setEditingEntryId(null);
    setForm(createEmptyJournalForm());
    setFormVisible(false);
  }

  function toggleTag(tag: AthleteJournalTag) {
    setForm((current) => ({
      ...current,
      tags: current.tags.includes(tag)
        ? current.tags.filter((entry) => entry !== tag)
        : [...current.tags, tag],
    }));
  }

  async function handleSave() {
    if (!firebaseUser?.uid || !currentTeam?.id || !wrestler?.id) {
      return;
    }

    if (!form.title.trim() || !form.body.trim()) {
      Alert.alert("Missing details", "Add a title and a journal note before saving.");
      return;
    }

    if (!form.practiceDate.trim()) {
      Alert.alert("Missing date", "Add the practice or reflection date for this entry.");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        teamId: currentTeam.id,
        wrestlerId: wrestler.id,
        createdByUserId: firebaseUser.uid,
        title: form.title,
        body: form.body,
        mood: form.mood,
        practiceDate: form.practiceDate,
        tags: form.tags,
        coachVisible: form.coachVisible,
      };

      if (editingEntryId) {
        await updateJournalEntry(db, editingEntryId, payload);
      } else {
        await createJournalEntry(db, payload);
      }

      cancelEdit();
      await loadJournal();
    } catch (error) {
      console.error("Failed to save journal entry:", error);
      Alert.alert("Save failed", "We couldn’t save your journal entry. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry: AthleteJournalEntry) {
    Alert.alert("Delete entry?", "This journal entry will be removed from your history.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteJournalEntry(db, entry.id);
            if (editingEntryId === entry.id) {
              cancelEdit();
            }
            await loadJournal();
          } catch (error) {
            console.error("Failed to delete journal entry:", error);
            Alert.alert("Delete failed", "We couldn’t remove that journal entry.");
          }
        },
      },
    ]);
  }

  async function handleToggleCoachVisible(entry: AthleteJournalEntry) {
    try {
      await updateJournalEntry(db, entry.id, {
        teamId: entry.teamId,
        wrestlerId: entry.wrestlerId,
        createdByUserId: entry.createdByUserId,
        title: entry.title,
        body: entry.body,
        mood: entry.mood,
        practiceDate: entry.practiceDate,
        tags: entry.tags,
        coachVisible: !entry.coachVisible,
      });
      await loadJournal();
    } catch (error) {
      console.error("Failed to toggle coach visibility:", error);
      Alert.alert("Update failed", "We couldn’t update coach visibility right now.");
    }
  }

  if (!authLoading && !signedIn) {
    return (
      <MobileScreenShell
        title="Athlete Journal"
        subtitle="Sign in as an athlete to track practices, mindset, goals, and recovery."
      >
        <WWCard>
          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
            Sign in required
          </Text>
          <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
            Your journal is private to you unless you mark an entry coach-visible.
          </Text>
        </WWCard>
      </MobileScreenShell>
    );
  }

  return (
    <MobileScreenShell
      title="Athlete Journal"
      subtitle="Capture what happened in practice, how your body feels, and what you want coaches to see."
      eyebrow="PRIVATE ATHLETE JOURNAL"
    >
      <View style={{ gap: 14 }}>
        {!isAthlete ? (
          <WWCard>
            <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
              Athlete access only
            </Text>
            <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
              This first journal release is built for athletes. Parents do not see journal entries, and coaches only see entries you explicitly mark as coach-visible.
            </Text>
          </WWCard>
        ) : loading ? (
          <Text style={{ color: "#b7c9df" }}>Loading your journal...</Text>
        ) : !wrestler ? (
          <WWCard>
            <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
              No wrestler profile yet
            </Text>
            <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
              Connect your athlete profile first. Once your wrestler profile is linked, your private journal will show up here automatically.
            </Text>
          </WWCard>
        ) : (
          <>
            <WWCard>
              <View style={{ gap: 12 }}>
                <WWBadge label="PRIVATE REFLECTIONS" tone="white" />
                <Text style={{ color: "#ffffff", fontSize: 24, fontWeight: "900" }}>
                  {fullName(wrestler) || "My Journal"}
                </Text>
                <Text style={{ color: "#b7c9df", lineHeight: 22 }}>
                  Journal entries stay private unless you flip on coach visibility. Use them to track mindset, recovery, weight, goals, and what needs work next.
                </Text>
                <Pressable
                  testID="journal-create-button"
                  accessibilityLabel="journal-create-button"
                  onPress={startCreate}
                  style={({ pressed }) => ({
                    alignSelf: "flex-start",
                    paddingHorizontal: 16,
                    paddingVertical: 11,
                    borderRadius: 999,
                    backgroundColor: pressed ? "#991b1b" : "#bf1029",
                  })}
                >
                  <Text style={{ color: "#ffffff", fontWeight: "900" }}>
                    {formVisible && !editingEntryId ? "Creating entry" : "Create Journal Entry"}
                  </Text>
                </Pressable>
              </View>
            </WWCard>

            {formVisible ? (
              <WWCard>
                <View style={{ gap: 12 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#ffffff", fontSize: 22, fontWeight: "900" }}>
                        {editingEntry ? "Edit journal entry" : "New journal entry"}
                      </Text>
                      <Text style={{ color: "#b7c9df", marginTop: 6, lineHeight: 20 }}>
                        Save what you felt, what happened, and whether a coach should be able to read it.
                      </Text>
                    </View>
                    <WWBadge
                      label={form.coachVisible ? "COACH-VISIBLE" : "PRIVATE"}
                      tone={form.coachVisible ? "red" : "dark"}
                    />
                  </View>

                  <TextInput
                    testID="journal-title-input"
                    accessibilityLabel="journal-title-input"
                    value={form.title}
                    onChangeText={(title) => setForm((current) => ({ ...current, title }))}
                    placeholder="Title"
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
                    value={form.practiceDate}
                    onChangeText={(practiceDate) =>
                      setForm((current) => ({ ...current, practiceDate }))
                    }
                    placeholder="YYYY-MM-DD"
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

                  <View style={{ gap: 8 }}>
                    <Text style={{ color: "#93c5fd", fontWeight: "900", letterSpacing: 0.7 }}>
                      MOOD
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {ATHLETE_JOURNAL_MOODS.map((mood) => {
                        const active = form.mood === mood;
                        return (
                          <Pressable
                            key={mood}
                            testID={`journal-mood-${mood.toLowerCase()}-button`}
                            accessibilityLabel={`journal-mood-${mood.toLowerCase()}-button`}
                            onPress={() => setForm((current) => ({ ...current, mood }))}
                            style={({ pressed }) => ({
                              paddingHorizontal: 12,
                              paddingVertical: 9,
                              borderRadius: 999,
                              borderWidth: 1,
                              borderColor: active ? "#ffffff" : "#315c86",
                              backgroundColor: active
                                ? "#ffffff"
                                : pressed
                                  ? "#173b67"
                                  : "#102f52",
                            })}
                          >
                            <Text
                              style={{
                                color: active ? "#061a33" : "#dbeafe",
                                fontWeight: "900",
                                fontSize: 12,
                              }}
                            >
                              {mood}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <View style={{ gap: 8 }}>
                    <Text style={{ color: "#93c5fd", fontWeight: "900", letterSpacing: 0.7 }}>
                      TAGS
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {ATHLETE_JOURNAL_TAGS.map((tag) => {
                        const active = form.tags.includes(tag);
                        return (
                          <Pressable
                            key={tag}
                            testID={`journal-tag-${tag.toLowerCase()}-button`}
                            accessibilityLabel={`journal-tag-${tag.toLowerCase()}-button`}
                            onPress={() => toggleTag(tag)}
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
                            <Text
                              style={{
                                color: active ? "#fecaca" : "#dbeafe",
                                fontWeight: "900",
                                fontSize: 12,
                              }}
                            >
                              {tag}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <TextInput
                    testID="journal-body-input"
                    accessibilityLabel="journal-body-input"
                    value={form.body}
                    onChangeText={(body) => setForm((current) => ({ ...current, body }))}
                    placeholder="What happened today? What felt sharp, heavy, frustrating, or worth remembering?"
                    placeholderTextColor="#6b87aa"
                    multiline
                    textAlignVertical="top"
                    style={{
                      minHeight: 160,
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

                  <Pressable
                    testID="journal-coach-visible-toggle"
                    accessibilityLabel="journal-coach-visible-toggle"
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
                      {form.coachVisible ? "Coach can read this entry" : "Keep this entry private"}
                    </Text>
                    <Text style={{ color: "#b7c9df", marginTop: 6, lineHeight: 20 }}>
                      {form.coachVisible
                        ? "This entry can appear in future coach-facing review tools."
                        : "Only you can see this entry in the first release."}
                    </Text>
                  </Pressable>

                  <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                    <Pressable
                      testID="journal-save-button"
                      accessibilityLabel="journal-save-button"
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
                        {saving ? "Saving..." : editingEntry ? "Save Changes" : "Save Entry"}
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

            {entries.length === 0 ? (
              <WWCard>
                <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
                  No journal entries yet
                </Text>
                <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
                  Start with a quick reflection after practice, a tournament mindset note, or a recovery check-in so you can track patterns over time.
                </Text>
              </WWCard>
            ) : (
              entries.map((entry) => (
                <WWCard key={entry.id}>
                  <View testID="journal-entry-card" accessibilityLabel="journal-entry-card" style={{ gap: 12 }}>
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
                          {formatPracticeDate(entry.practiceDate)} • {entry.mood}
                        </Text>
                      </View>
                      <WWBadge
                        label={entry.coachVisible ? "COACH-VISIBLE" : "PRIVATE"}
                        tone={entry.coachVisible ? "red" : "dark"}
                      />
                    </View>

                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {entry.tags.map((tag) => (
                        <WWBadge key={`${entry.id}-${tag}`} label={tag.toUpperCase()} tone="blue" />
                      ))}
                    </View>

                    <Text style={{ color: "#dbeafe", lineHeight: 22 }}>
                      {previewBody(entry.body)}
                    </Text>

                    <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                      <Pressable
                        onPress={() => startEdit(entry)}
                        style={({ pressed }) => ({
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 999,
                          backgroundColor: pressed ? "#ffffff" : "#e2e8f0",
                        })}
                      >
                        <Text style={{ color: "#061a33", fontWeight: "900" }}>Edit</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => handleToggleCoachVisible(entry)}
                        style={({ pressed }) => ({
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: entry.coachVisible ? "#f87171" : "#315c86",
                          backgroundColor: entry.coachVisible
                            ? "rgba(191,16,41,0.18)"
                            : pressed
                              ? "#173b67"
                              : "#102f52",
                        })}
                      >
                        <Text
                          style={{
                            color: entry.coachVisible ? "#fecaca" : "#dbeafe",
                            fontWeight: "900",
                          }}
                        >
                          {entry.coachVisible ? "Hide from coach" : "Share with coach"}
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => handleDelete(entry)}
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
                </WWCard>
              ))
            )}
          </>
        )}
      </View>
    </MobileScreenShell>
  );
}
