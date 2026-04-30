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
import { db } from "@wrestlewell/firebase/client";
import {
  buildTournamentMatchInputFromParsedMatch,
  createTournamentMatch,
  deleteTournamentMatch,
  getMatSideSummary,
  listTournamentEntries,
  listTournamentMatches,
  listTournaments,
  listWrestlers,
  mergeMatSideSummaryWithProfile,
  parseBracketTextToMatches,
  saveTournamentMatchToWrestlerHistory,
  updateTournamentMatch,
  type ParsedBracketMatch,
} from "@wrestlewell/lib/index";
import type {
  MatSideSummary,
  Tournament,
  TournamentEntry,
  TournamentMatch,
  TournamentMatchMethod,
  TournamentMatchStatus,
  WrestlerProfile,
  WrestlingStyle,
} from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell } from "../components/mobile-screen-shell";

const STYLE_OPTIONS: WrestlingStyle[] = ["Folkstyle", "Freestyle", "Greco-Roman"];

type MatchDayWrestler = WrestlerProfile & {
  tournamentEntry?: TournamentEntry;
};

type MatchFormState = {
  boutNumber: string;
  matNumber: string;
  roundName: string;
  opponentName: string;
  opponentTeam: string;
  status: TournamentMatchStatus;
  result: "" | "win" | "loss";
  score: string;
  method: "" | TournamentMatchMethod;
  notes: string;
};

function createEmptyMatchForm(): MatchFormState {
  return {
    boutNumber: "",
    matNumber: "",
    roundName: "",
    opponentName: "",
    opponentTeam: "",
    status: "upcoming",
    result: "",
    score: "",
    method: "",
    notes: "",
  };
}

function createFormFromMatch(match: TournamentMatch): MatchFormState {
  return {
    boutNumber: match.boutNumber || "",
    matNumber: match.matNumber || "",
    roundName: match.roundName || "",
    opponentName: match.opponentName || "",
    opponentTeam: match.opponentTeam || "",
    status: match.status,
    result: match.result || "",
    score: match.score || "",
    method: match.method || "",
    notes: match.notes || "",
  };
}

