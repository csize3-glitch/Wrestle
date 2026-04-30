import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import * as ScreenOrientation from "expo-screen-orientation";
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
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
import { MobileScreenShell } from "../components/mobile-screen-shell";

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
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getBlockDisplayTitle(block: PracticePlanBlockRecord | null, index?: number) {
  if (!block) return "No active block";

  const title = typeof block.title === "string" ? block.title.trim() : "";
  const notes = typeof block.notes === "string" ? block.notes.trim() : "";
  const category = typeof block.category === "string" ? block.category.trim() : "";
  const style = typeof block.style === "string" ? block.style.trim() : "";

  if (title && title.toLowerCase() !== "custom block") return title;
  if (notes) return notes.split("\n")[0].slice(0, 64);
  if (category) return category;
  if (style) return `${style} block`;

  return typeof index === "number" ? `Block ${index + 1}` : "Untitled Block";
}

function isLandscapeOrientation(orientation: ScreenOrientation.Orientation) {
  return (
    orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
    orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT
  );
}

async function openVideo(url?: string) {
  if (!url) return;

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
  const { width, height } = useWindowDimensions();

  const [plans, setPlans] = useState<PracticePlan[]>([]);
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<PracticePlanBlockRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPlan, setLoadingPlan] = useState(false);

  const [timerActive, setTimerActive] = useState(false);
  const [timerFullscreen, setTimerFullscreen] = useState(false);
  const [activeBlockIndex, setActiveBlockIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [countdownEnabled, setCountdownEnabled] = useState(true);

  const [inlineVideoUrl, setInlineVideoUrl] = useState<string | null>(null);
  const [inlineVideoTitle, setInlineVideoTitle] = useState("");
  const [orientationLandscape, setOrientationLandscape] = useState(false);

  const announcedBlockRef = useRef<string | null>(null);
  const announcedCountdownRef = useRef<string | null>(null);

  const isCoach = appUser?.role === "coach";
  const isLandscape = timerFullscreen && (orientationLandscape || width > height);

  const ownWrestler =
    appUser?.role === "athlete" && firebaseUser
      ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser.uid) || null
      : null;

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) || null,
    [plans, selectedPlanId]
  );

  const activeBlock = blocks[activeBlockIndex] || null;
  const activeBlockTitle = getBlockDisplayTitle(activeBlock, activeBlockIndex);
  const nextBlock = blocks[activeBlockIndex + 1] || null;
  const nextBlockTitle = getBlockDisplayTitle(nextBlock, activeBlockIndex + 1);

  const youtubeEmbedUrl = useMemo(
    () => (inlineVideoUrl ? getYouTubeEmbedUrl(inlineVideoUrl) : null),
    [inlineVideoUrl]
  );

  const directVideoUrl = inlineVideoUrl && !youtubeEmbedUrl ? inlineVideoUrl : null;

  const directVideoPlayer = useVideoPlayer(directVideoUrl, (player) => {
    player.pause();
  });

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
    if (!currentTeam?.id) return;

    try {
      setLoadingPlan(true);

      const detail = await getPracticePlanDetail(
        db,
        currentTeam.id,
        planId,
        appUser?.role === "athlete" ? ownWrestler?.id : undefined
      );

      const nextBlocks = detail?.blocks || [];

      setBlocks(nextBlocks);
      setTimerActive(false);
      setTimerFullscreen(false);
      setOrientationLandscape(false);
      setActiveBlockIndex(0);
      setRemainingSeconds(nextBlocks[0] ? nextBlocks[0].durationSeconds : 0);
      announcedBlockRef.current = null;
      announcedCountdownRef.current = null;

      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT);
      } catch (error) {
        console.warn("Could not reset practice timer orientation after plan load:", error);
      }
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
  }, [appUser?.role, currentTeam?.id, ownWrestler?.id, params.planId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedPlanId) {
      setBlocks([]);
      return;
    }

    loadPlan(selectedPlanId).catch((error) => {
      console.error("Failed to load selected practice plan:", error);
    });
  }, [selectedPlanId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let mounted = true;

    async function syncOrientation() {
      try {
        const orientation = await ScreenOrientation.getOrientationAsync();

        if (!mounted) return;
        setOrientationLandscape(isLandscapeOrientation(orientation));
      } catch {
        if (!mounted) return;
        setOrientationLandscape(false);
      }
    }

    syncOrientation();

    const subscription = ScreenOrientation.addOrientationChangeListener((event) => {
      setOrientationLandscape(isLandscapeOrientation(event.orientationInfo.orientation));
    });

    return () => {
      mounted = false;
      ScreenOrientation.removeOrientationChangeListener(subscription);
    };
  }, []);

  useEffect(() => {
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!timerActive) return;

    const intervalId = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [timerActive]);

  useEffect(() => {
    if (!timerActive || remainingSeconds > 0) return;

    const nextIndex = activeBlockIndex + 1;

    if (nextIndex >= blocks.length) {
      setTimerActive(false);

      if (voiceEnabled && isCoach) {
        Speech.stop();
        Speech.speak("Practice complete.", { pitch: 1, rate: 0.95 });
      }

      if (hapticsEnabled && isCoach) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      }

      return;
    }

    setActiveBlockIndex(nextIndex);
    setRemainingSeconds(blocks[nextIndex].durationSeconds);
  }, [
    activeBlockIndex,
    blocks,
    hapticsEnabled,
    isCoach,
    remainingSeconds,
    timerActive,
    voiceEnabled,
  ]);

  useEffect(() => {
    if (!timerActive || !isCoach || !countdownEnabled || remainingSeconds <= 0 || remainingSeconds > 3) {
      if (remainingSeconds > 3 || remainingSeconds <= 0 || !timerActive) {
        announcedCountdownRef.current = null;
      }
      return;
    }

    const countdownKey = `${selectedPlanId || "none"}:${activeBlockIndex}:${remainingSeconds}`;
    if (announcedCountdownRef.current === countdownKey) return;

    announcedCountdownRef.current = countdownKey;

    if (voiceEnabled) {
      Speech.speak(String(remainingSeconds), {
        pitch: 1.1,
        rate: 0.9,
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

  useEffect(() => {
    if (!isCoach || !activeBlock) {
      announcedBlockRef.current = null;
      return;
    }

    const announcementKey = `${selectedPlanId || "none"}:${activeBlock.id}:${activeBlockIndex}`;
    if (announcedBlockRef.current === announcementKey) return;

    announcedBlockRef.current = announcementKey;
    const title = getBlockDisplayTitle(activeBlock, activeBlockIndex);

    if (hapticsEnabled) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    }

    if (voiceEnabled) {
      Speech.stop();
      Speech.speak(
        `Block ${activeBlockIndex + 1}. ${title}. ${Math.floor(
          activeBlock.durationSeconds / 60
        )} minutes and ${activeBlock.durationSeconds % 60} seconds.`,
        {
          pitch: 1,
          rate: 0.92,
        }
      );
    }
  }, [activeBlock, activeBlockIndex, hapticsEnabled, isCoach, selectedPlanId, voiceEnabled]);

  useEffect(() => {
    async function runEndSignal() {
      if (!isCoach || !timerActive || remainingSeconds !== 0) return;

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
    const nextSelectedBlock = blocks[index];
    if (!nextSelectedBlock) return;

    setTimerActive(false);
    setActiveBlockIndex(index);
    setRemainingSeconds(nextSelectedBlock.durationSeconds);
    announcedBlockRef.current = null;
    announcedCountdownRef.current = null;
  }

  function restartCurrentBlock() {
    if (!activeBlock) return;

    setTimerActive(false);
    setRemainingSeconds(activeBlock.durationSeconds);
    announcedCountdownRef.current = null;
  }

  async function startLiveTimer() {
    if (!activeBlock) {
      Alert.alert("No blocks", "This practice plan does not have blocks to run yet.");
      return;
    }

    setTimerFullscreen(true);
    setTimerActive(true);
    setOrientationLandscape(true);

    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
    } catch (error) {
      console.warn("Could not lock practice timer to landscape:", error);
    }
  }

  async function closeLiveTimer() {
    setTimerFullscreen(false);
    setOrientationLandscape(false);

    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT);
    } catch (error) {
      console.warn("Could not unlock practice timer orientation:", error);
    }
  }

  function startOrPauseTimer() {
    if (!timerActive) {
      startLiveTimer();
      return;
    }

    setTimerActive(false);
  }

  function openInlineVideo(url?: string, title?: string) {
    if (!url) return;

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
      <MobileScreenShell
        title="Practice Plans"
        subtitle="Sign in to review team practice plans and run the session timer."
      >
        <View style={styles.authCard}>
          <Text style={styles.authTitle}>Sign in required</Text>

          <Text style={styles.authCopy}>
            Sign in on mobile to review team practice plans and run the session timer.
          </Text>

          <Pressable onPress={() => router.push("/")} style={styles.redPill}>
            <Text style={styles.redPillText}>Go Home</Text>
          </Pressable>
        </View>
      </MobileScreenShell>
    );
  }

  return (
    <MobileScreenShell
      title="Practice Plans"
      subtitle={
        isCoach
          ? "Open team plans, run a live timer, and keep the room moving block by block."
          : "Review assigned plans and follow the session flow from your phone."
      }
    >
      <Modal
        animationType="slide"
        presentationStyle="fullScreen"
        visible={timerFullscreen}
        onRequestClose={closeLiveTimer}
        supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}
      >
        <View style={[styles.timerModal, isLandscape ? styles.timerModalLandscape : null]}>
          <View style={styles.timerTopBar}>
            <Pressable onPress={closeLiveTimer} style={styles.timerTopButton}>
              <Text style={styles.timerTopButtonText}>Back</Text>
            </Pressable>

            <Text style={styles.timerTopTitle} numberOfLines={1}>
              {selectedPlan?.title || "Live Practice"}
            </Text>

            <Pressable onPress={restartCurrentBlock} style={styles.timerTopButton}>
              <Text style={styles.timerTopButtonText}>Restart</Text>
            </Pressable>
          </View>

          {isLandscape ? (
            <LandscapeTimer
              activeBlock={activeBlock}
              activeBlockIndex={activeBlockIndex}
              activeBlockTitle={activeBlockTitle}
              blocksLength={blocks.length}
              remainingSeconds={remainingSeconds}
              nextBlock={nextBlock}
              nextBlockTitle={nextBlockTitle}
              timerActive={timerActive}
              voiceEnabled={voiceEnabled}
              hapticsEnabled={hapticsEnabled}
              countdownEnabled={countdownEnabled}
              onToggleTimer={() => setTimerActive((prev) => !prev)}
              onPrevious={() => jumpToBlock(Math.max(0, activeBlockIndex - 1))}
              onRestart={restartCurrentBlock}
              onNext={() => jumpToBlock(Math.min(blocks.length - 1, activeBlockIndex + 1))}
              onToggleVoice={() => setVoiceEnabled((prev) => !prev)}
              onToggleHaptics={() => setHapticsEnabled((prev) => !prev)}
              onToggleCountdown={() => setCountdownEnabled((prev) => !prev)}
              onWatchVideo={() => openInlineVideo(activeBlock?.videoUrl, activeBlockTitle)}
              onOpenVideo={() => openVideo(activeBlock?.videoUrl)}
            />
          ) : (
            <PortraitTimer
              activeBlock={activeBlock}
              activeBlockIndex={activeBlockIndex}
              activeBlockTitle={activeBlockTitle}
              blocksLength={blocks.length}
              remainingSeconds={remainingSeconds}
              nextBlock={nextBlock}
              nextBlockTitle={nextBlockTitle}
              timerActive={timerActive}
              voiceEnabled={voiceEnabled}
              hapticsEnabled={hapticsEnabled}
              countdownEnabled={countdownEnabled}
              onToggleTimer={() => setTimerActive((prev) => !prev)}
              onPrevious={() => jumpToBlock(Math.max(0, activeBlockIndex - 1))}
              onRestart={restartCurrentBlock}
              onNext={() => jumpToBlock(Math.min(blocks.length - 1, activeBlockIndex + 1))}
              onToggleVoice={() => setVoiceEnabled((prev) => !prev)}
              onToggleHaptics={() => setHapticsEnabled((prev) => !prev)}
              onToggleCountdown={() => setCountdownEnabled((prev) => !prev)}
              onWatchVideo={() => openInlineVideo(activeBlock?.videoUrl, activeBlockTitle)}
              onOpenVideo={() => openVideo(activeBlock?.videoUrl)}
            />
          )}
        </View>
      </Modal>

      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        visible={Boolean(inlineVideoUrl)}
        onRequestClose={closeInlineVideo}
        supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}
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
            <Pressable onPress={() => openVideo(inlineVideoUrl)} style={styles.videoExternalButton}>
              <Text style={styles.videoExternalButtonText}>Open Externally</Text>
            </Pressable>
          ) : null}
        </View>
      </Modal>

      <Pressable
        onPress={() => {
          setLoading(true);
          refreshPlans().finally(() => setLoading(false));
        }}
        style={styles.refreshButton}
      >
        <Text style={styles.refreshButtonText}>{loading ? "Refreshing..." : "Refresh"}</Text>
      </Pressable>

      {!isCoach ? (
        <View style={styles.infoCard}>
          <Text style={styles.infoCopy}>
            Practice plans are read-only for athletes. Coaches can run the live timer during practice.
          </Text>
        </View>
      ) : null}

      {loading ? <Text style={styles.loadingText}>Loading practice plans...</Text> : null}

      {!loading && plans.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyCopy}>
            {appUser?.role === "coach"
              ? "No practice plans found yet. Build them on the website and they will appear here."
              : "No practice plans are assigned to you yet. Your coach can assign individual plans or keep them team-wide."}
          </Text>
        </View>
      ) : null}

      {plans.length > 0 ? (
        <View style={{ gap: 14 }}>
          <View style={styles.panelCard}>
            <Text style={styles.panelTitle}>Saved Plans</Text>

            <View style={{ gap: 10 }}>
              {plans.map((plan) => {
                const isActive = plan.id === selectedPlanId;

                return (
                  <Pressable
                    key={plan.id}
                    onPress={() => setSelectedPlanId(plan.id)}
                    style={[styles.planCard, isActive ? styles.planCardActive : null]}
                  >
                    <Text style={styles.planTitle}>{plan.title || "Untitled Plan"}</Text>

                    <Text style={styles.planMeta}>
                      {plan.style || "Mixed"} •{" "}
                      {formatDurationLabel(plan.totalSeconds || plan.totalMinutes * 60 || 0)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {selectedPlan ? (
            <View style={styles.panelCard}>
              <Text style={styles.detailTitle}>{selectedPlan.title}</Text>

              <Text style={styles.detailMeta}>
                {selectedPlan.style || "Mixed"} •{" "}
                {formatDurationLabel(selectedPlan.totalSeconds || selectedPlan.totalMinutes * 60 || 0)} •{" "}
                {blocks.length} blocks
              </Text>

              {isCoach && activeBlock ? (
                <View style={styles.liveTimerPreview}>
                  <Text style={styles.livePreviewEyebrow}>LIVE PRACTICE TIMER</Text>

                  <Text style={styles.livePreviewClock}>{formatClock(remainingSeconds)}</Text>

                  <Text style={styles.livePreviewTitle}>
                    Block {activeBlockIndex + 1}: {activeBlockTitle}
                  </Text>

                  <Text style={styles.livePreviewMeta}>
                    {formatDurationLabel(activeBlock.durationSeconds)} •{" "}
                    {activeBlock.blockType === "text" ? "Text block" : "Library block"}
                  </Text>

                  {nextBlock ? (
                    <View style={styles.previewNextCard}>
                      <Text style={styles.nextBlockLabel}>NEXT BLOCK</Text>
                      <Text style={styles.nextBlockTitle}>{nextBlockTitle}</Text>
                    </View>
                  ) : null}

                  {activeBlock.videoUrl ? (
                    <View style={styles.previewVideoRow}>
                      <PillButton
                        label="Watch Video"
                        onPress={() => openInlineVideo(activeBlock.videoUrl, activeBlockTitle)}
                      />
                      <PillButton
                        label="Open Link"
                        onPress={() => openVideo(activeBlock.videoUrl)}
                        variant="blue"
                      />
                    </View>
                  ) : null}

                  <Pressable
                    onPress={startOrPauseTimer}
                    style={({ pressed }) => [
                      styles.startFullButton,
                      { backgroundColor: pressed ? "#991b1b" : "#bf1029" },
                    ]}
                  >
                    <Text style={styles.startFullButtonText}>
                      {timerActive ? "PAUSE TIMER" : "START FULL-SCREEN TIMER"}
                    </Text>
                  </Pressable>

                  <View style={styles.previewControlRow}>
                    <PillButton label="Restart" variant="white" onPress={restartCurrentBlock} />
                    <PillButton
                      label="Previous"
                      variant="blue"
                      onPress={() => jumpToBlock(Math.max(0, activeBlockIndex - 1))}
                    />
                    <PillButton
                      label="Next"
                      variant="blue"
                      onPress={() => jumpToBlock(Math.min(blocks.length - 1, activeBlockIndex + 1))}
                    />
                  </View>

                  <View style={styles.previewControlRow}>
                    <TogglePill
                      label={`Voice ${voiceEnabled ? "On" : "Off"}`}
                      active={voiceEnabled}
                      onPress={() => setVoiceEnabled((prev) => !prev)}
                    />
                    <TogglePill
                      label={`Vibration ${hapticsEnabled ? "On" : "Off"}`}
                      active={hapticsEnabled}
                      onPress={() => setHapticsEnabled((prev) => !prev)}
                    />
                    <TogglePill
                      label={`3-Count ${countdownEnabled ? "On" : "Off"}`}
                      active={countdownEnabled}
                      onPress={() => setCountdownEnabled((prev) => !prev)}
                    />
                  </View>

                  <Text style={styles.previewHelp}>
                    Start opens the full-screen timer and forces landscape for the coach-room layout.
                  </Text>
                </View>
              ) : null}

              <View style={{ gap: 12, marginTop: 18 }}>
                {loadingPlan ? (
                  <Text style={styles.loadingText}>Loading plan details...</Text>
                ) : blocks.length === 0 ? (
                  <Text style={styles.loadingText}>No blocks saved on this practice plan yet.</Text>
                ) : (
                  blocks.map((block, index) => {
                    const blockTitle = getBlockDisplayTitle(block, index);

                    return (
                      <View
                        key={block.id}
                        style={[
                          styles.blockCard,
                          index === activeBlockIndex && isCoach ? styles.blockCardActive : null,
                        ]}
                      >
                        <Text style={styles.blockTitle}>
                          {index + 1}. {blockTitle}
                        </Text>

                        <Text style={styles.blockMeta}>
                          {formatDurationLabel(block.durationSeconds)}
                          {block.style ? ` • ${block.style}` : ""}
                          {block.category ? ` • ${block.category}` : ""}
                        </Text>

                        {block.notes ? <Text style={styles.blockNotes}>{block.notes}</Text> : null}

                        {block.videoUrl ? (
                          <View style={styles.blockVideoRow}>
                            <PillButton
                              label="Watch Video"
                              onPress={() => openInlineVideo(block.videoUrl, blockTitle)}
                            />
                            <PillButton
                              label="Open Externally"
                              onPress={() => openVideo(block.videoUrl)}
                              variant="white"
                            />
                          </View>
                        ) : null}

                        {isCoach ? (
                          <Pressable onPress={() => jumpToBlock(index)} style={styles.setActiveButton}>
                            <Text style={styles.setActiveText}>Set Active</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })
                )}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </MobileScreenShell>
  );
}

function PortraitTimer({
  activeBlock,
  activeBlockIndex,
  activeBlockTitle,
  blocksLength,
  remainingSeconds,
  nextBlock,
  nextBlockTitle,
  timerActive,
  voiceEnabled,
  hapticsEnabled,
  countdownEnabled,
  onToggleTimer,
  onPrevious,
  onRestart,
  onNext,
  onToggleVoice,
  onToggleHaptics,
  onToggleCountdown,
  onWatchVideo,
  onOpenVideo,
}: {
  activeBlock: PracticePlanBlockRecord | null;
  activeBlockIndex: number;
  activeBlockTitle: string;
  blocksLength: number;
  remainingSeconds: number;
  nextBlock: PracticePlanBlockRecord | null;
  nextBlockTitle: string;
  timerActive: boolean;
  voiceEnabled: boolean;
  hapticsEnabled: boolean;
  countdownEnabled: boolean;
  onToggleTimer: () => void;
  onPrevious: () => void;
  onRestart: () => void;
  onNext: () => void;
  onToggleVoice: () => void;
  onToggleHaptics: () => void;
  onToggleCountdown: () => void;
  onWatchVideo: () => void;
  onOpenVideo: () => void;
}) {
  return (
    <>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.timerScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.timerEyebrow}>
          BLOCK {activeBlockIndex + 1} OF {Math.max(blocksLength, 1)}
        </Text>

        <Text style={styles.timerClock}>{formatClock(remainingSeconds)}</Text>

        <Text style={styles.timerBlockTitle} numberOfLines={3}>
          {activeBlockTitle}
        </Text>

        <Text style={styles.timerMeta}>
          {activeBlock
            ? `${formatDurationLabel(activeBlock.durationSeconds)} • ${
                activeBlock.blockType === "text" ? "Text block" : "Library block"
              }`
            : "No active block"}
        </Text>

        {activeBlock?.videoUrl ? (
          <View style={styles.timerVideoRow}>
            <Pressable onPress={onWatchVideo} style={styles.timerVideoButton}>
              <Text style={styles.timerVideoButtonText}>Watch Video</Text>
            </Pressable>

            <Pressable onPress={onOpenVideo} style={styles.timerVideoSecondaryButton}>
              <Text style={styles.timerVideoSecondaryButtonText}>Open Link</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.nextBlockCard}>
          <Text style={styles.nextBlockLabel}>{nextBlock ? "NEXT BLOCK" : "FINISH"}</Text>
          <Text style={styles.nextBlockTitle} numberOfLines={2}>
            {nextBlock ? nextBlockTitle : "End of practice"}
          </Text>
        </View>
      </ScrollView>

      <TimerControls
        timerActive={timerActive}
        voiceEnabled={voiceEnabled}
        hapticsEnabled={hapticsEnabled}
        countdownEnabled={countdownEnabled}
        onToggleTimer={onToggleTimer}
        onPrevious={onPrevious}
        onRestart={onRestart}
        onNext={onNext}
        onToggleVoice={onToggleVoice}
        onToggleHaptics={onToggleHaptics}
        onToggleCountdown={onToggleCountdown}
      />
    </>
  );
}

function LandscapeTimer({
  activeBlock,
  activeBlockIndex,
  activeBlockTitle,
  blocksLength,
  remainingSeconds,
  nextBlock,
  nextBlockTitle,
  timerActive,
  voiceEnabled,
  hapticsEnabled,
  countdownEnabled,
  onToggleTimer,
  onPrevious,
  onRestart,
  onNext,
  onToggleVoice,
  onToggleHaptics,
  onToggleCountdown,
  onWatchVideo,
  onOpenVideo,
}: {
  activeBlock: PracticePlanBlockRecord | null;
  activeBlockIndex: number;
  activeBlockTitle: string;
  blocksLength: number;
  remainingSeconds: number;
  nextBlock: PracticePlanBlockRecord | null;
  nextBlockTitle: string;
  timerActive: boolean;
  voiceEnabled: boolean;
  hapticsEnabled: boolean;
  countdownEnabled: boolean;
  onToggleTimer: () => void;
  onPrevious: () => void;
  onRestart: () => void;
  onNext: () => void;
  onToggleVoice: () => void;
  onToggleHaptics: () => void;
  onToggleCountdown: () => void;
  onWatchVideo: () => void;
  onOpenVideo: () => void;
}) {
  return (
    <View style={styles.landscapeBody}>
      <View style={styles.landscapeTimerPanel}>
        <Text style={styles.timerEyebrow}>
          BLOCK {activeBlockIndex + 1} OF {Math.max(blocksLength, 1)}
        </Text>

        <Text style={styles.landscapeClock}>{formatClock(remainingSeconds)}</Text>

        <Text style={styles.landscapeBlockTitle} numberOfLines={3}>
          {activeBlockTitle}
        </Text>

        <Text style={styles.timerMeta}>
          {activeBlock
            ? `${formatDurationLabel(activeBlock.durationSeconds)} • ${
                activeBlock.blockType === "text" ? "Text block" : "Library block"
              }`
            : "No active block"}
        </Text>
      </View>

      <View style={styles.landscapeSidePanel}>
        {activeBlock?.videoUrl ? (
          <View style={styles.landscapeCard}>
            <Text style={styles.nextBlockLabel}>VIDEO</Text>
            <View style={styles.timerVideoRow}>
              <Pressable onPress={onWatchVideo} style={styles.timerVideoButton}>
                <Text style={styles.timerVideoButtonText}>Watch Video</Text>
              </Pressable>

              <Pressable onPress={onOpenVideo} style={styles.timerVideoSecondaryButton}>
                <Text style={styles.timerVideoSecondaryButtonText}>Open Link</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.landscapeCard}>
          <Text style={styles.nextBlockLabel}>{nextBlock ? "NEXT BLOCK" : "FINISH"}</Text>
          <Text style={styles.nextBlockTitle} numberOfLines={3}>
            {nextBlock ? nextBlockTitle : "End of practice"}
          </Text>
        </View>

        <View style={styles.landscapeControls}>
          <TimerControls
            timerActive={timerActive}
            voiceEnabled={voiceEnabled}
            hapticsEnabled={hapticsEnabled}
            countdownEnabled={countdownEnabled}
            onToggleTimer={onToggleTimer}
            onPrevious={onPrevious}
            onRestart={onRestart}
            onNext={onNext}
            onToggleVoice={onToggleVoice}
            onToggleHaptics={onToggleHaptics}
            onToggleCountdown={onToggleCountdown}
            compact
          />
        </View>
      </View>
    </View>
  );
}

function TimerControls({
  timerActive,
  voiceEnabled,
  hapticsEnabled,
  countdownEnabled,
  onToggleTimer,
  onPrevious,
  onRestart,
  onNext,
  onToggleVoice,
  onToggleHaptics,
  onToggleCountdown,
  compact = false,
}: {
  timerActive: boolean;
  voiceEnabled: boolean;
  hapticsEnabled: boolean;
  countdownEnabled: boolean;
  onToggleTimer: () => void;
  onPrevious: () => void;
  onRestart: () => void;
  onNext: () => void;
  onToggleVoice: () => void;
  onToggleHaptics: () => void;
  onToggleCountdown: () => void;
  compact?: boolean;
}) {
  return (
    <View style={compact ? styles.timerControlsCompact : styles.timerControls}>
      <Pressable
        onPress={onToggleTimer}
        style={({ pressed }) => [
          compact ? styles.timerPrimaryButtonCompact : styles.timerPrimaryButton,
          { backgroundColor: pressed ? "#991b1b" : "#bf1029" },
        ]}
      >
        <Text style={styles.timerPrimaryButtonText}>{timerActive ? "Pause" : "Start"}</Text>
      </Pressable>

      <View style={styles.timerControlRow}>
        <Pressable onPress={onPrevious} style={styles.timerSecondaryButton}>
          <Text style={styles.timerSecondaryButtonText}>Previous</Text>
        </Pressable>

        <Pressable onPress={onRestart} style={styles.timerSecondaryButton}>
          <Text style={styles.timerSecondaryButtonText}>Restart</Text>
        </Pressable>

        <Pressable onPress={onNext} style={styles.timerSecondaryButton}>
          <Text style={styles.timerSecondaryButtonText}>Next</Text>
        </Pressable>
      </View>

      <View style={styles.timerToggleRow}>
        <TogglePill label={`Voice ${voiceEnabled ? "On" : "Off"}`} active={voiceEnabled} onPress={onToggleVoice} />
        <TogglePill
          label={`Vibration ${hapticsEnabled ? "On" : "Off"}`}
          active={hapticsEnabled}
          onPress={onToggleHaptics}
        />
        <TogglePill
          label={`3-Count ${countdownEnabled ? "On" : "Off"}`}
          active={countdownEnabled}
          onPress={onToggleCountdown}
        />
      </View>
    </View>
  );
}

function PillButton({
  label,
  onPress,
  variant = "red",
}: {
  label: string;
  onPress: () => void;
  variant?: "red" | "white" | "blue";
}) {
  const backgroundColor =
    variant === "white" ? "#ffffff" : variant === "blue" ? "#173b67" : "#bf1029";

  const color = variant === "white" ? "#061a33" : "#ffffff";

  return (
    <Pressable
      onPress={onPress}
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 999,
        backgroundColor,
        borderWidth: variant === "blue" ? 1 : 0,
        borderColor: "#315c86",
      }}
    >
      <Text style={{ color, fontWeight: "900" }}>{label}</Text>
    </Pressable>
  );
}

function TogglePill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: active ? "#173b67" : "#102f52",
        borderWidth: 1,
        borderColor: active ? "#93c5fd" : "#315c86",
      }}
    >
      <Text style={{ color: "#ffffff", fontWeight: "900", fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  authCard: {
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#21486e",
    backgroundColor: "#0b2542",
    gap: 12,
  },
  authTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: "#ffffff",
  },
  authCopy: {
    fontSize: 15,
    color: "#b7c9df",
    lineHeight: 22,
  },
  redPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: "#bf1029",
  },
  redPillText: {
    color: "#fff",
    fontWeight: "900",
  },
  refreshButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: "#ffffff",
    marginBottom: 20,
  },
  refreshButtonText: {
    color: "#061a33",
    fontWeight: "900",
  },
  infoCard: {
    borderWidth: 1,
    borderColor: "#21486e",
    borderRadius: 20,
    padding: 16,
    backgroundColor: "#0b2542",
    marginBottom: 18,
  },
  infoCopy: {
    fontSize: 15,
    color: "#b7c9df",
    lineHeight: 22,
  },
  loadingText: {
    color: "#b7c9df",
    marginBottom: 16,
  },
  emptyCard: {
    borderWidth: 1,
    borderColor: "#21486e",
    borderRadius: 20,
    padding: 18,
    backgroundColor: "#0b2542",
  },
  emptyCopy: {
    fontSize: 16,
    lineHeight: 22,
    color: "#b7c9df",
  },
  panelCard: {
    borderWidth: 1,
    borderColor: "#21486e",
    borderRadius: 24,
    padding: 16,
    backgroundColor: "#0b2542",
  },
  panelTitle: {
    fontSize: 19,
    fontWeight: "900",
    marginBottom: 12,
    color: "#ffffff",
  },
  planCard: {
    borderWidth: 1,
    borderColor: "#315c86",
    borderRadius: 16,
    padding: 13,
    backgroundColor: "#102f52",
  },
  planCardActive: {
    borderColor: "#ffffff",
    backgroundColor: "#173b67",
  },
  planTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#ffffff",
  },
  planMeta: {
    fontSize: 14,
    color: "#b7c9df",
    marginTop: 4,
  },
  detailTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: "#ffffff",
  },
  detailMeta: {
    fontSize: 15,
    color: "#b7c9df",
    marginTop: 8,
    lineHeight: 22,
  },
  liveTimerPreview: {
    marginTop: 18,
    padding: 20,
    borderRadius: 30,
    backgroundColor: "#030f1f",
    borderWidth: 2,
    borderColor: "#bf1029",
    minHeight: 430,
    justifyContent: "center",
  },
  livePreviewEyebrow: {
    fontSize: 13,
    fontWeight: "900",
    color: "#fca5a5",
    letterSpacing: 1.4,
    textAlign: "center",
  },
  livePreviewClock: {
    fontSize: 76,
    lineHeight: 86,
    fontWeight: "900",
    color: "#ffffff",
    marginTop: 14,
    textAlign: "center",
    letterSpacing: -4,
  },
  livePreviewTitle: {
    fontSize: 25,
    lineHeight: 31,
    fontWeight: "900",
    color: "#ffffff",
    marginTop: 10,
    textAlign: "center",
  },
  livePreviewMeta: {
    fontSize: 15,
    color: "#b7c9df",
    marginTop: 8,
    textAlign: "center",
    fontWeight: "800",
  },
  previewNextCard: {
    marginTop: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#315c86",
    backgroundColor: "#0b2542",
    padding: 14,
  },
  previewVideoRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: 16,
  },
  startFullButton: {
    marginTop: 18,
    borderRadius: 22,
    paddingVertical: 18,
    alignItems: "center",
  },
  startFullButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
  },
  previewControlRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: 14,
  },
  previewHelp: {
    fontSize: 13,
    color: "#b7c9df",
    marginTop: 12,
    lineHeight: 20,
    textAlign: "center",
  },
  blockCard: {
    borderWidth: 1,
    borderColor: "#315c86",
    borderRadius: 18,
    padding: 14,
    backgroundColor: "#102f52",
  },
  blockCardActive: {
    borderColor: "#bf1029",
    backgroundColor: "#431407",
  },
  blockTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#ffffff",
  },
  blockMeta: {
    fontSize: 14,
    color: "#b7c9df",
    marginTop: 6,
  },
  blockNotes: {
    fontSize: 14,
    color: "#dbeafe",
    lineHeight: 21,
    marginTop: 8,
  },
  blockVideoRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 10,
  },
  setActiveButton: {
    marginTop: 10,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#ffffff",
  },
  setActiveText: {
    color: "#061a33",
    fontWeight: "900",
  },
  timerModal: {
    flex: 1,
    backgroundColor: "#030f1f",
    paddingTop: 54,
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  timerModalLandscape: {
    paddingTop: 24,
    paddingHorizontal: 22,
    paddingBottom: 18,
  },
  timerTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  timerTopButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#102f52",
    borderWidth: 1,
    borderColor: "#315c86",
  },
  timerTopButtonText: {
    color: "#ffffff",
    fontWeight: "900",
  },
  timerTopTitle: {
    flex: 1,
    textAlign: "center",
    color: "#b7c9df",
    fontWeight: "900",
    fontSize: 14,
  },
  timerScrollContent: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 26,
    paddingBottom: 18,
  },
  timerEyebrow: {
    color: "#93c5fd",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginBottom: 12,
  },
  timerClock: {
    color: "#ffffff",
    fontSize: 76,
    lineHeight: 84,
    fontWeight: "900",
    letterSpacing: -4,
  },
  timerBlockTitle: {
    color: "#ffffff",
    fontSize: 29,
    lineHeight: 34,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 14,
  },
  timerMeta: {
    color: "#b7c9df",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 8,
    textAlign: "center",
  },
  landscapeBody: {
    flex: 1,
    flexDirection: "row",
    gap: 18,
    paddingTop: 18,
  },
  landscapeTimerPanel: {
    flex: 1.55,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: "#bf1029",
    backgroundColor: "#061a33",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  landscapeClock: {
    color: "#ffffff",
    fontSize: 92,
    lineHeight: 102,
    fontWeight: "900",
    letterSpacing: -5,
  },
  landscapeBlockTitle: {
    color: "#ffffff",
    fontSize: 27,
    lineHeight: 32,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 10,
  },
  landscapeSidePanel: {
    flex: 0.9,
    gap: 10,
  },
  landscapeCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#315c86",
    backgroundColor: "#0b2542",
    padding: 12,
  },
  landscapeControls: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#315c86",
    backgroundColor: "#0b2542",
    padding: 12,
    gap: 10,
  },
  timerVideoRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  timerVideoButton: {
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: "#bf1029",
  },
  timerVideoButtonText: {
    color: "#ffffff",
    fontWeight: "900",
  },
  timerVideoSecondaryButton: {
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: "#102f52",
    borderWidth: 1,
    borderColor: "#315c86",
  },
  timerVideoSecondaryButtonText: {
    color: "#ffffff",
    fontWeight: "900",
  },
  nextBlockCard: {
    marginTop: 16,
    width: "100%",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#315c86",
    backgroundColor: "#0b2542",
    padding: 14,
  },
  nextBlockLabel: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 6,
  },
  nextBlockTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
  },
  timerControls: {
    gap: 12,
    paddingTop: 8,
  },
  timerControlsCompact: {
    gap: 10,
  },
  timerPrimaryButton: {
    borderRadius: 24,
    paddingVertical: 18,
    alignItems: "center",
  },
  timerPrimaryButtonCompact: {
    borderRadius: 22,
    paddingVertical: 13,
    alignItems: "center",
  },
  timerPrimaryButtonText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "900",
  },
  timerControlRow: {
    flexDirection: "row",
    gap: 10,
  },
  timerSecondaryButton: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#102f52",
    borderWidth: 1,
    borderColor: "#315c86",
  },
  timerSecondaryButtonText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 12,
  },
  timerToggleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
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
    fontWeight: "900",
  },
  videoModalClose: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  videoModalCloseText: {
    color: "#fff",
    fontWeight: "900",
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
    fontWeight: "900",
  },
});