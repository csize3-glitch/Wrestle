import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@wrestlewell/firebase/client";
import {
  createTeamNotification,
  createTournamentEntry,
  listTournamentEntries,
  listTournaments,
  listWrestlers,
  sendTeamPushDelivery,
  updateTournamentEntryStatus,
} from "@wrestlewell/lib/index";
import type {
  Tournament,
  TournamentEntry,
  WrestlerProfile,
  WrestlingStyle,
} from "@wrestlewell/types/index";
import { COLLECTIONS } from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell } from "../components/mobile-screen-shell";

const STYLE_OPTIONS: WrestlingStyle[] = ["Folkstyle", "Freestyle", "Greco-Roman"];

type EntryEditForm = {
  style: WrestlingStyle | "";
  weightClass: string;
  notes: string;
};

function createEntryEditForm(entry?: TournamentEntry | null): EntryEditForm {
  return {
    style: entry?.style || "",
    weightClass: entry?.weightClass || "",
    notes: entry?.notes || "",
  };
}

function formatEntryStatus(status: TournamentEntry["status"]) {
  if (status === "planned") return "Planned";
  if (status === "submitted") return "Submitted";
  return "Verified";
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

function getRosterCounts(entries: TournamentEntry[]) {
  return {
    planned: entries.filter((entry) => entry.status === "planned").length,
    submitted: entries.filter((entry) => entry.status === "submitted").length,
    confirmed: entries.filter((entry) => entry.status === "confirmed").length,
  };
}

function sortTournamentDate(a: Tournament, b: Tournament) {
  return (a.eventDate || "9999-12-31").localeCompare(b.eventDate || "9999-12-31");
}

export default function TournamentsScreen() {
  const { firebaseUser, appUser, currentTeam } = useMobileAuthState();
  const params = useLocalSearchParams<{ tournamentId?: string }>();

  const focusedTournamentId =
    typeof params.tournamentId === "string" ? params.tournamentId : null;

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [entriesByTournament, setEntriesByTournament] = useState<Record<string, TournamentEntry[]>>({});
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);

  const [entryModalVisible, setEntryModalVisible] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TournamentEntry | null>(null);
  const [editingTournament, setEditingTournament] = useState<Tournament | null>(null);
  const [entryForm, setEntryForm] = useState<EntryEditForm>(createEntryEditForm);
  const [savingEntry, setSavingEntry] = useState(false);

  const isCoach = appUser?.role === "coach";

  const ownWrestler =
    appUser?.role === "athlete" && firebaseUser
      ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) || null
      : null;

  const visibleTournaments = useMemo(() => {
    const baseTournaments =
      appUser?.role === "athlete" && ownWrestler
        ? tournaments.filter((tournament) => {
            const entries = entriesByTournament[tournament.id] || [];
            return (
              entries.length === 0 ||
              entries.some((entry) => entry.wrestlerId === ownWrestler.id)
            );
          })
        : tournaments;

    const sorted = baseTournaments.slice().sort(sortTournamentDate);

    if (!focusedTournamentId) {
      return sorted;
    }

    return sorted.sort((a, b) => {
      if (a.id === focusedTournamentId) return -1;
      if (b.id === focusedTournamentId) return 1;
      return sortTournamentDate(a, b);
    });
  }, [appUser?.role, entriesByTournament, focusedTournamentId, ownWrestler, tournaments]);

  async function refresh() {
    const [rows, wrestlerRows] = await Promise.all([
      listTournaments(db, currentTeam?.id),
      currentTeam?.id ? listWrestlers(db, currentTeam.id) : Promise.resolve([]),
    ]);

    setTournaments(rows);
    setWrestlers(wrestlerRows);

    if (!currentTeam?.id || rows.length === 0) {
      setEntriesByTournament({});
      return;
    }

    const entryRows = await Promise.all(
      rows.map(
        async (tournament) =>
          [
            tournament.id,
            await listTournamentEntries(db, {
              teamId: currentTeam.id,
              tournamentId: tournament.id,
            }),
          ] as const
      )
    );

    setEntriesByTournament(Object.fromEntries(entryRows));
  }

  async function notifyCoachRegistrationSubmitted(entry: TournamentEntry) {
    if (!currentTeam?.id || !firebaseUser?.uid) return;

    const tournament = tournaments.find((item) => item.id === entry.tournamentId);

    await createTeamNotification(db, {
      teamId: currentTeam.id,
      audienceRole: "coach",
      title: "Tournament registration submitted",
      body: `${entry.wrestlerName} marked themselves registered for ${
        tournament?.name || "a tournament"
      }. Please verify the USA Bracketing registration.`,
      type: "tournament_registration",
      createdBy: firebaseUser.uid,
      tournamentId: entry.tournamentId,
      tournamentEntryId: entry.id,
      wrestlerId: entry.wrestlerId,
    });

    try {
      await sendTeamPushDelivery(db, {
        teamId: currentTeam.id,
        title: "Tournament registration submitted",
        body: `${entry.wrestlerName} marked themselves registered for ${
          tournament?.name || "a tournament"
        }.`,
        audienceRole: "coach",
        excludeUserIds: [firebaseUser.uid],
        preferenceKey: "tournamentAlerts",
      });
    } catch (pushError) {
      console.error("Failed to send tournament registration push:", pushError);
    }
  }

  async function updateEntryStatus(
    entry: TournamentEntry,
    status: TournamentEntry["status"]
  ) {
    try {
      setSavingStatusId(entry.id);
      await updateTournamentEntryStatus(db, entry, status);

      if (status === "submitted" && appUser?.role === "athlete") {
        await notifyCoachRegistrationSubmitted(entry);
      }

      await refresh();

      Alert.alert(
        "Registration updated",
        status === "confirmed"
          ? "This tournament entry is now verified for Match-Day."
          : status === "submitted"
            ? "This tournament entry is now marked registered."
            : "This tournament entry is now back in planned status."
      );
    } catch (error) {
      console.error("Failed to update tournament entry status:", error);
      Alert.alert(
        "Update failed",
        "There was a problem updating the tournament registration status."
      );
    } finally {
      setSavingStatusId(null);
    }
  }

  async function markRegistered(tournament: Tournament) {
    if (!currentTeam?.id || !ownWrestler || !firebaseUser?.uid) {
      Alert.alert(
        "Profile needed",
        "Create your wrestler profile before joining a tournament roster."
      );
      return;
    }

    const existingEntry = (entriesByTournament[tournament.id] || []).find(
      (entry) => entry.wrestlerId === ownWrestler.id
    );

    if (existingEntry) {
      Alert.alert("Already listed", "You are already listed for this tournament.");
      return;
    }

    try {
      setSavingStatusId(tournament.id);

      const entryId = await createTournamentEntry(db, {
        teamId: currentTeam.id,
        tournamentId: tournament.id,
        wrestlerId: ownWrestler.id,
        wrestlerName: getFullName(ownWrestler),
        style: ownWrestler.styles[0],
        weightClass: ownWrestler.weightClass,
        status: "submitted",
      });

      await createTeamNotification(db, {
        teamId: currentTeam.id,
        audienceRole: "coach",
        title: "Tournament registration submitted",
        body: `${getFullName(ownWrestler)} marked themselves registered for ${
          tournament.name
        }. Please verify the USA Bracketing registration.`,
        type: "tournament_registration",
        createdBy: firebaseUser.uid,
        tournamentId: tournament.id,
        tournamentEntryId: entryId,
        wrestlerId: ownWrestler.id,
      });

      try {
        await sendTeamPushDelivery(db, {
          teamId: currentTeam.id,
          title: "Tournament registration submitted",
          body: `${getFullName(ownWrestler)} marked themselves registered for ${tournament.name}.`,
          audienceRole: "coach",
          excludeUserIds: [firebaseUser.uid],
          preferenceKey: "tournamentAlerts",
        });
      } catch (pushError) {
        console.error("Failed to send athlete registration push:", pushError);
      }

      await refresh();
      Alert.alert("Registration submitted", "Your coach has been notified to verify it.");
    } catch (error) {
      console.error("Failed to mark athlete registered:", error);
      Alert.alert(
        "Update failed",
        "There was a problem adding you to this tournament roster."
      );
    } finally {
      setSavingStatusId(null);
    }
  }

  function openEditEntry(tournament: Tournament, entry: TournamentEntry) {
    if (!isCoach) return;

    setEditingTournament(tournament);
    setEditingEntry(entry);
    setEntryForm(createEntryEditForm(entry));
    setEntryModalVisible(true);
  }

  async function saveEntryDetails() {
    if (!isCoach || !editingEntry) return;

    if (!entryForm.weightClass.trim()) {
      Alert.alert(
        "Weight needed",
        "Add the tournament weight class before confirming this wrestler."
      );
      return;
    }

    if (!entryForm.style) {
      Alert.alert("Style needed", "Choose the wrestling style for this tournament entry.");
      return;
    }

    try {
      setSavingEntry(true);

      await updateDoc(doc(db, COLLECTIONS.TOURNAMENT_ENTRIES, editingEntry.id), {
        style: entryForm.style,
        weightClass: entryForm.weightClass.trim(),
        notes: entryForm.notes.trim(),
        updatedAt: serverTimestamp(),
      });

      await refresh();

      setEntryModalVisible(false);
      setEditingEntry(null);
      setEditingTournament(null);
      setEntryForm(createEntryEditForm());

      Alert.alert("Entry updated", "Tournament weight, style, and notes were saved.");
    } catch (error) {
      console.error("Failed to update tournament entry details:", error);
      Alert.alert("Save failed", "Could not update this tournament entry.");
    } finally {
      setSavingEntry(false);
    }
  }

  async function verifyEntryFromModal() {
    if (!editingEntry) return;

    if (!entryForm.weightClass.trim()) {
      Alert.alert(
        "Weight needed",
        "Add the tournament weight class before verifying this wrestler."
      );
      return;
    }

    if (!entryForm.style) {
      Alert.alert("Style needed", "Choose the wrestling style before verifying this wrestler.");
      return;
    }

    try {
      setSavingEntry(true);

      await updateDoc(doc(db, COLLECTIONS.TOURNAMENT_ENTRIES, editingEntry.id), {
        style: entryForm.style,
        weightClass: entryForm.weightClass.trim(),
        notes: entryForm.notes.trim(),
        status: "confirmed",
        updatedAt: serverTimestamp(),
      });

      await refresh();

      setEntryModalVisible(false);
      setEditingEntry(null);
      setEditingTournament(null);
      setEntryForm(createEntryEditForm());

      Alert.alert("Entry verified", "This wrestler is now confirmed for Match-Day.");
    } catch (error) {
      console.error("Failed to verify tournament entry:", error);
      Alert.alert("Verify failed", "Could not verify this tournament entry.");
    } finally {
      setSavingEntry(false);
    }
  }

  useEffect(() => {
    async function load() {
      if (!firebaseUser || !appUser) {
        setTournaments([]);
        setLoading(false);
        return;
      }

      try {
        await refresh();
      } catch (error) {
        console.error("Failed to load tournaments:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [appUser, currentTeam?.id, firebaseUser]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!firebaseUser || !appUser) {
    return (
      <MobileScreenShell
        title="Tournaments"
        subtitle="Sign in to view your team tournament hub."
      >
        <View
          style={{
            borderRadius: 24,
            padding: 18,
            borderWidth: 1,
            borderColor: "#21486e",
            backgroundColor: "#0b2542",
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 24, fontWeight: "900", color: "#ffffff" }}>
            Sign in required
          </Text>

          <Text style={{ fontSize: 15, color: "#b7c9df", lineHeight: 22 }}>
            Sign in on mobile to open your team tournament links and registration hub.
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
            <Text style={{ color: "#fff", fontWeight: "800" }}>Go Home</Text>
          </Pressable>
        </View>
      </MobileScreenShell>
    );
  }

  return (
    <MobileScreenShell
      title="Tournaments"
      subtitle={
        appUser.role === "coach"
          ? "Season event list with registration links, tournament weights, and verified roster status."
          : "Upcoming team events, registration links, and roster status."
      }
    >
      <Modal
        visible={entryModalVisible}
        animationType="slide"
        onRequestClose={() => setEntryModalVisible(false)}
      >
        <ScrollView
          style={{ flex: 1, backgroundColor: "#061a33" }}
          contentContainerStyle={{ padding: 18, gap: 14 }}
        >
          <Text style={{ color: "#ffffff", fontSize: 28, fontWeight: "900" }}>
            Edit Tournament Entry
          </Text>

          {editingEntry ? (
            <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22 }}>
              {editingEntry.wrestlerName} • {editingTournament?.name || "Tournament"}
            </Text>
          ) : null}

          <View style={{ gap: 8 }}>
            <Text style={{ color: "#ffffff", fontWeight: "900" }}>Tournament Style</Text>

            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {STYLE_OPTIONS.map((style) => (
                <Pressable
                  key={style}
                  onPress={() => setEntryForm((prev) => ({ ...prev, style }))}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: entryForm.style === style ? "#bf1029" : "#315c86",
                    backgroundColor: entryForm.style === style ? "#bf1029" : "#102f52",
                  }}
                >
                  <Text style={{ color: "#ffffff", fontWeight: "900" }}>{style}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Field
            label="Tournament Weight Class"
            value={entryForm.weightClass}
            onChangeText={(value) => setEntryForm((prev) => ({ ...prev, weightClass: value }))}
            placeholder="80, 92, 110, 132..."
          />

          <Field
            label="Coach Notes"
            value={entryForm.notes}
            onChangeText={(value) => setEntryForm((prev) => ({ ...prev, notes: value }))}
            placeholder="Registration note, weigh-in note, bracket note..."
            multiline
          />

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
              Why tournament weight lives here
            </Text>

            <Text style={{ color: "#b7c9df", fontSize: 14, lineHeight: 20, marginTop: 6 }}>
              This weight is specific to this event. Match-Day uses this tournament entry weight instead of the wrestler profile default.
            </Text>
          </View>

          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <StatusButton
              label={savingEntry ? "Saving..." : "Save Details"}
              onPress={saveEntryDetails}
              variant="light"
              disabled={savingEntry}
            />

            <StatusButton
              label={savingEntry ? "Verifying..." : "Save + Verify"}
              onPress={verifyEntryFromModal}
              variant="red"
              disabled={savingEntry}
            />

            <StatusButton
              label="Cancel"
              onPress={() => setEntryModalVisible(false)}
              variant="redLight"
              disabled={savingEntry}
            />
          </View>
        </ScrollView>
      </Modal>

      {appUser.role !== "coach" ? (
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
            Coaches manage tournament setup. Athletes can review events, open registration links, and mark registration submitted.
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
        <Text style={{ color: "#b7c9df", marginBottom: 16 }}>
          Loading tournaments...
        </Text>
      ) : null}

      {!loading && visibleTournaments.length === 0 ? (
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
            {appUser.role === "coach"
              ? "No tournaments added yet. Import or create tournament links on the web app."
              : "No tournaments are assigned to you yet. Once your coach adds you to a roster, they will show up here."}
          </Text>
        </View>
      ) : null}

      <View style={{ gap: 14 }}>
        {visibleTournaments.map((tournament) => {
          const entries = entriesByTournament[tournament.id] || [];
          const counts = getRosterCounts(entries);
          const isFocusedTournament = focusedTournamentId === tournament.id;

          return (
            <View
              key={tournament.id}
              style={{
                borderWidth: isFocusedTournament ? 2 : 1,
                borderColor: isFocusedTournament ? "#bf1029" : "#21486e",
                borderRadius: 24,
                padding: 18,
                backgroundColor: isFocusedTournament ? "#431407" : "#0b2542",
              }}
            >
              <Text style={{ fontSize: 21, fontWeight: "900", color: "#ffffff" }}>
                {tournament.name}
              </Text>

              {isFocusedTournament ? (
                <View
                  style={{
                    alignSelf: "flex-start",
                    marginTop: 10,
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    backgroundColor: "#bf1029",
                    borderWidth: 1,
                    borderColor: "#fecaca",
                  }}
                >
                  <Text style={{ color: "#ffffff", fontSize: 12, fontWeight: "900" }}>
                    SELECTED FROM DASHBOARD
                  </Text>
                </View>
              ) : null}

              <Text style={{ fontSize: 14, color: "#b7c9df", marginTop: 8 }}>
                Source: {tournament.source === "excel_import" ? "Workbook import" : "Manual"}
              </Text>

              <Text style={{ fontSize: 14, color: "#b7c9df", marginTop: 4 }}>
                Event Date: {formatDate(tournament.eventDate)}
              </Text>

              {tournament.weighInTime ? (
                <Text style={{ fontSize: 14, color: "#93c5fd", marginTop: 4, fontWeight: "800" }}>
                  Weigh-In Time: {tournament.weighInTime}
                </Text>
              ) : null}

              {tournament.arrivalTime ? (
                <Text style={{ fontSize: 14, color: "#93c5fd", marginTop: 4, fontWeight: "800" }}>
                  Arrival Time: {tournament.arrivalTime}
                </Text>
              ) : null}

              {tournament.notes ? (
                <Text style={{ fontSize: 14, color: "#dbeafe", marginTop: 8, lineHeight: 20 }}>
                  {tournament.notes}
                </Text>
              ) : null}

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                <MiniStatus label="Planned" value={`${counts.planned}`} />
                <MiniStatus label="Submitted" value={`${counts.submitted}`} />
                <MiniStatus label="Verified" value={`${counts.confirmed}`} active />
              </View>

              {appUser.role === "coach" && tournament.coachEventNotes ? (
                <InfoBox title="Coach Event Notes">
                  <Text style={{ fontSize: 14, color: "#dbeafe", lineHeight: 20 }}>
                    {tournament.coachEventNotes}
                  </Text>
                </InfoBox>
              ) : null}

              {tournament.travelChecklist && tournament.travelChecklist.length > 0 ? (
                <InfoBox title="Travel Checklist" tone="orange">
                  {tournament.travelChecklist.map((item) => (
                    <Text
                      key={`travel-${tournament.id}-${item}`}
                      style={{ fontSize: 14, color: "#fed7aa", lineHeight: 20 }}
                    >
                      • {item}
                    </Text>
                  ))}
                </InfoBox>
              ) : null}

              {appUser.role === "coach" &&
              tournament.coachChecklist &&
              tournament.coachChecklist.length > 0 ? (
                <InfoBox title="Coach Day-Of Checklist">
                  {tournament.coachChecklist.map((item) => (
                    <Text
                      key={`coach-${tournament.id}-${item}`}
                      style={{ fontSize: 14, color: "#dbeafe", lineHeight: 20 }}
                    >
                      • {item}
                    </Text>
                  ))}
                </InfoBox>
              ) : null}

              {appUser.role === "coach" ? (
                <View
                  style={{
                    marginTop: 14,
                    borderTopWidth: 1,
                    borderTopColor: "#21486e",
                    paddingTop: 14,
                    gap: 8,
                  }}
                >
                  <Text style={{ fontSize: 16, fontWeight: "900", color: "#ffffff" }}>
                    Tournament Roster
                  </Text>

                  <Text style={{ fontSize: 14, color: "#b7c9df", lineHeight: 20 }}>
                    Verify wrestlers after registration is confirmed. Match-Day only uses verified entries.
                  </Text>

                  {entries.length === 0 ? (
                    <Text style={{ fontSize: 14, color: "#b7c9df", lineHeight: 20 }}>
                      No wrestlers are listed for this tournament yet.
                    </Text>
                  ) : (
                    entries.map((entry) => (
                      <View
                        key={entry.id}
                        style={{
                          borderWidth: 1,
                          borderColor: entry.status === "confirmed" ? "#166534" : "#315c86",
                          borderRadius: 16,
                          padding: 12,
                          backgroundColor: entry.status === "confirmed" ? "#052e1b" : "#102f52",
                        }}
                      >
                        <Text style={{ fontSize: 15, fontWeight: "800", color: "#ffffff" }}>
                          {entry.wrestlerName}
                        </Text>

                        <Text style={{ fontSize: 13, color: "#b7c9df", marginTop: 4 }}>
                          {[entry.style, entry.weightClass, formatEntryStatus(entry.status)]
                            .filter(Boolean)
                            .join(" • ")}
                        </Text>

                        {!entry.weightClass || !entry.style ? (
                          <Text style={{ fontSize: 13, color: "#fed7aa", marginTop: 6, lineHeight: 19 }}>
                            Tournament weight and style should be set before verification.
                          </Text>
                        ) : null}

                        {entry.notes ? (
                          <Text style={{ fontSize: 13, color: "#dbeafe", marginTop: 6, lineHeight: 19 }}>
                            {entry.notes}
                          </Text>
                        ) : null}

                        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                          <StatusButton
                            label="Edit Weight/Style"
                            onPress={() => openEditEntry(tournament, entry)}
                            variant="light"
                            disabled={savingStatusId === entry.id}
                          />

                          {entry.status !== "planned" ? (
                            <StatusButton
                              label={savingStatusId === entry.id ? "Saving..." : "Planned"}
                              onPress={() => updateEntryStatus(entry, "planned")}
                              variant="light"
                              disabled={savingStatusId === entry.id}
                            />
                          ) : null}

                          {entry.status !== "submitted" ? (
                            <StatusButton
                              label={savingStatusId === entry.id ? "Saving..." : "Submitted"}
                              onPress={() => updateEntryStatus(entry, "submitted")}
                              variant="redLight"
                              disabled={savingStatusId === entry.id}
                            />
                          ) : null}

                          {entry.status !== "confirmed" ? (
                            <StatusButton
                              label={savingStatusId === entry.id ? "Saving..." : "Verify"}
                              onPress={() => {
                                if (!entry.weightClass || !entry.style) {
                                  openEditEntry(tournament, entry);
                                  return;
                                }

                                updateEntryStatus(entry, "confirmed");
                              }}
                              variant="red"
                              disabled={savingStatusId === entry.id}
                            />
                          ) : null}

                          {entry.status === "confirmed" ? (
                            <StatusButton
                              label="Open Match-Day"
                              onPress={() =>
                                router.push({
                                  pathname: "/match-day",
                                  params: {
                                    tournamentId: tournament.id,
                                    wrestlerId: entry.wrestlerId,
                                  },
                                } as any)
                              }
                              variant="red"
                              disabled={false}
                            />
                          ) : null}
                        </View>
                      </View>
                    ))
                  )}
                </View>
              ) : ownWrestler ? (
                <View
                  style={{
                    marginTop: 14,
                    borderTopWidth: 1,
                    borderTopColor: "#21486e",
                    paddingTop: 14,
                    gap: 8,
                  }}
                >
                  <Text style={{ fontSize: 16, fontWeight: "900", color: "#ffffff" }}>
                    My Registration
                  </Text>

                  {entries.filter((entry) => entry.wrestlerId === ownWrestler.id).length === 0 ? (
                    <View style={{ gap: 10 }}>
                      <Text style={{ fontSize: 14, color: "#b7c9df", lineHeight: 20 }}>
                        If you completed registration on USA Bracketing, tap below so your coach can verify it.
                      </Text>

                      <Pressable
                        onPress={() => markRegistered(tournament)}
                        style={{
                          alignSelf: "flex-start",
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 999,
                          backgroundColor: "#bf1029",
                        }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "800" }}>
                          {savingStatusId === tournament.id ? "Saving..." : "I Registered"}
                        </Text>
                      </Pressable>
                    </View>
                  ) : (
                    entries
                      .filter((entry) => entry.wrestlerId === ownWrestler.id)
                      .map((entry) => (
                        <View
                          key={entry.id}
                          style={{
                            borderWidth: 1,
                            borderColor: entry.status === "confirmed" ? "#166534" : "#315c86",
                            borderRadius: 16,
                            padding: 12,
                            backgroundColor: entry.status === "confirmed" ? "#052e1b" : "#102f52",
                          }}
                        >
                          <Text style={{ fontSize: 15, fontWeight: "800", color: "#ffffff" }}>
                            {formatEntryStatus(entry.status)}
                          </Text>

                          <Text style={{ fontSize: 13, color: "#b7c9df", marginTop: 4 }}>
                            {[entry.style, entry.weightClass].filter(Boolean).join(" • ") ||
                              "Weight/style not set yet"}
                          </Text>

                          <Text style={{ fontSize: 13, color: "#dbeafe", marginTop: 6, lineHeight: 19 }}>
                            {entry.status === "planned"
                              ? "You are on the team roster for this tournament. Tap below after you finish USA Bracketing registration."
                              : entry.status === "submitted"
                                ? "You marked this registration as submitted. Your coach can confirm it after checking externally."
                                : "Your coach verified your external registration. You will appear on Match-Day."}
                          </Text>

                          {entry.status === "planned" ? (
                            <Pressable
                              onPress={() => updateEntryStatus(entry, "submitted")}
                              style={{
                                marginTop: 10,
                                alignSelf: "flex-start",
                                paddingHorizontal: 14,
                                paddingVertical: 10,
                                borderRadius: 999,
                                backgroundColor: "#bf1029",
                              }}
                            >
                              <Text style={{ color: "#fff", fontWeight: "800" }}>
                                {savingStatusId === entry.id ? "Saving..." : "I Registered"}
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ))
                  )}
                </View>
              ) : null}

              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                <Pressable
                  onPress={() => Linking.openURL(tournament.registrationUrl)}
                  style={{
                    alignSelf: "flex-start",
                    paddingHorizontal: 16,
                    paddingVertical: 11,
                    borderRadius: 999,
                    backgroundColor: "#bf1029",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>
                    Open Registration
                  </Text>
                </Pressable>

                {appUser.role === "coach" && counts.confirmed > 0 ? (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/match-day",
                        params: { tournamentId: tournament.id },
                      } as any)
                    }
                    style={{
                      alignSelf: "flex-start",
                      paddingHorizontal: 16,
                      paddingVertical: 11,
                      borderRadius: 999,
                      backgroundColor: "#ffffff",
                    }}
                  >
                    <Text style={{ color: "#061a33", fontWeight: "900" }}>
                      Open Match-Day
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </MobileScreenShell>
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

function InfoBox({
  title,
  children,
  tone = "blue",
}: {
  title: string;
  children: ReactNode;
  tone?: "blue" | "orange";
}) {
  return (
    <View
      style={{
        marginTop: 12,
        borderWidth: 1,
        borderColor: tone === "orange" ? "#9a3412" : "#315c86",
        borderRadius: 16,
        padding: 12,
        backgroundColor: tone === "orange" ? "#431407" : "#102f52",
        gap: 6,
      }}
    >
      <Text
        style={{
          fontSize: 14,
          fontWeight: "900",
          color: tone === "orange" ? "#fed7aa" : "#ffffff",
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function MiniStatus({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <View
      style={{
        minWidth: 94,
        flex: 1,
        borderRadius: 16,
        padding: 10,
        backgroundColor: active ? "#052e1b" : "#102f52",
        borderWidth: 1,
        borderColor: active ? "#166534" : "#315c86",
      }}
    >
      <Text style={{ color: active ? "#bbf7d0" : "#93c5fd", fontSize: 12, fontWeight: "900" }}>
        {label}
      </Text>
      <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900", marginTop: 3 }}>
        {value}
      </Text>
    </View>
  );
}

function StatusButton({
  label,
  onPress,
  variant,
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant: "light" | "redLight" | "red";
  disabled?: boolean;
}) {
  const backgroundColor =
    variant === "light" ? "#e5e7eb" : variant === "redLight" ? "#f5d7dc" : "#bf1029";

  const color =
    variant === "light" ? "#111827" : variant === "redLight" ? "#911022" : "#ffffff";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color, fontWeight: "800" }}>{label}</Text>
    </Pressable>
  );
}