function formatDate(value?: string) {
  if (!value) return "Date not set";

  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function getFullName(wrestler?: Pick<WrestlerProfile, "firstName" | "lastName"> | null) {
  return [wrestler?.firstName, wrestler?.lastName].filter(Boolean).join(" ").trim();
}

function getMatchTitle(match: TournamentMatch) {
  return [
    match.boutNumber ? `Bout ${match.boutNumber}` : "",
    match.matNumber ? `Mat ${match.matNumber}` : "",
  ]
    .filter(Boolean)
    .join(" • ");
}

function SummarySection({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;

  return (
    <View style={{ marginTop: 18 }}>
      <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "900", marginBottom: 8 }}>
        {title}
      </Text>

      <View style={{ gap: 6 }}>
        {items.map((item, index) => (
          <Text
            key={`${title}-${index}-${item}`}
            style={{ color: "#dbeafe", fontSize: 15, lineHeight: 22 }}
          >
            • {item}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Pill({
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

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: "#ffffff", fontWeight: "900" }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#7c8da3"
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={{
          minHeight: multiline ? 96 : 48,
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

export default function MatchDayScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } = useMobileAuthState();
  const params = useLocalSearchParams<{ tournamentId?: string; wrestlerId?: string }>();

  const [loading, setLoading] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [entries, setEntries] = useState<TournamentEntry[]>([]);
  const [teamRoster, setTeamRoster] = useState<WrestlerProfile[]>([]);
  const [matches, setMatches] = useState<TournamentMatch[]>([]);

  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [selectedWrestlerId, setSelectedWrestlerId] = useState<string | null>(null);
  const [summary, setSummary] = useState<MatSideSummary | null>(null);
  const [activeStyle, setActiveStyle] = useState<WrestlingStyle>("Folkstyle");

  const [matchModalVisible, setMatchModalVisible] = useState(false);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [matchForm, setMatchForm] = useState<MatchFormState>(createEmptyMatchForm);
  const [savingMatch, setSavingMatch] = useState(false);
  const [deletingMatchId, setDeletingMatchId] = useState<string | null>(null);

  const [bracketModalVisible, setBracketModalVisible] = useState(false);
  const [bracketText, setBracketText] = useState("");
  const [parsedMatches, setParsedMatches] = useState<ParsedBracketMatch[]>([]);
  const [selectedParsedIds, setSelectedParsedIds] = useState<string[]>([]);
  const [savingParsedMatches, setSavingParsedMatches] = useState(false);

  const isCoach = appUser?.role === "coach";

  const sortedTournaments = useMemo(() => {
    const todayKey = new Date().toISOString().split("T")[0];

    return tournaments.slice().sort((a, b) => {
      const aDate = a.eventDate || "9999-12-31";
      const bDate = b.eventDate || "9999-12-31";
      const aUpcoming = aDate >= todayKey;
      const bUpcoming = bDate >= todayKey;

      if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
      return aDate.localeCompare(bDate);
    });
  }, [tournaments]);

  const selectedTournament = useMemo(
    () => tournaments.find((tournament) => tournament.id === selectedTournamentId) || null,
    [selectedTournamentId, tournaments]
  );

  const confirmedEntries = useMemo(
    () => entries.filter((entry) => entry.status === "confirmed"),
    [entries]
  );

  const matchDayRoster = useMemo<MatchDayWrestler[]>(() => {
    if (confirmedEntries.length > 0) {
      return confirmedEntries
        .map((entry) => {
          const wrestler = teamRoster.find((row) => row.id === entry.wrestlerId);
          if (!wrestler) return null;

          return {
            ...wrestler,
            weightClass: entry.weightClass || wrestler.weightClass,
            tournamentEntry: entry,
          };
        })
        .filter((row): row is MatchDayWrestler => Boolean(row))
        .sort((a, b) => {
          const aWeight = Number(String(a.weightClass || "").replace(/[^0-9.]/g, ""));
          const bWeight = Number(String(b.weightClass || "").replace(/[^0-9.]/g, ""));

          if (Number.isFinite(aWeight) && Number.isFinite(bWeight) && aWeight !== bWeight) {
            return aWeight - bWeight;
          }

          return getFullName(a).localeCompare(getFullName(b));
        });
    }

    return teamRoster.slice().sort((a, b) => getFullName(a).localeCompare(getFullName(b)));
  }, [confirmedEntries, teamRoster]);

  const selectedIndex = useMemo(
    () => matchDayRoster.findIndex((wrestler) => wrestler.id === selectedWrestlerId),
    [matchDayRoster, selectedWrestlerId]
  );

  const selectedWrestler = selectedIndex >= 0 ? matchDayRoster[selectedIndex] : null;

  const selectedEntry = useMemo(() => {
    if (selectedWrestler?.tournamentEntry) return selectedWrestler.tournamentEntry;
    return confirmedEntries.find((entry) => entry.wrestlerId === selectedWrestlerId) || null;
  }, [confirmedEntries, selectedWrestler, selectedWrestlerId]);

  const selectedWrestlerMatches = useMemo(() => {
    if (!selectedWrestlerId) return [];
    return matches.filter((match) => match.wrestlerId === selectedWrestlerId);
  }, [matches, selectedWrestlerId]);

  const onDeckMatches = useMemo(
    () => matches.filter((match) => match.status === "onDeck"),
    [matches]
  );

  const upcomingMatches = useMemo(
    () => matches.filter((match) => match.status === "upcoming"),
    [matches]
  );

  const completedMatches = useMemo(
    () => matches.filter((match) => match.status === "completed"),
    [matches]
  );

  const resolvedSummary = useMemo(() => {
    if (!selectedWrestler) return null;
    return mergeMatSideSummaryWithProfile(selectedWrestler, summary);
  }, [selectedWrestler, summary]);

  const activeStylePlan = resolvedSummary?.stylePlans?.[activeStyle] || null;

  async function refreshMatches(tournamentId = selectedTournamentId) {
    if (!currentTeam?.id || !tournamentId) {
      setMatches([]);
      return;
    }

    try {
      setLoadingMatches(true);
      setMatches(
        await listTournamentMatches(db, {
          teamId: currentTeam.id,
          tournamentId,
        })
      );
    } catch (error) {
      console.error("Failed to load tournament matches:", error);
      Alert.alert("Match queue error", "Could not load tournament matches.");
    } finally {
      setLoadingMatches(false);
    }
  }

  async function refreshMatchDay() {
    if (!currentTeam?.id || !firebaseUser || !appUser) {
      setTournaments([]);
      setEntries([]);
      setTeamRoster([]);
      setMatches([]);
      setSelectedTournamentId(null);
      setSelectedWrestlerId(null);
      return;
    }

    try {
      setLoading(true);

      const [tournamentRows, rosterRows] = await Promise.all([
        listTournaments(db, currentTeam.id),
        listWrestlers(db, currentTeam.id),
      ]);

      setTournaments(tournamentRows);
      setTeamRoster(rosterRows);

      const requestedTournamentId =
        typeof params.tournamentId === "string" ? params.tournamentId : null;

      const todayKey = new Date().toISOString().split("T")[0];

      const nextTournament =
        tournamentRows
          .slice()
          .filter((tournament) => !tournament.eventDate || tournament.eventDate >= todayKey)
          .sort((a, b) =>
            (a.eventDate || "9999-12-31").localeCompare(b.eventDate || "9999-12-31")
          )[0] ||
        tournamentRows[0] ||
        null;

      const nextTournamentId = requestedTournamentId || selectedTournamentId || nextTournament?.id || null;
      setSelectedTournamentId(nextTournamentId);

      if (nextTournamentId) {
        const entryRows = await listTournamentEntries(db, {
          teamId: currentTeam.id,
          tournamentId: nextTournamentId,
        });

        setEntries(entryRows);
        await refreshMatches(nextTournamentId);
      } else {
        setEntries([]);
        setMatches([]);
      }
    } catch (error) {
      console.error("Failed to load match-day data:", error);
      Alert.alert("Match-Day error", "There was a problem loading the tournament roster.");
    } finally {
      setLoading(false);
    }
  }

  async function loadEntriesForTournament(tournamentId: string) {
    if (!currentTeam?.id) return;

    try {
      setLoading(true);
      setSelectedTournamentId(tournamentId);

      const entryRows = await listTournamentEntries(db, {
        teamId: currentTeam.id,
        tournamentId,
      });

      setEntries(entryRows);
      setSelectedWrestlerId(null);
      setSummary(null);
      await refreshMatches(tournamentId);
    } catch (error) {
      console.error("Failed to load tournament entries:", error);
      Alert.alert("Tournament error", "Could not load verified wrestlers for this tournament.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshMatchDay();
  }, [currentTeam?.id, firebaseUser?.uid, appUser?.role, params.tournamentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!matchDayRoster.length) {
      setSelectedWrestlerId(null);
      return;
    }

    const requestedWrestlerId = typeof params.wrestlerId === "string" ? params.wrestlerId : null;

    setSelectedWrestlerId((prev) => {
      const preferred = requestedWrestlerId || prev;
      if (preferred && matchDayRoster.some((wrestler) => wrestler.id === preferred)) {
        return preferred;
      }

      return matchDayRoster[0].id;
    });
  }, [matchDayRoster, params.wrestlerId]);

  useEffect(() => {
    async function loadSummary() {
      if (!selectedWrestlerId) {
        setSummary(null);
        return;
      }

      try {
        setLoadingSummary(true);
        setSummary(await getMatSideSummary(db, selectedWrestlerId));
      } catch (error) {
        console.error("Failed to load match-day mat-side summary:", error);
      } finally {
        setLoadingSummary(false);
      }
    }

    loadSummary();
  }, [selectedWrestlerId]);

  useEffect(() => {
    if (!selectedWrestler) {
      setActiveStyle("Folkstyle");
      return;
    }

    const entryStyle = selectedWrestler.tournamentEntry?.style;
    if (entryStyle && STYLE_OPTIONS.includes(entryStyle)) {
      setActiveStyle(entryStyle);
      return;
    }

    if (selectedWrestler.styles.includes(activeStyle)) return;

    setActiveStyle(selectedWrestler.styles[0] || "Folkstyle");
  }, [selectedWrestler?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateMatchForm<K extends keyof MatchFormState>(field: K, value: MatchFormState[K]) {
    setMatchForm((prev) => ({ ...prev, [field]: value }));
  }

  function goToPreviousWrestler() {
    if (!matchDayRoster.length) return;
    const nextIndex = selectedIndex <= 0 ? matchDayRoster.length - 1 : selectedIndex - 1;
    setSelectedWrestlerId(matchDayRoster[nextIndex].id);
  }

  function goToNextWrestler() {
    if (!matchDayRoster.length) return;
    const nextIndex = selectedIndex >= matchDayRoster.length - 1 ? 0 : selectedIndex + 1;
    setSelectedWrestlerId(matchDayRoster[nextIndex].id);
  }

  function openAddMatch() {
    if (!isCoach) return;

    if (!selectedTournamentId || !selectedWrestler || !selectedEntry) {
      Alert.alert(
        "Confirmed entry needed",
        "Select a tournament and confirmed wrestler before adding a match."
      );
      return;
    }

    setEditingMatchId(null);
    setMatchForm(createEmptyMatchForm());
    setMatchModalVisible(true);
  }

  function openEditMatch(match: TournamentMatch) {
    if (!isCoach) return;
    setEditingMatchId(match.id);
    setMatchForm(createFormFromMatch(match));
    setMatchModalVisible(true);
  }

  async function saveMatchForm() {
    if (!isCoach || !currentTeam?.id || !selectedTournamentId || !selectedWrestler || !selectedEntry) {
      return;
    }

    if (!matchForm.opponentName.trim() && !matchForm.boutNumber.trim()) {
      Alert.alert("Match details needed", "Add at least an opponent name or bout number.");
      return;
    }

    try {
      setSavingMatch(true);

      const payload = {
        teamId: currentTeam.id,
        tournamentId: selectedTournamentId,
        tournamentEntryId: selectedEntry.id,
        wrestlerId: selectedWrestler.id,
        boutNumber: matchForm.boutNumber,
        matNumber: matchForm.matNumber,
        roundName: matchForm.roundName,
        opponentName: matchForm.opponentName,
        opponentTeam: matchForm.opponentTeam,
        status: matchForm.status,
        result: matchForm.result || undefined,
        score: matchForm.score,
        method: matchForm.method || undefined,
        notes: matchForm.notes,
      };

      if (editingMatchId) {
        await updateTournamentMatch(db, editingMatchId, payload);
      } else {
        await createTournamentMatch(db, payload);
      }

      await refreshMatches(selectedTournamentId);
      setMatchModalVisible(false);
      setEditingMatchId(null);
      setMatchForm(createEmptyMatchForm());
    } catch (error) {
      console.error("Failed to save tournament match:", error);
      Alert.alert("Save failed", "Could not save this match.");
    } finally {
      setSavingMatch(false);
    }
  }

  async function quickUpdateMatch(match: TournamentMatch, status: TournamentMatchStatus) {
    if (!isCoach) return;

    try {
      await updateTournamentMatch(db, match.id, { status });
      await refreshMatches(selectedTournamentId);
    } catch (error) {
      console.error("Failed to update match status:", error);
      Alert.alert("Update failed", "Could not update match status.");
    }
  }

  async function saveMatchToHistory(match: TournamentMatch) {
    if (!isCoach) return;

    if (match.status !== "completed") {
      Alert.alert("Complete match first", "Mark this match completed before saving it to wrestler history.");
      return;
    }

    if (match.result !== "win" && match.result !== "loss") {
      Alert.alert("Result needed", "Edit the match and choose Win or Loss before saving to history.");
      return;
    }

    if (!match.opponentName) {
      Alert.alert("Opponent needed", "Edit the match and add an opponent name before saving to history.");
      return;
    }

    try {
      await saveTournamentMatchToWrestlerHistory(db, match);
      await refreshMatches(selectedTournamentId);
      Alert.alert("Saved", "This match was saved to the wrestler history.");
    } catch (error: any) {
      console.error("Failed to save match to wrestler history:", error);
      Alert.alert("Save failed", error?.message || "Could not save this match to wrestler history.");
    }
  }

  async function removeMatch(match: TournamentMatch) {
    if (!isCoach) return;

    Alert.alert(
      "Delete match?",
      `Delete ${match.boutNumber ? `Bout ${match.boutNumber}` : "this match"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              setDeletingMatchId(match.id);
              await deleteTournamentMatch(db, match.id);
              await refreshMatches(selectedTournamentId);
            } catch (error) {
              console.error("Failed to delete tournament match:", error);
              Alert.alert("Delete failed", "Could not delete this match.");
            } finally {
              setDeletingMatchId(null);
            }
          },
        },
      ]
    );
  }

  function previewBracketImport() {
    if (!bracketText.trim()) {
      Alert.alert("Paste bracket text", "Paste copied bracket text before previewing.");
      return;
    }

    const parsed = parseBracketTextToMatches(bracketText, confirmedEntries);
    setParsedMatches(parsed);
    setSelectedParsedIds(parsed.filter((match) => match.matchedEntryId).map((match) => match.id));

    if (parsed.length === 0) {
      Alert.alert("No matches found", "No bout numbers or match rows were detected.");
      return;
    }

    Alert.alert(
      "Preview ready",
      `${parsed.length} possible match${parsed.length === 1 ? "" : "es"} detected.`
    );
  }

  function toggleParsedMatch(id: string) {
    setSelectedParsedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function saveSelectedParsedMatches() {
    if (!isCoach || !currentTeam?.id || !selectedTournamentId) return;

    const selectedParsedMatches = parsedMatches.filter((match) => selectedParsedIds.includes(match.id));

    if (selectedParsedMatches.length === 0) {
      Alert.alert("No matches selected", "Select at least one detected match to save.");
      return;
    }

    try {
      setSavingParsedMatches(true);

      for (const parsed of selectedParsedMatches) {
        const entry = confirmedEntries.find((row) => row.id === parsed.matchedEntryId);

        if (!entry) continue;

        await createTournamentMatch(
          db,
          buildTournamentMatchInputFromParsedMatch({
            teamId: currentTeam.id,
            tournamentId: selectedTournamentId,
            entry,
            parsedMatch: parsed,
          })
        );
      }

      await refreshMatches(selectedTournamentId);
      setBracketModalVisible(false);
      setBracketText("");
      setParsedMatches([]);
      setSelectedParsedIds([]);
      Alert.alert("Matches saved", "Selected bracket matches were added to the queue.");
    } catch (error) {
      console.error("Failed to save parsed bracket matches:", error);
      Alert.alert("Import failed", "Could not save selected bracket matches.");
    } finally {
      setSavingParsedMatches(false);
    }
  }

  if (!authLoading && (!firebaseUser || !appUser)) {
    return (
      <MobileScreenShell
        title="Match-Day"
        subtitle="Sign in to use tournament roster and mat-side summaries."
      >
        <View style={cardStyle}>
          <Text style={{ color: "#ffffff", fontSize: 22, fontWeight: "900" }}>
            Sign in required
          </Text>

          <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22 }}>
            Sign in to access your team tournament roster and match-day mat-side tools.
          </Text>

          <Pill label="Go Home" active onPress={() => router.push("/")} />
        </View>
      </MobileScreenShell>
    );
  }

  return (
    <MobileScreenShell
      title="Match-Day"
      subtitle={
        isCoach
          ? "Verified tournament roster, match queue, bracket import, and mat-side strategy."
          : "Your match-day prep view from the tournament roster."
      }
    >
      <Modal visible={matchModalVisible} animationType="slide" onRequestClose={() => setMatchModalVisible(false)}>
        <ScrollView style={{ flex: 1, backgroundColor: "#061a33" }} contentContainerStyle={{ padding: 18, gap: 14 }}>
          <Text style={{ color: "#ffffff", fontSize: 28, fontWeight: "900" }}>
            {editingMatchId ? "Edit Match" : "Add Match"}
          </Text>

          {selectedWrestler ? (
            <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22 }}>
              {getFullName(selectedWrestler)} • {selectedEntry?.weightClass || selectedWrestler.weightClass || "Weight not set"} •{" "}
              {selectedEntry?.style || selectedWrestler.styles[0] || "Style not set"}
            </Text>
          ) : null}

          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field label="Bout #" value={matchForm.boutNumber} onChangeText={(value) => updateMatchForm("boutNumber", value)} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Mat #" value={matchForm.matNumber} onChangeText={(value) => updateMatchForm("matNumber", value)} />
            </View>
          </View>

          <Field label="Round" value={matchForm.roundName} onChangeText={(value) => updateMatchForm("roundName", value)} placeholder="Round 1, Semis, Consis..." />
          <Field label="Opponent" value={matchForm.opponentName} onChangeText={(value) => updateMatchForm("opponentName", value)} />
          <Field label="Opponent Team" value={matchForm.opponentTeam} onChangeText={(value) => updateMatchForm("opponentTeam", value)} />

          <Text style={{ color: "#ffffff", fontWeight: "900" }}>Status</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pill label="Upcoming" active={matchForm.status === "upcoming"} onPress={() => updateMatchForm("status", "upcoming")} />
            <Pill label="On Deck" active={matchForm.status === "onDeck"} onPress={() => updateMatchForm("status", "onDeck")} />
            <Pill label="Completed" active={matchForm.status === "completed"} onPress={() => updateMatchForm("status", "completed")} />
          </View>

          <Text style={{ color: "#ffffff", fontWeight: "900" }}>Result</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pill label="No Result" active={!matchForm.result} onPress={() => updateMatchForm("result", "")} />
            <Pill label="Win" active={matchForm.result === "win"} onPress={() => updateMatchForm("result", "win")} />
            <Pill label="Loss" active={matchForm.result === "loss"} onPress={() => updateMatchForm("result", "loss")} />
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field label="Score" value={matchForm.score} onChangeText={(value) => updateMatchForm("score", value)} placeholder="8-3" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Method" value={matchForm.method} onChangeText={(value) => updateMatchForm("method", value as TournamentMatchMethod | "")} placeholder="decision, fall..." />
            </View>
          </View>

          <Field label="Notes" value={matchForm.notes} onChangeText={(value) => updateMatchForm("notes", value)} multiline />

          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Pill label={savingMatch ? "Saving..." : "Save Match"} active onPress={saveMatchForm} disabled={savingMatch} />
            <Pill label="Cancel" onPress={() => setMatchModalVisible(false)} />
          </View>
        </ScrollView>
      </Modal>

      <Modal visible={bracketModalVisible} animationType="slide" onRequestClose={() => setBracketModalVisible(false)}>
        <ScrollView style={{ flex: 1, backgroundColor: "#061a33" }} contentContainerStyle={{ padding: 18, gap: 14 }}>
          <Text style={{ color: "#ffffff", fontSize: 28, fontWeight: "900" }}>Bracket Import</Text>

          <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22 }}>
            Paste bracket text from USA Bracketing. Preview first, then save selected matches. Weight comes from the confirmed tournament entry.
          </Text>

          <TextInput
            value={bracketText}
            onChangeText={setBracketText}
            placeholder="Paste bracket text here..."
            placeholderTextColor="#7c8da3"
            multiline
            textAlignVertical="top"
            style={{
              minHeight: 220,
              borderWidth: 1,
              borderColor: "#315c86",
              borderRadius: 18,
              padding: 14,
              backgroundColor: "#102f52",
              color: "#ffffff",
            }}
          />

          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Pill label="Preview Matches" active onPress={previewBracketImport} />
            <Pill label={savingParsedMatches ? "Saving..." : "Save Selected"} active={parsedMatches.length > 0} onPress={saveSelectedParsedMatches} disabled={savingParsedMatches || parsedMatches.length === 0} />
            <Pill label="Close" onPress={() => setBracketModalVisible(false)} />
          </View>

          {parsedMatches.length > 0 ? (
            <View style={{ gap: 10 }}>
              <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
                Preview
              </Text>

              {parsedMatches.map((match) => {
                const selected = selectedParsedIds.includes(match.id);
                const canSave = Boolean(match.matchedEntryId);

                return (
                  <Pressable
                    key={match.id}
                    onPress={() => canSave && toggleParsedMatch(match.id)}
                    style={{
                      borderWidth: 1,
                      borderColor: selected ? "#bf1029" : "#315c86",
                      borderRadius: 18,
                      padding: 13,
                      backgroundColor: selected ? "#431407" : "#102f52",
                      opacity: canSave ? 1 : 0.55,
                    }}
                  >
                    <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "900" }}>
                      {match.boutNumber ? `Bout ${match.boutNumber}` : "Detected Match"}
                    </Text>

                    <Text style={{ color: "#dbeafe", marginTop: 5, lineHeight: 20 }}>
                      {match.wrestlerName || "Unknown wrestler"} vs {match.opponentName || "Unknown opponent"}
                    </Text>

                    <Text style={{ color: "#b7c9df", marginTop: 5, lineHeight: 20 }}>
                      {match.resultText ? `Result: ${match.resultText}` : `Status: ${match.status}`} •{" "}
                      {canSave ? `Matched roster confidence ${match.confidence}` : "No confirmed roster match"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      </Modal>

      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          <Pill label={loading ? "Refreshing..." : "Refresh Match-Day"} active onPress={refreshMatchDay} />
          {isCoach ? <Pill label="Import Bracket" onPress={() => setBracketModalVisible(true)} /> : null}
        </View>

        {!isCoach ? (
          <View style={cardStyle}>
            <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22 }}>
              Athletes can view match-day prep. Coaches manage tournament verification, match queue, and mat-side notes.
            </Text>
          </View>
        ) : null}

        <View style={cardStyle}>
          <Text style={sectionTitleStyle}>Tournament</Text>

          {sortedTournaments.length === 0 ? (
            <Text style={mutedTextStyle}>No tournaments found yet. Add tournaments on the web app first.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {sortedTournaments.map((tournament) => {
                  const active = tournament.id === selectedTournamentId;

                  return (
                    <Pressable
                      key={tournament.id}
                      onPress={() => loadEntriesForTournament(tournament.id)}
                      style={{
                        width: 230,
                        borderWidth: 1,
                        borderColor: active ? "#ffffff" : "#315c86",
                        borderRadius: 18,
                        padding: 13,
                        backgroundColor: active ? "#173b67" : "#102f52",
                      }}
                    >
                      <Text numberOfLines={2} style={{ color: "#ffffff", fontSize: 16, fontWeight: "900" }}>
                        {tournament.name}
                      </Text>

                      <Text style={{ color: "#b7c9df", fontSize: 14, marginTop: 6 }}>
                        {formatDate(tournament.eventDate)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </View>

        <View style={cardStyle}>
          <Text style={sectionTitleStyle}>Live Match Queue</Text>

          <Text style={mutedTextStyle}>
            {selectedTournament
              ? `${selectedTournament.name} • ${matches.length} match${matches.length === 1 ? "" : "es"}`
              : "Select a tournament to view the queue."}
          </Text>

          {loadingMatches ? <Text style={mutedTextStyle}>Loading matches...</Text> : null}

          {matches.length === 0 ? (
            <Text style={[mutedTextStyle, { marginTop: 10 }]}>
              No matches added yet. Use Add Match for the selected wrestler or Import Bracket.
            </Text>
          ) : (
            <View style={{ gap: 10, marginTop: 12 }}>
              {[...onDeckMatches, ...upcomingMatches, ...completedMatches].map((match) => {
                const wrestler =
                  matchDayRoster.find((row) => row.id === match.wrestlerId) ||
                  teamRoster.find((row) => row.id === match.wrestlerId);
                const entry = entries.find((row) => row.id === match.tournamentEntryId);
                const active = match.wrestlerId === selectedWrestlerId;

                return (
                  <Pressable
                    key={match.id}
                    onPress={() => setSelectedWrestlerId(match.wrestlerId)}
                    style={{
                      borderWidth: 1,
                      borderColor: active ? "#bf1029" : "#315c86",
                      borderRadius: 18,
                      padding: 13,
                      backgroundColor: active ? "#431407" : "#102f52",
                    }}
                  >
                    <Text style={{ color: "#93c5fd", fontSize: 12, fontWeight: "900" }}>
                      {match.status.toUpperCase()}
                    </Text>

                    <Text style={{ color: "#ffffff", fontSize: 17, fontWeight: "900", marginTop: 4 }}>
                      {getFullName(wrestler) || "Unknown Wrestler"} vs {match.opponentName || "TBD"}
                    </Text>

                    <Text style={{ color: "#b7c9df", fontSize: 14, marginTop: 5, lineHeight: 20 }}>
                      {[getMatchTitle(match), entry?.weightClass, entry?.style, match.score, match.method]
                        .filter(Boolean)
                        .join(" • ") || "Match details needed"}
                    </Text>

                    {match.notes ? (
                      <Text style={{ color: "#dbeafe", fontSize: 14, marginTop: 6, lineHeight: 20 }}>
                        {match.notes}
                      </Text>
                    ) : null}

                    {isCoach ? (
                      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                        <Pill label="Edit" onPress={() => openEditMatch(match)} />

                        <Pill
                          label="On Deck"
                          active={match.status === "onDeck"}
                          onPress={() => quickUpdateMatch(match, "onDeck")}
                        />

                        <Pill
                          label="Complete"
                          active={match.status === "completed"}
                          onPress={() => quickUpdateMatch(match, "completed")}
                        />

                        <Pill
                          label={(match as any).historySaved ? "History Saved" : "Save to History"}
                          active={(match as any).historySaved === true}
                          onPress={() => saveMatchToHistory(match)}
                          disabled={(match as any).historySaved === true}
                        />

                        <Pill
                          label={deletingMatchId === match.id ? "Deleting..." : "Delete"}
                          onPress={() => removeMatch(match)}
                          disabled={deletingMatchId === match.id}
                        />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <View style={cardStyle}>
          <Text style={sectionTitleStyle}>Verified Going Roster</Text>

          <Text style={mutedTextStyle}>
            {selectedTournament
              ? `${selectedTournament.name} • ${confirmedEntries.length} confirmed`
              : "Select a tournament to use confirmed entries."}
          </Text>

          {confirmedEntries.length === 0 && selectedTournament ? (
            <View style={{ marginTop: 12, borderRadius: 16, borderWidth: 1, borderColor: "#315c86", backgroundColor: "#102f52", padding: 13 }}>
              <Text style={{ color: "#dbeafe", fontSize: 14, lineHeight: 21 }}>
                No confirmed tournament entries yet. Showing team roster as a fallback.
              </Text>
            </View>
          ) : null}

          {loading ? (
            <Text style={{ color: "#b7c9df", marginTop: 12 }}>Loading match-day roster...</Text>
          ) : matchDayRoster.length === 0 ? (
            <Text style={{ color: "#b7c9df", marginTop: 12 }}>No wrestlers available yet.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14 }}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {matchDayRoster.map((wrestler, index) => {
                  const active = wrestler.id === selectedWrestlerId;
                  const fullName = getFullName(wrestler);
                  const matchCount = matches.filter((match) => match.wrestlerId === wrestler.id).length;

                  return (
                    <Pressable
                      key={wrestler.id}
                      onPress={() => setSelectedWrestlerId(wrestler.id)}
                      style={{
                        width: 190,
                        borderWidth: 1,
                        borderColor: active ? "#bf1029" : "#315c86",
                        borderRadius: 18,
                        padding: 13,
                        backgroundColor: active ? "#431407" : "#102f52",
                      }}
                    >
                      <Text style={{ color: "#93c5fd", fontSize: 12, fontWeight: "900" }}>
                        #{index + 1} • {matchCount} match{matchCount === 1 ? "" : "es"}
                      </Text>

                      <Text numberOfLines={2} style={{ color: "#ffffff", fontSize: 17, fontWeight: "900", marginTop: 4 }}>
                        {fullName || "Unnamed Wrestler"}
                      </Text>

                      <Text style={{ color: "#b7c9df", fontSize: 14, marginTop: 6 }}>
                        {[wrestler.weightClass, wrestler.tournamentEntry?.style || wrestler.styles[0]]
                          .filter(Boolean)
                          .join(" • ") || "Details needed"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </View>

        {selectedWrestler && resolvedSummary ? (
          <View style={{ ...cardStyle, borderRadius: 26, padding: 18 }}>
            <Text style={{ color: "#93c5fd", fontSize: 12, fontWeight: "900", letterSpacing: 1 }}>
              ACTIVE WRESTLER
            </Text>

            <Text style={{ color: "#ffffff", fontSize: 30, fontWeight: "900", marginTop: 6, letterSpacing: -0.7 }}>
              {selectedWrestler.firstName} {selectedWrestler.lastName}
            </Text>

            <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22, marginTop: 8 }}>
              {[selectedEntry?.weightClass || selectedWrestler.weightClass, selectedWrestler.grade, selectedWrestler.schoolOrClub]
                .filter(Boolean)
                .join(" • ") || "Profile details in progress"}
            </Text>

            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
              <Pill label="Previous" onPress={goToPreviousWrestler} />
              <Pill label="Next Wrestler" active onPress={goToNextWrestler} />
              {isCoach ? <Pill label="Add Match" active onPress={openAddMatch} /> : null}
              <Pill
                label="Full Mat-Side"
                onPress={() =>
                  router.push({
                    pathname: "/mat-side",
                    params: { wrestlerId: selectedWrestler.id },
                  } as any)
                }
              />
            </View>

            {selectedWrestlerMatches.length > 0 ? (
              <View style={{ marginTop: 16, gap: 10 }}>
                <Text style={sectionTitleStyle}>This Wrestler’s Matches</Text>
                {selectedWrestlerMatches.map((match) => (
                  <Pressable
                    key={match.id}
                    onPress={() => openEditMatch(match)}
                    style={{
                      borderWidth: 1,
                      borderColor: "#315c86",
                      borderRadius: 16,
                      padding: 12,
                      backgroundColor: "#102f52",
                    }}
                  >
                    <Text style={{ color: "#ffffff", fontWeight: "900", fontSize: 16 }}>
                      {match.opponentName ? `vs ${match.opponentName}` : "Opponent TBD"}
                    </Text>
                    <Text style={{ color: "#b7c9df", marginTop: 5 }}>
                      {[match.status, getMatchTitle(match), match.score, match.method].filter(Boolean).join(" • ")}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              {STYLE_OPTIONS.map((style) => (
                <Pill key={style} label={style} active={activeStyle === style} onPress={() => setActiveStyle(style)} />
              ))}
            </View>

            <View style={{ marginTop: 16, borderRadius: 18, borderWidth: 1, borderColor: summary ? "#315c86" : "#21486e", backgroundColor: summary ? "#102f52" : "#071d36", padding: 13 }}>
              <Text style={{ color: "#b7c9df", fontSize: 14, lineHeight: 20 }}>
                {loadingSummary
                  ? "Loading mat-side notes..."
                  : summary
                    ? "Showing saved coach mat-side summary."
                    : "No saved mat-side summary yet. Using wrestler profile fallback."}
              </Text>
            </View>

            {activeStylePlan ? (
              <>
                <SummarySection title={`${activeStyle} Quick Reminders`} items={activeStylePlan.quickReminders} />
                <SummarySection title={`${activeStyle} Focus Points`} items={activeStylePlan.focusPoints} />
                <SummarySection title={`${activeStyle} Game Plan`} items={activeStylePlan.gamePlan} />
                <SummarySection title={`${activeStyle} Recent Notes`} items={activeStylePlan.recentNotes} />
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
    </MobileScreenShell>
  );
}

const cardStyle = {
  borderWidth: 1,
  borderColor: "#21486e",
  borderRadius: 24,
  padding: 16,
  backgroundColor: "#0b2542",
  gap: 10,
};

const sectionTitleStyle = {
  color: "#ffffff",
  fontSize: 19,
  fontWeight: "900" as const,
};

const mutedTextStyle = {
  color: "#b7c9df",
  fontSize: 14,
  lineHeight: 20,
  marginTop: 5,
};