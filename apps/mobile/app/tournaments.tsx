import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { db } from "@wrestlewell/firebase/client";
import {
  createTeamNotification,
  createTournamentEntry,
  listTournamentEntries,
  listTournaments,
  listWrestlers,
  updateTournamentEntryStatus,
} from "@wrestlewell/lib/index";
import type { Tournament, TournamentEntry, WrestlerProfile } from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { ScreenShell } from "../components/screen-shell";

function formatEntryStatus(status: TournamentEntry["status"]) {
  if (status === "planned") return "Planned";
  if (status === "submitted") return "Submitted";
  return "Verified";
}

export default function TournamentsScreen() {
  const { firebaseUser, appUser, currentTeam } = useMobileAuthState();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [entriesByTournament, setEntriesByTournament] = useState<Record<string, TournamentEntry[]>>({});
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);

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
      rows.map(async (tournament) => [
        tournament.id,
        await listTournamentEntries(db, { teamId: currentTeam.id, tournamentId: tournament.id }),
      ] as const)
    );

    setEntriesByTournament(Object.fromEntries(entryRows));
  }

  const ownWrestler =
    appUser?.role === "athlete" && firebaseUser
      ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) || null
      : null;

  async function updateEntryStatus(entry: TournamentEntry, status: TournamentEntry["status"]) {
    try {
      setSavingStatusId(entry.id);
      await updateTournamentEntryStatus(db, entry, status);
      if (status === "submitted" && appUser?.role === "athlete" && currentTeam?.id) {
        const tournament = tournaments.find((item) => item.id === entry.tournamentId);
        await createTeamNotification(db, {
          teamId: currentTeam.id,
          audienceRole: "coach",
          title: "Tournament registration submitted",
          body: `${entry.wrestlerName} marked themselves registered for ${tournament?.name || "a tournament"}. Please verify the USA Bracketing registration.`,
          type: "tournament_registration",
          createdBy: firebaseUser?.uid || "",
          tournamentId: entry.tournamentId,
          tournamentEntryId: entry.id,
          wrestlerId: entry.wrestlerId,
        });
      }
      await refresh();
      Alert.alert(
        "Registration updated",
        status === "confirmed"
          ? "This tournament entry is now verified."
          : status === "submitted"
            ? "This tournament entry is now marked registered."
            : "This tournament entry is now back in planned status."
      );
    } catch (error) {
      console.error("Failed to update tournament entry status:", error);
      Alert.alert("Update failed", "There was a problem updating the tournament registration status.");
    } finally {
      setSavingStatusId(null);
    }
  }

  async function markRegistered(tournament: Tournament) {
    if (!currentTeam?.id || !ownWrestler) {
      Alert.alert("Profile needed", "Create your wrestler profile before joining a tournament roster.");
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
        wrestlerName: `${ownWrestler.firstName} ${ownWrestler.lastName}`.trim(),
        style: ownWrestler.styles[0],
        weightClass: ownWrestler.weightClass,
        status: "submitted",
      });
      await createTeamNotification(db, {
        teamId: currentTeam.id,
        audienceRole: "coach",
        title: "Tournament registration submitted",
        body: `${ownWrestler.firstName} ${ownWrestler.lastName} marked themselves registered for ${tournament.name}. Please verify the USA Bracketing registration.`,
        type: "tournament_registration",
        createdBy: firebaseUser?.uid || "",
        tournamentId: tournament.id,
        tournamentEntryId: entryId,
        wrestlerId: ownWrestler.id,
      });
      await refresh();
      Alert.alert("Registration submitted", "Your coach has been notified to verify it.");
    } catch (error) {
      console.error("Failed to mark athlete registered:", error);
      Alert.alert("Update failed", "There was a problem adding you to this tournament roster.");
    } finally {
      setSavingStatusId(null);
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
      <ScreenShell>
        <View
          style={{
            borderRadius: 18,
            padding: 18,
            borderWidth: 1,
            borderColor: "rgba(15, 39, 72, 0.12)",
            backgroundColor: "#fff",
            gap: 10,
          }}
        >
          <Text style={{ fontSize: 24, fontWeight: "800", color: "#091729" }}>Sign in required</Text>
          <Text style={{ fontSize: 15, color: "#5f6d83", lineHeight: 22 }}>
            Sign in on mobile to open your team tournament links and registration hub.
          </Text>
          <Link href="/" asChild>
            <Pressable
              style={{
                alignSelf: "flex-start",
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 999,
                backgroundColor: "#bf1029",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>Go Home</Text>
            </Pressable>
          </Link>
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
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
      </View>

      <Text style={{ fontSize: 28, fontWeight: "700", marginBottom: 12 }}>Tournaments</Text>
      <Text style={{ fontSize: 16, color: "#555", marginBottom: 20 }}>
        {appUser.role === "coach"
          ? "Season event list with direct links to official registration pages for your team."
          : "Read-only tournament list with direct links to official registration pages for your team."}
      </Text>

      {appUser.role !== "coach" ? (
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
            Coaches manage tournament setup on the website. Athletes can use this screen to review upcoming events and open registration links.
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

      {loading ? <Text>Loading tournaments...</Text> : null}

      {!loading && tournaments.length === 0 ? (
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
            No tournaments added yet. Import or create tournament links on the web app.
          </Text>
        </View>
      ) : null}

      <View style={{ gap: 14 }}>
        {tournaments.map((tournament) => (
          <View
            key={tournament.id}
            style={{
              borderWidth: 1,
              borderColor: "#ddd",
              borderRadius: 18,
              padding: 18,
              backgroundColor: "#fff",
            }}
          >
            <Text style={{ fontSize: 20, fontWeight: "800", color: "#091729" }}>{tournament.name}</Text>
            <Text style={{ fontSize: 14, color: "#5f6d83", marginTop: 8 }}>
              Source: {tournament.source === "excel_import" ? "Workbook import" : "Manual"}
            </Text>
            {tournament.eventDate ? (
              <Text style={{ fontSize: 14, color: "#5f6d83", marginTop: 4 }}>
                Event Date: {tournament.eventDate}
              </Text>
            ) : null}
            {tournament.weighInTime ? (
              <Text style={{ fontSize: 14, color: "#0f2748", marginTop: 4, fontWeight: "700" }}>
                Weigh-In Time: {tournament.weighInTime}
              </Text>
            ) : null}
            {tournament.arrivalTime ? (
              <Text style={{ fontSize: 14, color: "#0f2748", marginTop: 4, fontWeight: "700" }}>
                Arrival Time: {tournament.arrivalTime}
              </Text>
            ) : null}
            {tournament.notes ? (
              <Text style={{ fontSize: 14, color: "#374151", marginTop: 8, lineHeight: 20 }}>
                {tournament.notes}
              </Text>
            ) : null}
            {appUser.role === "coach" && tournament.coachEventNotes ? (
              <View
                style={{
                  marginTop: 12,
                  borderWidth: 1,
                  borderColor: "#e5e7eb",
                  borderRadius: 12,
                  padding: 12,
                  backgroundColor: "#f8fafc",
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: "800", color: "#0f2748", marginBottom: 6 }}>
                  Coach Event Notes
                </Text>
                <Text style={{ fontSize: 14, color: "#374151", lineHeight: 20 }}>
                  {tournament.coachEventNotes}
                </Text>
              </View>
            ) : null}
            {tournament.travelChecklist && tournament.travelChecklist.length > 0 ? (
              <View
                style={{
                  marginTop: 12,
                  borderWidth: 1,
                  borderColor: "#fed7aa",
                  borderRadius: 12,
                  padding: 12,
                  backgroundColor: "#fff7ed",
                  gap: 6,
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: "800", color: "#9a3412" }}>Travel Checklist</Text>
                {tournament.travelChecklist.map((item) => (
                  <Text key={`travel-${tournament.id}-${item}`} style={{ fontSize: 14, color: "#7c2d12", lineHeight: 20 }}>
                    • {item}
                  </Text>
                ))}
              </View>
            ) : null}
            {appUser.role === "coach" && tournament.coachChecklist && tournament.coachChecklist.length > 0 ? (
              <View
                style={{
                  marginTop: 12,
                  borderWidth: 1,
                  borderColor: "#e5e7eb",
                  borderRadius: 12,
                  padding: 12,
                  backgroundColor: "#f8fafc",
                  gap: 6,
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: "800", color: "#0f2748" }}>Coach Day-Of Checklist</Text>
                {tournament.coachChecklist.map((item) => (
                  <Text key={`coach-${tournament.id}-${item}`} style={{ fontSize: 14, color: "#374151", lineHeight: 20 }}>
                    • {item}
                  </Text>
                ))}
              </View>
            ) : null}

            {appUser.role === "coach" ? (
              <View
                style={{
                  marginTop: 14,
                  borderTopWidth: 1,
                  borderTopColor: "#e5e7eb",
                  paddingTop: 14,
                  gap: 8,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: "800", color: "#0f2748" }}>
                  Tournament Roster
                </Text>
                {(entriesByTournament[tournament.id] || []).length === 0 ? (
                  <Text style={{ fontSize: 14, color: "#5f6d83", lineHeight: 20 }}>
                    No wrestlers are listed for this tournament yet.
                  </Text>
                ) : (
                  (entriesByTournament[tournament.id] || []).map((entry) => (
                    <View
                      key={entry.id}
                      style={{
                        borderWidth: 1,
                        borderColor: "#e5e7eb",
                        borderRadius: 12,
                        padding: 12,
                        backgroundColor: "#f8fafc",
                      }}
                    >
                      <Text style={{ fontSize: 15, fontWeight: "700", color: "#111827" }}>
                        {entry.wrestlerName}
                      </Text>
                      <Text style={{ fontSize: 13, color: "#5f6d83", marginTop: 4 }}>
                        {[entry.style, entry.weightClass, formatEntryStatus(entry.status)]
                          .filter(Boolean)
                          .join(" • ")}
                      </Text>
                      {entry.notes ? (
                        <Text style={{ fontSize: 13, color: "#374151", marginTop: 6, lineHeight: 19 }}>
                          {entry.notes}
                        </Text>
                      ) : null}
                      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                        {entry.status !== "planned" ? (
                          <Pressable
                            onPress={() => updateEntryStatus(entry, "planned")}
                            style={{
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: 999,
                              backgroundColor: "#e5e7eb",
                            }}
                          >
                            <Text style={{ color: "#111827", fontWeight: "700" }}>
                              {savingStatusId === entry.id ? "Saving..." : "Planned"}
                            </Text>
                          </Pressable>
                        ) : null}

                        {entry.status !== "submitted" ? (
                          <Pressable
                            onPress={() => updateEntryStatus(entry, "submitted")}
                            style={{
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: 999,
                              backgroundColor: "#f5d7dc",
                            }}
                          >
                            <Text style={{ color: "#911022", fontWeight: "700" }}>
                              {savingStatusId === entry.id ? "Saving..." : "Submitted"}
                            </Text>
                          </Pressable>
                        ) : null}

                        {entry.status !== "confirmed" ? (
                          <Pressable
                            onPress={() => updateEntryStatus(entry, "confirmed")}
                            style={{
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: 999,
                              backgroundColor: "#0f2748",
                            }}
                          >
                            <Text style={{ color: "#fff", fontWeight: "700" }}>
                              {savingStatusId === entry.id ? "Saving..." : "Verify"}
                            </Text>
                          </Pressable>
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
                  borderTopColor: "#e5e7eb",
                  paddingTop: 14,
                  gap: 8,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: "800", color: "#0f2748" }}>
                  My Registration
                </Text>
                {(entriesByTournament[tournament.id] || []).filter((entry) => entry.wrestlerId === ownWrestler.id)
                  .length === 0 ? (
                  <View style={{ gap: 10 }}>
                    <Text style={{ fontSize: 14, color: "#5f6d83", lineHeight: 20 }}>
                      If you completed registration on USA Bracketing, tap below so your coach can verify it.
                    </Text>
                    <Pressable
                      onPress={() => markRegistered(tournament)}
                      style={{
                        alignSelf: "flex-start",
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 999,
                        backgroundColor: "#0f2748",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "700" }}>
                        {savingStatusId === tournament.id ? "Saving..." : "I Registered"}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  (entriesByTournament[tournament.id] || [])
                    .filter((entry) => entry.wrestlerId === ownWrestler.id)
                    .map((entry) => (
                      <View
                        key={entry.id}
                        style={{
                          borderWidth: 1,
                          borderColor: "#e5e7eb",
                          borderRadius: 12,
                          padding: 12,
                          backgroundColor: "#f8fafc",
                        }}
                      >
                        <Text style={{ fontSize: 15, fontWeight: "700", color: "#111827" }}>
                          {formatEntryStatus(entry.status)}
                        </Text>
                        <Text style={{ fontSize: 13, color: "#5f6d83", marginTop: 4 }}>
                          {[entry.style, entry.weightClass].filter(Boolean).join(" • ")}
                        </Text>
                        <Text style={{ fontSize: 13, color: "#374151", marginTop: 6, lineHeight: 19 }}>
                          {entry.status === "planned"
                            ? "You are on the team roster for this tournament. Tap below after you finish USA Bracketing registration."
                            : entry.status === "submitted"
                              ? "You marked this registration as submitted. Your coach can confirm it after checking externally."
                              : "Your coach verified your external registration."}
                        </Text>
                        {entry.status === "planned" ? (
                              <Pressable
                            onPress={() => updateEntryStatus(entry, "submitted")}
                            style={{
                              marginTop: 10,
                              alignSelf: "flex-start",
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: 999,
                              backgroundColor: "#bf1029",
                            }}
                          >
                            <Text style={{ color: "#fff", fontWeight: "700" }}>
                              {savingStatusId === entry.id ? "Saving..." : "I Registered"}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ))
                )}
              </View>
            ) : null}

            <Pressable
              onPress={() => Linking.openURL(tournament.registrationUrl)}
              style={{
                marginTop: 14,
                alignSelf: "flex-start",
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 999,
                backgroundColor: "#bf1029",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>Open Registration</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </ScreenShell>
  );
}
