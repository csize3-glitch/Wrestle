import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { db } from "@wrestlewell/firebase/client";
import { listCalendarEvents, type CalendarEventRecord } from "@wrestlewell/lib/index";
import { useMobileAuthState } from "../components/auth-provider";
import { ScreenShell } from "../components/screen-shell";

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
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function CalendarScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } = useMobileAuthState();
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!currentTeam?.id) {
      setEvents([]);
      return;
    }

    const rows = await listCalendarEvents(db, currentTeam.id);
    setEvents(rows);
  }

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
  }, [appUser, currentTeam?.id, firebaseUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const upcomingEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = today.toISOString().split("T")[0];
    return events.filter((event) => event.date >= todayKey);
  }, [events]);

  if (!authLoading && (!firebaseUser || !appUser)) {
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
            Sign in on mobile to review your team practice calendar.
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

      <Text style={{ fontSize: 28, fontWeight: "700", marginBottom: 12 }}>Calendar</Text>
      <Text style={{ fontSize: 16, color: "#555", marginBottom: 20 }}>
        {appUser?.role === "coach"
          ? "Review the team practice schedule and jump straight into the assigned plan on your phone."
          : "Stay ready with the live team schedule and open assigned practice plans from your phone."}
      </Text>

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

      {loading ? <Text>Loading schedule...</Text> : null}

      {!loading && upcomingEvents.length === 0 ? (
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
            No upcoming practices are scheduled yet. Assign them on the website and they will appear here.
          </Text>
        </View>
      ) : null}

      <View style={{ gap: 14 }}>
        {upcomingEvents.map((event) => (
          <View
            key={event.id}
            style={{
              borderWidth: 1,
              borderColor: "#ddd",
              borderRadius: 18,
              padding: 18,
              backgroundColor: "#fff",
            }}
          >
            <Text style={{ fontSize: 20, fontWeight: "800", color: "#091729" }}>
              {formatPracticeDate(event.date)}
            </Text>
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#0f2748", marginTop: 8 }}>
              {event.practicePlanTitle || "Untitled Practice Plan"}
            </Text>
            <Text style={{ fontSize: 14, color: "#5f6d83", marginTop: 8, lineHeight: 20 }}>
              {event.practicePlanStyle || "Mixed"} •{" "}
              {formatDurationLabel(event.totalSeconds || event.totalMinutes || 0)}
            </Text>
            {event.notes ? (
              <Text style={{ fontSize: 14, color: "#374151", marginTop: 10, lineHeight: 21 }}>
                {event.notes}
              </Text>
            ) : null}

            <Link href={{ pathname: "/practice-plans", params: { planId: event.practicePlanId } }} asChild>
              <Pressable
                style={{
                  marginTop: 14,
                  alignSelf: "flex-start",
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 999,
                  backgroundColor: "#bf1029",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>Open Practice Plan</Text>
              </Pressable>
            </Link>
          </View>
        ))}
      </View>
    </ScreenShell>
  );
}
