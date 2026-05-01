import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@wrestlewell/firebase/client";
import {
  calendarEventMatchesWrestler,
  listPracticeAttendanceForEvent,
  listCalendarEvents,
  listWrestlers,
  upsertPracticeAttendanceCheckIn,
  type CalendarEventRecord,
} from "@wrestlewell/lib/index";
import {
  COLLECTIONS,
  type PracticeAttendanceRecord,
  type PracticeAttendanceStatus,
  type WrestlerProfile,
} from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell } from "../components/mobile-screen-shell";

function formatPracticeDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDurationLabel(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getEventSeconds(event: CalendarEventRecord) {
  return Math.max(0, event.totalSeconds || (event.totalMinutes || 0) * 60);
}

async function listCoachCalendarEvents(teamId: string) {
  const snapshot = await getDocs(
    query(
      collection(db, COLLECTIONS.CALENDAR_EVENTS),
      where("teamId", "==", teamId)
    )
  );

  return snapshot.docs.map((eventDoc) => ({
    id: eventDoc.id,
    ...(eventDoc.data() as Omit<CalendarEventRecord, "id">),
  }));
}

function openPracticePlan(event: CalendarEventRecord) {
  if (!event.practicePlanId) {
    router.push("/practice-plans" as any);
    return;
  }

  router.push({
    pathname: "/practice-plans",
    params: {
      planId: event.practicePlanId,
      calendarEventId: event.id,
      date: event.date,
      assignmentType: event.assignmentType || "team",
      groupId: event.groupId || "",
      groupName: event.groupName || "",
      assignedWrestlerIds: (event.assignedWrestlerIds || []).join(","),
    },
  } as any);
}

export default function CalendarScreen() {
  const {
    firebaseUser,
    appUser,
    currentTeam,
    loading: authLoading,
  } = useMobileAuthState();

  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [attendanceByEventId, setAttendanceByEventId] = useState<
    Record<string, PracticeAttendanceRecord>
  >({});
  const [wrestlersLoaded, setWrestlersLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingAttendanceKey, setSavingAttendanceKey] = useState<string | null>(
    null
  );

  const ownWrestler =
    appUser?.role === "athlete"
      ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser?.uid) ||
        null
      : null;
  const linkedParentWrestlers =
    appUser?.role === "parent"
      ? wrestlers.filter((wrestler) => (appUser.linkedWrestlerIds || []).includes(wrestler.id))
      : [];

  async function refreshAttendanceForVisibleEvents(
    nextEvents: CalendarEventRecord[]
  ) {
    if (
      !currentTeam?.id ||
      (appUser?.role !== "athlete" && appUser?.role !== "parent") ||
      (appUser?.role === "athlete" && !ownWrestler) ||
      (appUser?.role === "parent" && linkedParentWrestlers.length === 0)
    ) {
      setAttendanceByEventId({});
      return;
    }

    const todayKey = new Date().toISOString().split("T")[0];
    const todayEvents = nextEvents.filter((event) => event.date === todayKey);

    const attendanceRows = await Promise.all(
      todayEvents.map((event) =>
        listPracticeAttendanceForEvent(db, currentTeam.id, event.id, ownWrestler.id)
      )
    );

    const nextMap: Record<string, PracticeAttendanceRecord> = {};
    const wrestlerPool =
      appUser?.role === "parent" ? linkedParentWrestlers : ownWrestler ? [ownWrestler] : [];

    todayEvents.forEach((event, index) => {
      attendanceRows[index]
        .filter((attendance) =>
          wrestlerPool.some((wrestler) => wrestler.id === attendance.wrestlerId)
        )
        .forEach((attendance) => {
          nextMap[`${event.id}:${attendance.wrestlerId}`] = attendance;
        });
    });

    setAttendanceByEventId(nextMap);
  }

  async function refresh() {
    if (!currentTeam?.id) {
      setEvents([]);
      setAttendanceByEventId({});
      return;
    }

    if (appUser?.role === "athlete") {
      if (!wrestlersLoaded || !ownWrestler) {
        setEvents([]);
        setAttendanceByEventId({});
        return;
      }

      const rows = await listCalendarEvents(db, currentTeam.id, ownWrestler);
      setEvents(rows);
      await refreshAttendanceForVisibleEvents(rows);
      return;
    }

    if (appUser?.role === "parent") {
      if (!wrestlersLoaded || linkedParentWrestlers.length === 0) {
        setEvents([]);
        setAttendanceByEventId({});
        return;
      }

      const rows = Array.from(
        new Map(
          (
            await Promise.all(
              linkedParentWrestlers.map((wrestler) =>
                listCalendarEvents(db, currentTeam.id, wrestler)
              )
            )
          )
            .flat()
            .map((event) => [event.id, event] as const)
        ).values()
      );
      setEvents(rows);
      await refreshAttendanceForVisibleEvents(rows);
      return;
    }

    const rows = await listCoachCalendarEvents(currentTeam.id);
    setEvents(rows);
    setAttendanceByEventId({});
  }

  useEffect(() => {
    async function loadWrestlers() {
      if (!currentTeam?.id) {
        setWrestlers([]);
        setWrestlersLoaded(true);
        return;
      }

      try {
        setWrestlersLoaded(false);
        setWrestlers(await listWrestlers(db, currentTeam.id));
      } catch (error) {
        console.error("Failed to load wrestlers for calendar assignments:", error);
      } finally {
        setWrestlersLoaded(true);
      }
    }

    loadWrestlers();
  }, [currentTeam?.id]);

  useEffect(() => {
    async function load() {
      if (!firebaseUser || !appUser) {
        setEvents([]);
        setAttendanceByEventId({});
        setLoading(false);
        return;
      }

      if ((appUser.role === "athlete" || appUser.role === "parent") && !wrestlersLoaded) {
        return;
      }

      if (appUser.role === "athlete" && !ownWrestler) {
        setEvents([]);
        setAttendanceByEventId({});
        setLoading(false);
        return;
      }

      if (appUser.role === "parent" && linkedParentWrestlers.length === 0) {
        setEvents([]);
        setAttendanceByEventId({});
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        await refresh();
      } catch (error) {
        console.error("Failed to load calendar:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [
    appUser?.role,
    currentTeam?.id,
    firebaseUser?.uid,
    ownWrestler?.id,
    wrestlersLoaded,
    linkedParentWrestlers.length,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const upcomingEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayKey = today.toISOString().split("T")[0];

    return events
      .filter((event) => event.date >= todayKey)
      .sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;

        return (a.startTime || "").localeCompare(b.startTime || "");
      });
  }, [events]);

  const todayCheckInEvents = useMemo(() => {
    const todayKey = new Date().toISOString().split("T")[0];
    return upcomingEvents.filter((event) => event.date === todayKey);
  }, [upcomingEvents]);

  const parentTodayCheckInRows = useMemo(() => {
    if (appUser?.role !== "parent") {
      return [];
    }

    return linkedParentWrestlers.flatMap((wrestler) =>
      todayCheckInEvents
        .filter((event) => calendarEventMatchesWrestler(event, wrestler))
        .map((event) => ({
          event,
          wrestler,
          attendance: attendanceByEventId[`${event.id}:${wrestler.id}`] || null,
        }))
    );
  }, [appUser?.role, attendanceByEventId, linkedParentWrestlers, todayCheckInEvents]);

  if (!authLoading && (!firebaseUser || !appUser)) {
    return (
      <MobileScreenShell
        title="Calendar"
        subtitle="Sign in to review your team practice calendar."
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
            Sign in on mobile to review your team practice calendar.
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
            <Text style={{ color: "#fff", fontWeight: "900" }}>Go Home</Text>
          </Pressable>
        </View>
      </MobileScreenShell>
    );
  }

  return (
    <MobileScreenShell
      title="Calendar"
      subtitle={
        appUser?.role === "coach"
          ? "Review the team practice schedule and jump straight into assigned plans."
          : appUser?.role === "parent"
            ? "Check linked wrestlers in for practice and stay on top of today’s schedule."
            : "Stay ready with the live team schedule and open assigned practice plans."
      }
    >
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
          Loading schedule...
        </Text>
      ) : null}

      {!loading && upcomingEvents.length === 0 ? (
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
              ? "No upcoming practices are scheduled yet. Assign them on the website and they will appear here."
              : appUser?.role === "parent"
                ? linkedParentWrestlers.length > 0
                  ? "No upcoming practices are visible for your linked wrestlers yet."
                  : "No linked wrestlers yet. Once a coach links your athletes, practice-day check-ins will appear here."
                : ownWrestler
                ? "No upcoming practices are assigned to you yet. Team-wide and wrestler-specific practices will appear here."
                : "Create your wrestler profile to see assigned practices."}
          </Text>
        </View>
      ) : null}

      {appUser?.role === "athlete" &&
      ownWrestler &&
      currentTeam?.practiceCheckInEnabled !== false &&
      currentTeam?.athleteCheckInEnabled !== false ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#21486e",
            borderRadius: 20,
            padding: 18,
            backgroundColor: "#0b2542",
            marginBottom: 18,
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: "900", color: "#ffffff" }}>
            Today&apos;s Check-In
          </Text>

          <Text style={{ color: "#b7c9df", lineHeight: 20 }}>
            Check in for today&apos;s practice so your coach only has to clean up
            exceptions.
          </Text>

          {todayCheckInEvents.length === 0 ? (
            <Text style={{ color: "#b7c9df" }}>
              No visible practices for today.
            </Text>
          ) : (
            <View style={{ gap: 12 }}>
              {todayCheckInEvents.map((event) => {
                const attendanceKey = `${event.id}:${ownWrestler.id}`;
                const attendance = attendanceByEventId[attendanceKey];

                return (
                  <View
                    key={`attendance-${event.id}`}
                    style={{
                      borderWidth: 1,
                      borderColor: "#315c86",
                      borderRadius: 18,
                      padding: 14,
                      backgroundColor: "#102f52",
                      gap: 10,
                    }}
                  >
                    <Text
                      style={{
                        color: "#ffffff",
                        fontWeight: "900",
                        fontSize: 16,
                      }}
                    >
                      {event.practicePlanTitle || "Scheduled practice"}
                    </Text>

                    <Text style={{ color: "#b7c9df" }}>
                      {event.assignmentType === "group" && event.groupName
                        ? event.groupName
                        : event.assignmentType === "custom"
                          ? "Custom assignment"
                          : "Team-wide"}{" "}
                      · {formatPracticeDate(event.date)}
                    </Text>

                    <Text style={{ color: "#93c5fd", fontWeight: "800" }}>
                      Current status:{" "}
                      {attendance?.status
                        ? attendance.status.replace("_", " ")
                        : "not checked in"}
                    </Text>

                    <View
                      style={{
                        flexDirection: "row",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      {[
                        ["present", "Present"],
                        ["late", "Running Late"],
                        ["absent", "Absent"],
                        ["injured", "Injured"],
                        ["not_sure", "Not Sure"],
                      ].map(([value, label]) => {
                        const active = attendance?.status === value;

                        return (
                          <Pressable
                            key={value}
                            onPress={async () => {
                              if (!currentTeam?.id || !firebaseUser?.uid) {
                                return;
                              }

                              try {
                                setSavingAttendanceKey(attendanceKey);

                                const savedStatus = value as PracticeAttendanceStatus;
                                const savedWrestlerName =
                                  `${ownWrestler.firstName} ${ownWrestler.lastName}`.trim() ||
                                  "Unnamed Wrestler";

                                const attendanceId = await upsertPracticeAttendanceCheckIn(db, {
                                  teamId: currentTeam.id,
                                  calendarEventId: event.id,
                                  practicePlanId: event.practicePlanId,
                                  date: event.date,
                                  assignmentType: event.assignmentType || "team",
                                  groupId: event.groupId,
                                  groupName: event.groupName,
                                  assignedWrestlerIds: event.assignedWrestlerIds,
                                  wrestlerId: ownWrestler.id,
                                  wrestlerName: savedWrestlerName,
                                  status: savedStatus,
                                  checkedInByUserId: firebaseUser.uid,
                                  checkedInByRole: "athlete",
                                });

                                setAttendanceByEventId((prev) => ({
                                  ...prev,
                                  [attendanceKey]: {
                                    ...(prev[attendanceKey] || {}),
                                    id: attendanceId,
                                    teamId: currentTeam.id,
                                    calendarEventId: event.id,
                                    practicePlanId: event.practicePlanId,
                                    date: event.date,
                                    assignmentType: event.assignmentType || "team",
                                    groupId: event.groupId,
                                    groupName: event.groupName,
                                    assignedWrestlerIds: event.assignedWrestlerIds || [],
                                    wrestlerId: ownWrestler.id,
                                    wrestlerName: savedWrestlerName,
                                    status: savedStatus,
                                    checkedInByUserId: firebaseUser.uid,
                                    checkedInByRole: "athlete",
                                    checkedInAt: new Date().toISOString(),
                                    notes: "",
                                    createdAt: prev[attendanceKey]?.createdAt || new Date().toISOString(),
                                    updatedAt: new Date().toISOString(),
                                  },
                                }));

                              } catch (error: any) {
                                console.error("Failed to save check-in:", error);
                              } finally {
                                setSavingAttendanceKey(null);
                              }
                            }}
                            style={{
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: 999,
                              backgroundColor: active ? "#bf1029" : "#0b2542",
                              borderWidth: 1,
                              borderColor: active ? "#fca5a5" : "#315c86",
                              opacity:
                                savingAttendanceKey === attendanceKey ? 0.6 : 1,
                            }}
                          >
                            <Text
                              style={{
                                color: "#ffffff",
                                fontWeight: "800",
                                fontSize: 13,
                              }}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      ) : null}

      {appUser?.role === "parent" &&
      currentTeam?.practiceCheckInEnabled !== false &&
      currentTeam?.parentCheckInEnabled !== false ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#21486e",
            borderRadius: 20,
            padding: 18,
            backgroundColor: "#0b2542",
            marginBottom: 18,
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: "900", color: "#ffffff" }}>
            Family Check-In
          </Text>

          <Text style={{ color: "#b7c9df", lineHeight: 20 }}>
            Check in linked wrestlers for today’s visible practices. Coaches will only need to clean up exceptions.
          </Text>

          {linkedParentWrestlers.length === 0 ? (
            <Text style={{ color: "#b7c9df" }}>
              No linked wrestlers yet. Ask a coach to connect your family account.
            </Text>
          ) : parentTodayCheckInRows.length === 0 ? (
            <Text style={{ color: "#b7c9df" }}>
              No visible practices for your linked wrestlers today.
            </Text>
          ) : (
            <View style={{ gap: 12 }}>
              {parentTodayCheckInRows.map(({ event, wrestler, attendance }) => {
                const attendanceKey = `${event.id}:${wrestler.id}`;
                return (
                  <View
                    key={`parent-attendance-${attendanceKey}`}
                    style={{
                      borderWidth: 1,
                      borderColor: "#315c86",
                      borderRadius: 18,
                      padding: 14,
                      backgroundColor: "#102f52",
                      gap: 10,
                    }}
                  >
                    <Text style={{ color: "#ffffff", fontWeight: "900", fontSize: 16 }}>
                      {`${wrestler.firstName} ${wrestler.lastName}`.trim() || "Linked Wrestler"}
                    </Text>

                    <Text style={{ color: "#dbeafe", fontWeight: "800" }}>
                      {event.practicePlanTitle || "Scheduled practice"}
                    </Text>

                    <Text style={{ color: "#b7c9df" }}>
                      {event.assignmentType === "group" && event.groupName
                        ? event.groupName
                        : event.assignmentType === "custom"
                          ? "Custom assignment"
                          : "Team-wide"}{" "}
                      · {formatPracticeDate(event.date)}
                    </Text>

                    <Text style={{ color: "#93c5fd", fontWeight: "800" }}>
                      Current status: {attendance?.status ? attendance.status.replace("_", " ") : "not checked in"}
                    </Text>

                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      {[
                        ["present", "Present"],
                        ["late", "Running Late"],
                        ["absent", "Absent"],
                        ["injured", "Injured"],
                        ["not_sure", "Not Sure"],
                      ].map(([value, label]) => {
                        const active = attendance?.status === value;
                        return (
                          <Pressable
                            key={`${attendanceKey}-${value}`}
                            onPress={async () => {
                              if (!currentTeam?.id || !firebaseUser?.uid) {
                                return;
                              }

                              try {
                                setSavingAttendanceKey(attendanceKey);
                                await upsertPracticeAttendanceCheckIn(db, {
                                  teamId: currentTeam.id,
                                  calendarEventId: event.id,
                                  practicePlanId: event.practicePlanId,
                                  date: event.date,
                                  assignmentType: event.assignmentType || "team",
                                  groupId: event.groupId,
                                  groupName: event.groupName,
                                  assignedWrestlerIds: event.assignedWrestlerIds,
                                  wrestlerId: wrestler.id,
                                  wrestlerName:
                                    `${wrestler.firstName} ${wrestler.lastName}`.trim() ||
                                    "Unnamed Wrestler",
                                  status: value as PracticeAttendanceStatus,
                                  checkedInByUserId: firebaseUser.uid,
                                  checkedInByRole: "parent",
                                });
                                await refresh();
                              } catch (error) {
                                console.error("Failed to save parent check-in:", error);
                              } finally {
                                setSavingAttendanceKey(null);
                              }
                            }}
                            style={{
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: 999,
                              backgroundColor: active ? "#bf1029" : "#0b2542",
                              borderWidth: 1,
                              borderColor: active ? "#fca5a5" : "#315c86",
                              opacity: savingAttendanceKey === attendanceKey ? 0.6 : 1,
                            }}
                          >
                            <Text style={{ color: "#ffffff", fontWeight: "800", fontSize: 13 }}>
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      ) : null}

      <View style={{ gap: 14 }}>
        {upcomingEvents.map((event) => (
          <Pressable
            key={event.id}
            onPress={() => openPracticePlan(event)}
            style={({ pressed }) => ({
              borderWidth: 1,
              borderColor: pressed ? "#ffffff" : "#21486e",
              borderRadius: 24,
              padding: 18,
              backgroundColor: pressed ? "#173b67" : "#0b2542",
            })}
          >
            <View
              style={{
                alignSelf: "flex-start",
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 999,
                backgroundColor: "#102f52",
                borderWidth: 1,
                borderColor: "#315c86",
                marginBottom: 10,
              }}
            >
              <Text
                style={{ color: "#93c5fd", fontSize: 12, fontWeight: "900" }}
              >
                PRACTICE
              </Text>
            </View>

            <Text style={{ fontSize: 21, fontWeight: "900", color: "#ffffff" }}>
              {formatPracticeDate(event.date)}
            </Text>

            {event.startTime || event.endTime ? (
              <Text
                style={{
                  fontSize: 14,
                  color: "#b7c9df",
                  marginTop: 5,
                  fontWeight: "800",
                }}
              >
                {[event.startTime, event.endTime].filter(Boolean).join(" - ")}
              </Text>
            ) : null}

            <Text
              style={{
                fontSize: 17,
                fontWeight: "900",
                color: "#93c5fd",
                marginTop: 8,
              }}
            >
              {event.practicePlanTitle || "Untitled Practice Plan"}
            </Text>

            <Text
              style={{
                fontSize: 14,
                color: "#b7c9df",
                marginTop: 8,
                lineHeight: 20,
              }}
            >
              {event.practicePlanStyle || "Mixed"} •{" "}
              {formatDurationLabel(getEventSeconds(event))}
            </Text>

            <Text
              style={{
                fontSize: 13,
                color: "#dbeafe",
                marginTop: 8,
                fontWeight: "800",
              }}
            >
              {event.assignmentType === "group" && event.groupName
                ? `Training group • ${event.groupName}`
                : event.assignmentType === "custom"
                  ? `Custom wrestlers • ${
                      (event.assignedWrestlerIds || []).length
                    } wrestler${
                      (event.assignedWrestlerIds || []).length === 1 ? "" : "s"
                    }`
                  : "Team-wide"}
            </Text>

            {event.notes ? (
              <Text
                style={{
                  fontSize: 14,
                  color: "#dbeafe",
                  marginTop: 10,
                  lineHeight: 21,
                }}
              >
                {event.notes}
              </Text>
            ) : null}

            <View
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
                Open Practice Plan
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </MobileScreenShell>
  );
}
