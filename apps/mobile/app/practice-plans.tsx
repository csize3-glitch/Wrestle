import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { Alert, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { WebView } from "react-native-webview";
import { db } from "@wrestlewell/firebase/client";
import {
  getYouTubeEmbedUrl,
  getPracticePlanDetail,
  listWrestlers,
  listPracticePlans,
  type PracticePlanBlockRecord,
} from "@wrestlewell/lib/index";
import type { PracticePlan, WrestlerProfile } from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { ScreenShell } from "../components/screen-shell";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDurationLabel(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function openVideo(url?: string) {
  if (!url) {
    return;
  }

  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert("Video unavailable", "This video link could not be opened on your device.");
      return;
    }

    await Linking.openURL(url);
  } catch (error) {
    console.error("Failed to open practice video:", error);
    Alert.alert("Video unavailable", "There was a problem opening this video.");
  }
}

export default function PracticePlansScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } = useMobileAuthState();
  const params = useLocalSearchParams<{ planId?: string }>();
  const [plans, setPlans] = useState<PracticePlan[]>([]);
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<PracticePlanBlockRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [timerActive, setTimerActive] = useState(false);
  const [activeBlockIndex, setActiveBlockIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [countdownEnabled, setCountdownEnabled] = useState(true);
  const [inlineVideoUrl, setInlineVideoUrl] = useState<string | null>(null);
  const [inlineVideoTitle, setInlineVideoTitle] = useState<string>("");
  const announcedBlockRef = useRef<string | null>(null);
  const announcedCountdownRef = useRef<string | null>(null);

  const isCoach = appUser?.role === "coach";
  const ownWrestler =
    appUser?.role === "athlete" && firebaseUser
      ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) || null
      : null;

  async function refreshPlans() {
    if (!currentTeam?.id) {
      setPlans([]);
      setSelectedPlanId(null);
      setBlocks([]);
      return;
    }

    const rows = await listPracticePlans(
      db,
      currentTeam.id,
      appUser?.role === "athlete" ? ownWrestler?.id : undefined
    );
    setPlans(rows);

    if (!rows.length) {
      setSelectedPlanId(null);
      setBlocks([]);
      return;
    }

    setSelectedPlanId((prev) => {
      const requested = typeof params.planId === "string" ? params.planId : null;
      const preferred = requested ?? prev;
      return preferred && rows.some((row) => row.id === preferred) ? preferred : rows[0].id;
    });
  }

  async function loadPlan(planId: string) {
    if (!currentTeam?.id) {
      return;
    }

    try {
      setLoadingPlan(true);
      const detail = await getPracticePlanDetail(
        db,
        currentTeam.id,
        planId,
        appUser?.role === "athlete" ? ownWrestler?.id : undefined
      );
      setBlocks(detail?.blocks || []);
      setTimerActive(false);
      setActiveBlockIndex(0);
      setRemainingSeconds(detail?.blocks?.[0] ? detail.blocks[0].durationSeconds : 0);
    } finally {
      setLoadingPlan(false);
    }
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
        console.error("Failed to load wrestlers for practice plan assignments:", error);
      }
    }

    loadWrestlers();
  }, [currentTeam?.id]);

  useEffect(() => {
    async function load() {
      try {
        await refreshPlans();
      } catch (error) {
        console.error("Failed to load practice plans:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [appUser?.role, currentTeam?.id, ownWrestler?.id, params.planId]);

  useEffect(() => {
    if (!selectedPlanId) {
      setBlocks([]);
      return;
    }

    loadPlan(selectedPlanId).catch((error) => {
      console.error("Failed to load selected practice plan:", error);
    });
  }, [selectedPlanId]);

  useEffect(() => {
    if (!timerActive) {
      return;
    }

    const intervalId = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [timerActive]);

  useEffect(() => {
    if (!timerActive || remainingSeconds > 0) {
      return;
    }

    const nextIndex = activeBlockIndex + 1;
    if (nextIndex >= blocks.length) {
      setTimerActive(false);
      return;
    }

    setActiveBlockIndex(nextIndex);
    setRemainingSeconds(blocks[nextIndex].durationSeconds);
  }, [activeBlockIndex, blocks, remainingSeconds, timerActive]);

  useEffect(() => {
    if (!timerActive || !isCoach || !countdownEnabled || remainingSeconds <= 0 || remainingSeconds > 3) {
      if (remainingSeconds > 3 || remainingSeconds <= 0 || !timerActive) {
        announcedCountdownRef.current = null;
      }
      return;
    }

    const countdownKey = `${selectedPlanId || "none"}:${activeBlockIndex}:${remainingSeconds}`;
    if (announcedCountdownRef.current === countdownKey) {
      return;
    }

    announcedCountdownRef.current = countdownKey;

    if (voiceEnabled) {
      Speech.speak(String(remainingSeconds), {
        pitch: 1.1,
        rate: 0.92,
      });
    }

    if (hapticsEnabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    }
  }, [
    activeBlockIndex,
    countdownEnabled,
    hapticsEnabled,
    isCoach,
    remainingSeconds,
    selectedPlanId,
    timerActive,
    voiceEnabled,
  ]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) || null,
    [plans, selectedPlanId]
  );
  const activeBlock = blocks[activeBlockIndex] || null;
  const youtubeEmbedUrl = useMemo(
    () => (inlineVideoUrl ? getYouTubeEmbedUrl(inlineVideoUrl) : null),
    [inlineVideoUrl]
  );
  const directVideoUrl = inlineVideoUrl && !youtubeEmbedUrl ? inlineVideoUrl : null;
  const directVideoPlayer = useVideoPlayer(directVideoUrl, (player) => {
    player.pause();
  });

  useEffect(() => {
    if (!isCoach || !activeBlock) {
      announcedBlockRef.current = null;
      return;
    }

    const announcementKey = `${selectedPlanId || "none"}:${activeBlock.id}:${activeBlockIndex}`;
    if (announcedBlockRef.current === announcementKey) {
      return;
    }

    announcedBlockRef.current = announcementKey;

    if (hapticsEnabled) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    }

    if (voiceEnabled) {
      Speech.stop();
      Speech.speak(
        `Block ${activeBlockIndex + 1}. ${activeBlock.title || "Untitled block"}. ${Math.floor(activeBlock.durationSeconds / 60)} minutes and ${activeBlock.durationSeconds % 60} seconds.`
      );
    }
  }, [activeBlock, activeBlockIndex, hapticsEnabled, isCoach, selectedPlanId, voiceEnabled]);

  useEffect(() => {
    async function runEndSignal() {
      if (!isCoach || !timerActive || remainingSeconds !== 0) {
        return;
      }

      if (hapticsEnabled) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
        wait(180)
          .then(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy))
          .catch(() => undefined);
        wait(360)
          .then(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy))
          .catch(() => undefined);
      }

      if (voiceEnabled) {
        Speech.stop();
        Speech.speak(activeBlockIndex + 1 >= blocks.length ? "Practice complete." : "Switch blocks now.", {
          pitch: 1,
          rate: 0.95,
        });
      }
    }

    runEndSignal().catch(() => undefined);
  }, [
    activeBlockIndex,
    blocks.length,
    hapticsEnabled,
    isCoach,
    remainingSeconds,
    timerActive,
    voiceEnabled,
  ]);

  function jumpToBlock(index: number) {
    const nextBlock = blocks[index];
    if (!nextBlock) {
      return;
    }

    setTimerActive(false);
    setActiveBlockIndex(index);
    setRemainingSeconds(nextBlock.durationSeconds);
  }

  function openInlineVideo(url?: string, title?: string) {
    if (!url) {
      return;
    }

    setInlineVideoUrl(url);
    setInlineVideoTitle(title || "Technique Video");
  }

  function closeInlineVideo() {
    setInlineVideoUrl(null);
    setInlineVideoTitle("");
    directVideoPlayer.pause();
  }

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
            Sign in on mobile to review team practice plans and run the session timer.
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
      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        visible={Boolean(inlineVideoUrl)}
        onRequestClose={closeInlineVideo}
      >
        <View style={styles.videoModal}>
          <View style={styles.videoModalHeader}>
            <Text style={styles.videoModalTitle}>{inlineVideoTitle || "Technique Video"}</Text>
            <Pressable onPress={closeInlineVideo} style={styles.videoModalClose}>
              <Text style={styles.videoModalCloseText}>Done</Text>
            </Pressable>
          </View>

          {youtubeEmbedUrl ? (
            <WebView
              source={{
                html: `
                  <!DOCTYPE html>
                  <html>
                    <head>
                      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
                      <style>
                        html, body {
                          margin: 0;
                          padding: 0;
                          background: #091729;
                          height: 100%;
                          overflow: hidden;
                        }
                        .frame {
                          position: absolute;
                          inset: 0;
                          width: 100%;
                          height: 100%;
                          border: 0;
                        }
                      </style>
                    </head>
                    <body>
                      <iframe
                        class="frame"
                        src="${youtubeEmbedUrl}?playsinline=1&rel=0"
                        title="Technique Video"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowfullscreen
                      ></iframe>
                    </body>
                  </html>
                `,
              }}
              originWhitelist={["*"]}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              style={styles.videoFrame}
            />
          ) : directVideoUrl ? (
            <VideoView
              player={directVideoPlayer}
              style={styles.videoFrame}
              nativeControls
              allowsFullscreen
              contentFit="contain"
            />
          ) : (
            <View style={[styles.videoFrame, styles.videoFallback]}>
              <Text style={{ color: "#fff", fontSize: 16 }}>
                This video could not be loaded inline on your phone.
              </Text>
            </View>
          )}

          {inlineVideoUrl ? (
            <Pressable
              onPress={() => openVideo(inlineVideoUrl)}
              style={styles.videoExternalButton}
            >
              <Text style={styles.videoExternalButtonText}>Open Externally</Text>
            </Pressable>
          ) : null}
        </View>
      </Modal>

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

      <Text style={{ fontSize: 28, fontWeight: "700", marginBottom: 12 }}>Practice Plans</Text>
      <Text style={{ fontSize: 16, color: "#555", marginBottom: 20 }}>
        {isCoach
          ? "Open team practice plans and run a live timer block by block on deck."
          : "Review your assigned practice plans and follow the session flow from your phone."}
      </Text>

      <Pressable
        onPress={() => {
          setLoading(true);
          refreshPlans().finally(() => setLoading(false));
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

      {!isCoach ? (
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
            Practice plans are read-only for athletes. Coaches can run the live timer during practice.
          </Text>
        </View>
      ) : null}

      {loading ? <Text>Loading practice plans...</Text> : null}

      {!loading && plans.length === 0 ? (
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
            {appUser?.role === "coach"
              ? "No practice plans found yet. Build them on the website and they will appear here."
              : "No practice plans are assigned to you yet. Your coach can assign individual plans or keep them team-wide."}
          </Text>
        </View>
      ) : null}

      {plans.length > 0 ? (
        <View style={{ gap: 14 }}>
          <View
            style={{
              borderWidth: 1,
              borderColor: "#ddd",
              borderRadius: 16,
              padding: 16,
              backgroundColor: "#fff",
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 12 }}>Saved Plans</Text>
            <View style={{ gap: 10 }}>
              {plans.map((plan) => {
                const isActive = plan.id === selectedPlanId;
                return (
                  <Pressable
                    key={plan.id}
                    onPress={() => setSelectedPlanId(plan.id)}
                    style={{
                      borderWidth: 1,
                      borderColor: isActive ? "#111827" : "#e5e7eb",
                      borderRadius: 12,
                      padding: 12,
                      backgroundColor: isActive ? "#f3f4f6" : "#fff",
                    }}
                  >
                    <Text style={{ fontSize: 16, fontWeight: "700" }}>{plan.title || "Untitled Plan"}</Text>
                    <Text style={{ fontSize: 14, color: "#555", marginTop: 4 }}>
                      {plan.style || "Mixed"} • {formatDurationLabel(plan.totalSeconds || plan.totalMinutes * 60 || 0)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {selectedPlan ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 16,
                padding: 16,
                backgroundColor: "#fff",
              }}
            >
              <Text style={{ fontSize: 22, fontWeight: "700" }}>{selectedPlan.title}</Text>
              <Text style={{ fontSize: 15, color: "#555", marginTop: 8, lineHeight: 22 }}>
                {selectedPlan.style || "Mixed"} • {formatDurationLabel(selectedPlan.totalSeconds || selectedPlan.totalMinutes * 60 || 0)} • {blocks.length} blocks
              </Text>

              {isCoach && activeBlock ? (
                <View
                  style={{
                    marginTop: 16,
                    padding: 16,
                    borderRadius: 16,
                    backgroundColor: "#0f2748",
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "800", color: "rgba(255,255,255,0.7)" }}>
                    LIVE TIMER
                  </Text>
                  <Text style={{ fontSize: 28, fontWeight: "800", color: "#fff", marginTop: 8 }}>
                    {formatClock(remainingSeconds)}
                  </Text>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: "#fff", marginTop: 8 }}>
                    Block {activeBlockIndex + 1}: {activeBlock.title}
                  </Text>
                  <Text style={{ fontSize: 14, color: "rgba(255,255,255,0.76)", marginTop: 4 }}>
                    {formatDurationLabel(activeBlock.durationSeconds)} • {activeBlock.blockType === "text" ? "Text block" : "Library block"}
                  </Text>

                  {activeBlock.videoUrl ? (
                    <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                      <Pressable
                        onPress={() => openInlineVideo(activeBlock.videoUrl, activeBlock.title)}
                        style={{
                          alignSelf: "flex-start",
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 999,
                          backgroundColor: "rgba(255,255,255,0.16)",
                        }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "700" }}>Watch Video</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => openVideo(activeBlock.videoUrl)}
                        style={{
                          alignSelf: "flex-start",
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 999,
                          backgroundColor: "rgba(255,255,255,0.1)",
                          borderWidth: 1,
                          borderColor: "rgba(255,255,255,0.12)",
                        }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "700" }}>Open Externally</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                    <Pressable
                      onPress={() => setVoiceEnabled((prev) => !prev)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: 999,
                        backgroundColor: voiceEnabled ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "700" }}>
                        Voice {voiceEnabled ? "On" : "Off"}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => setHapticsEnabled((prev) => !prev)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: 999,
                        backgroundColor: hapticsEnabled ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "700" }}>
                        Vibration {hapticsEnabled ? "On" : "Off"}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => setCountdownEnabled((prev) => !prev)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: 999,
                        backgroundColor: countdownEnabled ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "700" }}>
                        Countdown {countdownEnabled ? "On" : "Off"}
                      </Text>
                    </Pressable>
                  </View>

                  <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", marginTop: 12, lineHeight: 20 }}>
                    Final 3 seconds announce out loud and trigger a stronger alert when it is time to switch.
                  </Text>

                  <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                    <Pressable
                      onPress={() => setTimerActive((prev) => !prev)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: 999,
                        backgroundColor: "#bf1029",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "700" }}>
                        {timerActive ? "Pause" : "Start"}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        setTimerActive(false);
                        setRemainingSeconds(activeBlock.durationSeconds);
                      }}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: 999,
                        backgroundColor: "#ffffff",
                      }}
                    >
                      <Text style={{ color: "#0f2748", fontWeight: "700" }}>Reset</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => jumpToBlock(Math.max(0, activeBlockIndex - 1))}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: 999,
                        backgroundColor: "rgba(255,255,255,0.16)",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "700" }}>Previous</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => jumpToBlock(Math.min(blocks.length - 1, activeBlockIndex + 1))}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: 999,
                        backgroundColor: "rgba(255,255,255,0.16)",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "700" }}>Next</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <View style={{ gap: 12, marginTop: 18 }}>
                {loadingPlan ? (
                  <Text>Loading plan details...</Text>
                ) : blocks.length === 0 ? (
                  <Text style={{ color: "#555" }}>No blocks saved on this practice plan yet.</Text>
                ) : (
                  blocks.map((block, index) => (
                    <View
                      key={block.id}
                      style={{
                        borderWidth: 1,
                        borderColor: index === activeBlockIndex && isCoach ? "#bf1029" : "#e5e7eb",
                        borderRadius: 14,
                        padding: 14,
                        backgroundColor: index === activeBlockIndex && isCoach ? "#fff5f6" : "#fafafa",
                      }}
                    >
                      <Text style={{ fontSize: 16, fontWeight: "700" }}>
                        {index + 1}. {block.title || "Untitled Block"}
                      </Text>
                      <Text style={{ fontSize: 14, color: "#555", marginTop: 6 }}>
                        {formatDurationLabel(block.durationSeconds)}
                        {block.style ? ` • ${block.style}` : ""}
                        {block.category ? ` • ${block.category}` : ""}
                      </Text>
                      {block.notes ? (
                        <Text style={{ fontSize: 14, color: "#374151", lineHeight: 21, marginTop: 8 }}>
                          {block.notes}
                        </Text>
                      ) : null}
                      {block.videoUrl ? (
                        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                          <Pressable
                            onPress={() => openInlineVideo(block.videoUrl, block.title)}
                            style={{
                              alignSelf: "flex-start",
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: 999,
                              backgroundColor: "#0f2748",
                            }}
                          >
                            <Text style={{ color: "#fff", fontWeight: "700" }}>Watch Video</Text>
                          </Pressable>

                          <Pressable
                            onPress={() => openVideo(block.videoUrl)}
                            style={{
                              alignSelf: "flex-start",
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: 999,
                              backgroundColor: "#e5e7eb",
                            }}
                          >
                            <Text style={{ color: "#111827", fontWeight: "700" }}>Open Externally</Text>
                          </Pressable>
                        </View>
                      ) : null}
                      {isCoach ? (
                        <Pressable
                          onPress={() => jumpToBlock(index)}
                          style={{
                            marginTop: 10,
                            alignSelf: "flex-start",
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderRadius: 999,
                            backgroundColor: "#e5e7eb",
                          }}
                        >
                          <Text style={{ color: "#111827", fontWeight: "700" }}>Set Active</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))
                )}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  videoModal: {
    flex: 1,
    backgroundColor: "#091729",
    paddingTop: 56,
  },
  videoModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 12,
  },
  videoModalTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
  },
  videoModalClose: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  videoModalCloseText: {
    color: "#fff",
    fontWeight: "700",
  },
  videoFrame: {
    flex: 1,
    backgroundColor: "#000",
  },
  videoFallback: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  videoExternalButton: {
    alignSelf: "center",
    marginVertical: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#bf1029",
  },
  videoExternalButtonText: {
    color: "#fff",
    fontWeight: "800",
  },
});
