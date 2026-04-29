import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
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
} from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell } from "../components/mobile-screen-shell";

function formatEntryStatus(status: TournamentEntry["status"]) {
  if (status === "planned") return "Planned";
  if (status === "submitted") return "Submitted";
  return "Verified";
}

export default function TournamentsScreen() {
  const { firebaseUser, appUser, currentTeam } = useMobileAuthState();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [entriesByTournament, setEntriesByTournament] = useState<
    Record<string, TournamentEntry[]>
  >({});
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

  const ownWrestler =
    appUser?.role === "athlete" && firebaseUser
      ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) ||
        null
      : null;

  const visibleTournaments =
    appUser?.role === "athlete" && ownWrestler
      ? tournaments.filter((tournament) => {
          const entries = entriesByTournament[tournament.id] || [];
          return (
            entries.length === 0 ||
            entries.some((entry) => entry.wrestlerId === ownWrestler.id)
          );
        })
      : tournaments;

  async function updateEntryStatus(
    entry: TournamentEntry,
    status: TournamentEntry["status"]
  ) {
    try {
      setSavingStatusId(entry.id);
      await updateTournamentEntryStatus(db, entry, status);

      if (status === "submitted" && appUser?.role === "athlete" && currentTeam?.id) {
        const tournament = tournaments.find(
          (item) => item.id === entry.tournamentId
        );

        await createTeamNotification(db, {
          teamId: currentTeam.id,
          audienceRole: "coach",
          title: "Tournament registration submitted",
          body: `${entry.wrestlerName} marked themselves registered for ${
            tournament?.name || "a tournament"
          }. Please verify the USA Bracketing registration.`,
          type: "tournament_registration",
          createdBy: firebaseUser?.uid || "",
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
            excludeUserIds: [firebaseUser?.uid || ""],
            preferenceKey: "tournamentAlerts",
          });
        } catch (pushError) {
          console.error("Failed to send tournament registration push:", pushError);
        }
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
      Alert.alert(
        "Update failed",
        "There was a problem updating the tournament registration status."
      );
    } finally {
      setSavingStatusId(null);
    }
  }

  async function markRegistered(tournament: Tournament) {
    if (!currentTeam?.id || !ownWrestler) {
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

      try {
        await sendTeamPushDelivery(db, {
          teamId: currentTeam.id,
          title: "Tournament registration submitted",
          body: `${ownWrestler.firstName} ${ownWrestler.lastName} marked themselves registered for ${tournament.name}.`,
          audienceRole: "coach",
          excludeUserIds: [firebaseUser?.uid || ""],
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
          ? "Season event list with registration links and roster status."
          : "Upcoming team events, registration links, and roster status."
      }
    >
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
            Coaches manage tournament setup on the website. Athletes can use this
            screen to review upcoming events and open registration links.
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
            {appUser?.role === "coach"
              ? "No tournaments added yet. Import or create tournament links on the web app."
              : "No tournaments are assigned to you yet. Once your coach adds you to a roster, they will show up here."}
          </Text>
        </View>
      ) : null}

      <View style={{ gap: 14 }}>
        {visibleTournaments.map((tournament) => (
          <View
            key={tournament.id}
            style={{
              borderWidth: 1,
              borderColor: "#21486e",
              borderRadius: 24,
              padding: 18,
              backgroundColor: "#0b2542",
            }}
          >
            <Text style={{ fontSize: 21, fontWeight: "900", color: "#ffffff" }}>
              {tournament.name}
            </Text>

            <Text style={{ fontSize: 14, color: "#b7c9df", marginTop: 8 }}>
              Source: {tournament.source === "excel_import" ? "Workbook import" : "Manual"}
            </Text>

            {tournament.eventDate ? (
              <Text style={{ fontSize: 14, color: "#b7c9df", marginTop: 4 }}>
                Event Date: {tournament.eventDate}
              </Text>
            ) : null}

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

                {(entriesByTournament[tournament.id] || []).length === 0 ? (
                  <Text style={{ fontSize: 14, color: "#b7c9df", lineHeight: 20 }}>
                    No wrestlers are listed for this tournament yet.
                  </Text>
                ) : (
                  (entriesByTournament[tournament.id] || []).map((entry) => (
                    <View
                      key={entry.id}
                      style={{
                        borderWidth: 1,
                        borderColor: "#315c86",
                        borderRadius: 16,
                        padding: 12,
                        backgroundColor: "#102f52",
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

                      {entry.notes ? (
                        <Text style={{ fontSize: 13, color: "#dbeafe", marginTop: 6, lineHeight: 19 }}>
                          {entry.notes}
                        </Text>
                      ) : null}

                      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                        {entry.status !== "planned" ? (
                          <StatusButton
                            label={savingStatusId === entry.id ? "Saving..." : "Planned"}
                            onPress={() => updateEntryStatus(entry, "planned")}
                            variant="light"
                          />
                        ) : null}

                        {entry.status !== "submitted" ? (
                          <StatusButton
                            label={savingStatusId === entry.id ? "Saving..." : "Submitted"}
                            onPress={() => updateEntryStatus(entry, "submitted")}
                            variant="redLight"
                          />
                        ) : null}

                        {entry.status !== "confirmed" ? (
                          <StatusButton
                            label={savingStatusId === entry.id ? "Saving..." : "Verify"}
                            onPress={() => updateEntryStatus(entry, "confirmed")}
                            variant="red"
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

                {(entriesByTournament[tournament.id] || []).filter(
                  (entry) => entry.wrestlerId === ownWrestler.id
                ).length === 0 ? (
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
                  (entriesByTournament[tournament.id] || [])
                    .filter((entry) => entry.wrestlerId === ownWrestler.id)
                    .map((entry) => (
                      <View
                        key={entry.id}
                        style={{
                          borderWidth: 1,
                          borderColor: "#315c86",
                          borderRadius: 16,
                          padding: 12,
                          backgroundColor: "#102f52",
                        }}
                      >
                        <Text style={{ fontSize: 15, fontWeight: "800", color: "#ffffff" }}>
                          {formatEntryStatus(entry.status)}
                        </Text>

                        <Text style={{ fontSize: 13, color: "#b7c9df", marginTop: 4 }}>
                          {[entry.style, entry.weightClass].filter(Boolean).join(" • ")}
                        </Text>

                        <Text style={{ fontSize: 13, color: "#dbeafe", marginTop: 6, lineHeight: 19 }}>
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

            <Pressable
              onPress={() => Linking.openURL(tournament.registrationUrl)}
              style={{
                marginTop: 14,
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
          </View>
        ))}
      </View>
    </MobileScreenShell>
  );
}

function InfoBox({
  title,
  children,
  tone = "blue",
}: {
  title: string;
  children: React.ReactNode;
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

function StatusButton({
  label,
  onPress,
  variant,
}: {
  label: string;
  onPress: () => void;
  variant: "light" | "redLight" | "red";
}) {
  const backgroundColor =
    variant === "light" ? "#e5e7eb" : variant === "redLight" ? "#f5d7dc" : "#bf1029";

  const color =
    variant === "light" ? "#111827" : variant === "redLight" ? "#911022" : "#ffffff";

  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor,
      }}
    >
      <Text style={{ color, fontWeight: "800" }}>{label}</Text>
    </Pressable>
  );
}