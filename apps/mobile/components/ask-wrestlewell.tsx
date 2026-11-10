import { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { db } from "@wrestlewell/firebase/client";
import { listWrestlers } from "@wrestlewell/lib/index";
import type { WrestlerProfile } from "@wrestlewell/types/index";

/** iPhone keyboard dictation works in Expo Go; this does not access the microphone directly. */
export function AskWrestleWell({ teamId, selectedAthlete }: {
  teamId?: string;
  selectedAthlete?: WrestlerProfile | null;
}) {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    const text = command.trim();
    if (!text || !teamId || busy) return;
    setBusy(true);
    try {
      const athletes = await listWrestlers(db, teamId);
      const lower = text.toLowerCase();
      const named = athletes.filter((a) => {
        const first = (a.firstName || "").trim().toLowerCase();
        const full = `${first} ${(a.lastName || "").trim().toLowerCase()}`.trim();
        const words = lower.replace(/[^a-z0-9]+/g, " ").split(" ");
        return (full.length > 0 && lower.includes(full)) || (first.length > 0 && words.includes(first));
      });
      const athlete = named.length === 1 ? named[0] : named.length > 1 ? null : selectedAthlete;
      if (!athlete) {
        Alert.alert("Choose an athlete", named.length > 1
          ? "More than one athlete matches that name. Please use the full name."
          : "I couldn't find that athlete on your team. Try their full name.");
        return;
      }
      const wantsRead = /\b(read|say|speak|tell me|out loud|aloud)\b/i.test(text);
      const lastThree = /last\s*(three|3)\s*(matches|match|notes)|(?:three|3)\s*(most recent)\s*matches/i.test(text);
      const tournament = /(?:last|latest|most recent)\s*tournament/i.test(text);
      const matSide = /mat[ -]?side|summary|strengths|weaknesses|work on|focus areas/i.test(text);
      if (!lastThree && !tournament && !matSide) {
        Alert.alert("Try a match-notes question", "Try: Show me Carter's Mat-Side Summary, Carter's last 3 matches, or Carter's last tournament.");
        return;
      }
      setOpen(false);
      setCommand("");
      router.push({ pathname: "/mat-side", params: {
        wrestlerId: athlete.id,
        askView: lastThree ? "three" : tournament ? "tournament" : "summary",
        askToken: String(Date.now()),
        askRead: wantsRead ? "yes" : "no",
      } } as any);
    } catch (error) {
      console.error("Ask WrestleWell lookup failed:", error);
      Alert.alert("Unable to look up athletes", "Check your connection and try again.");
    } finally { setBusy(false); }
  }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Ask WrestleWell" onPress={() => setOpen(true)}
      style={{ padding: 14, borderRadius: 14, backgroundColor: "#163d62", borderWidth: 1, borderColor: "#315c86" }}>
      <Text style={{ color: "white", fontWeight: "900", fontSize: 16 }}>🎙 Ask WrestleWell</Text>
      <Text style={{ color: "#b7c9df", marginTop: 3, fontSize: 12 }}>Type or use iPhone keyboard dictation</Text>
    </Pressable>
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, backgroundColor: "#061a33", padding: 22, gap: 16 }}>
        <Text style={{ color: "white", fontSize: 25, fontWeight: "900" }}>Ask WrestleWell</Text>
        <Text style={{ color: "#b7c9df", lineHeight: 22 }}>Tap the field, then use the microphone on your iPhone keyboard to speak. Review the words before submitting.</Text>
        <TextInput accessibilityLabel="Question for WrestleWell" value={command} onChangeText={setCommand}
          placeholder="Show me Carter's Mat-Side Summary" placeholderTextColor="#8da4bd" multiline
          style={{ color: "white", backgroundColor: "#102f52", borderRadius: 14, padding: 16, minHeight: 110, textAlignVertical: "top" }} />
        <Text style={{ color: "#b7c9df" }}>Try: “Read Carter's Mat-Side Summary” or “Read Carter's last 3 matches.”</Text>
        <Pressable accessibilityRole="button" onPress={submit} disabled={busy || !command.trim()}
          style={{ backgroundColor: "#bf1029", padding: 16, borderRadius: 12, opacity: busy ? 0.6 : 1 }}>
          <Text style={{ color: "white", textAlign: "center", fontWeight: "900" }}>{busy ? "Looking up athlete…" : "Show Results"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={{ padding: 14 }}>
          <Text style={{ color: "#b7c9df", textAlign: "center" }}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </Modal>
  </>;
}
