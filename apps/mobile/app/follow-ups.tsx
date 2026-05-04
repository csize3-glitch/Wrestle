import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { db } from "@wrestlewell/firebase/client";
import {
  listPracticeSessionFollowUps,
  updatePracticeSessionFollowUpStatus,
} from "@wrestlewell/lib/index";
import type { PracticeSessionFollowUpRecord } from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell } from "../components/mobile-screen-shell";

function formatDueDate(value?: string) {
  if (!value) return "No due date";

  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function FollowUpsScreen() {
  const { appUser, currentTeam } = useMobileAuthState();
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"open" | "done" | "all">("open");
  const [followUps, setFollowUps] = useState<PracticeSessionFollowUpRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const isCoach = appUser?.role === "coach";

  useEffect(() => {
    async function load() {
      if (!currentTeam?.id || !isCoach) {
        setFollowUps([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setFollowUps(await listPracticeSessionFollowUps(db, currentTeam.id));
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [currentTeam?.id, isCoach]);

  const filteredFollowUps = useMemo(
    () =>
      followUps.filter((followUp) =>
        statusFilter === "all" ? true : followUp.status === statusFilter
      ),
    [followUps, statusFilter]
  );

  async function toggleStatus(followUp: PracticeSessionFollowUpRecord) {
    const nextStatus = followUp.status === "done" ? "open" : "done";
    setActiveId(followUp.id);

    try {
      await updatePracticeSessionFollowUpStatus(db, {
        sessionId: followUp.sessionId,
        followUps: followUp.sourceFollowUps,
        followUpId: followUp.id,
        status: nextStatus,
      });

      setFollowUps((prev) =>
        prev.map((entry) =>
          entry.id === followUp.id && entry.sessionId === followUp.sessionId
            ? {
                ...entry,
                status: nextStatus,
                completedAt: nextStatus === "done" ? entry.completedAt || new Date().toISOString() : "",
                sourceFollowUps: entry.sourceFollowUps.map((source) =>
                  source.id === entry.id
                    ? {
                        ...source,
                        status: nextStatus,
                        completedAt:
                          nextStatus === "done"
                            ? source.completedAt || new Date().toISOString()
                            : "",
                      }
                    : source
                ),
              }
            : entry
        )
      );
    } finally {
      setActiveId(null);
    }
  }

  return (
    <MobileScreenShell
      title="Coach Follow-Ups"
      subtitle="Keep wrestler action items organized and close the loop quickly."
    >
      {!isCoach ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#21486e",
            borderRadius: 20,
            padding: 18,
            backgroundColor: "#0b2542",
          }}
        >
          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
            Coach access required
          </Text>
          <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
            Follow-up management stays coach-only so athlete and parent accounts never see internal tasks.
          </Text>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
            {[
              ["open", "Open"],
              ["done", "Done"],
              ["all", "All"],
            ].map(([value, label]) => {
              const active = statusFilter === value;

              return (
                <Pressable
                  key={value}
                  onPress={() => setStatusFilter(value as typeof statusFilter)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 999,
                    backgroundColor: active ? "#bf1029" : "#102f52",
                    borderWidth: 1,
                    borderColor: active ? "#fca5a5" : "#315c86",
                  }}
                >
                  <Text style={{ color: "#ffffff", fontWeight: "900" }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {loading ? (
            <Text style={{ color: "#b7c9df" }}>Loading follow-ups...</Text>
          ) : filteredFollowUps.length === 0 ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: "#21486e",
                borderRadius: 20,
                padding: 18,
                backgroundColor: "#0b2542",
              }}
            >
              <Text style={{ color: "#b7c9df", lineHeight: 22 }}>
                No follow-ups match this filter yet.
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 32 }}>
              {filteredFollowUps.map((followUp) => (
                <View
                  key={`${followUp.sessionId}:${followUp.id}`}
                  style={{
                    borderWidth: 1,
                    borderColor: "#21486e",
                    borderRadius: 20,
                    padding: 18,
                    backgroundColor: "#0b2542",
                    gap: 10,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <Text style={{ color: "#ffffff", fontSize: 18, fontWeight: "900", flex: 1 }}>
                      {followUp.title}
                    </Text>
                    <Text style={{ color: "#93c5fd", fontWeight: "800" }}>
                      {followUp.status === "done" ? "Done" : "Open"}
                    </Text>
                  </View>

                  <Text style={{ color: "#b7c9df", lineHeight: 21 }}>
                    {followUp.details || "No extra detail saved yet."}
                  </Text>

                  <Text style={{ color: "#b7c9df", fontSize: 13 }}>
                    {(followUp.wrestlerName || "Team-wide item") + " · " + followUp.category + " · Due " + formatDueDate(followUp.dueDate)}
                  </Text>

                  <Text style={{ color: "#93c5fd", fontSize: 13 }}>
                    {followUp.practicePlanTitle || "Practice closeout"}
                  </Text>

                  <Pressable
                    onPress={() => toggleStatus(followUp)}
                    disabled={activeId === followUp.id}
                    style={{
                      alignSelf: "flex-start",
                      marginTop: 4,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: 14,
                      backgroundColor: followUp.status === "done" ? "#12345a" : "#bf1029",
                    }}
                  >
                    <Text style={{ color: "#ffffff", fontWeight: "900" }}>
                      {activeId === followUp.id
                        ? "Saving..."
                        : followUp.status === "done"
                          ? "Reopen"
                          : "Mark Done"}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </>
      )}
    </MobileScreenShell>
  );
}
