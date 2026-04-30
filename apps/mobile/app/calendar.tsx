import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { db } from "@wrestlewell/firebase/client";
import {
  listCalendarEvents,
  listWrestlers,
  type CalendarEventRecord,
} from "@wrestlewell/lib/index";
import type { WrestlerProfile } from "@wrestlewell/types/index";
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

function openPracticePlan(event: CalendarEventRecord) {
  if (!event.practicePlanId) {
    router.push("/practice-plans" as any);
    return;
  }

  router.push({
    pathname: "/practice-plans",
    params: { planId: event.practicePlanId },
  } as any);
}

export default function CalendarScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } =
    useMobileAuthState();

  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const ownWrestler =
    appUser?.role === "athlete"
      ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser?.uid) ||
        null
      : null;

  async function refresh() {
    if (!currentTeam?.id) {
      setEvents([]);
      return;
    }

    const rows = await listCalendarEvents(
      db,
      currentTeam.id,
      appUser?.role === "athlete" ? ownWrestler?.id : undefined
    );

    setEvents(rows);
  }

  useEffect(() => {
    async function loadWrestlers() {
      if (!currentTeam?.id) {
        setWrestlers([]);
        return;
      }

      try {
        setWrestlers(await listWrestlers(db, currentTeam.id));
      } catch (error) {
        console.error("Failed to load wrestlers for calendar assignments:", error);
      }
    }

    loadWrestlers();
  }, [currentTeam?.id]);

  useEffect(() => {
    async function load() {
      if (!firebaseUser || !appUser) {
        setEvents([]);
        setLoading(false);
        return;
      }

      try {
        await refresh();
      } catch (error) {
        console.error("Failed to load calendar:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [appUser, currentTeam?.id, firebaseUser, ownWrestler?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
              : "No upcoming practices are assigned to you yet. Team-wide and wrestler-specific practices will appear here."}
          </Text>
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
              <Text style={{ color: "#93c5fd", fontSize: 12, fontWeight: "900" }}>
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

            <Text style={{ fontSize: 14, color: "#b7c9df", marginTop: 8, lineHeight: 20 }}>
              {event.practicePlanStyle || "Mixed"} •{" "}
              {formatDurationLabel(getEventSeconds(event))}
            </Text>

            <Text style={{ fontSize: 13, color: "#dbeafe", marginTop: 8, fontWeight: "800" }}>
              {(event.assignedWrestlerIds || []).length === 0
                ? "Team-wide"
                : `Assigned practice • ${(event.assignedWrestlerIds || []).length} wrestler${
                    (event.assignedWrestlerIds || []).length === 1 ? "" : "s"
                  }`}
            </Text>

            {event.notes ? (
              <Text style={{ fontSize: 14, color: "#dbeafe", marginTop: 10, lineHeight: 21 }}>
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