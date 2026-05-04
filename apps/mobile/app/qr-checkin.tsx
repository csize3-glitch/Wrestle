import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import { db } from "@wrestlewell/firebase/client";
import {
  calendarEventMatchesWrestler,
  listPracticeAttendanceForEvent,
  listWrestlers,
  upsertPracticeAttendanceCheckIn,
  type CalendarEventRecord,
} from "@wrestlewell/lib/index";
import type {
  PracticeAttendanceStatus,
  PracticeCheckInQrPayload,
  WrestlerProfile,
} from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell } from "../components/mobile-screen-shell";

function parseAssignedIds(value?: string) {
  return typeof value === "string" && value.length > 0 ? value.split(",").filter(Boolean) : [];
}

function buildEventFromParams(params: {
  calendarEventId?: string;
  practicePlanId?: string;
  title?: string;
  date?: string;
  assignmentType?: string;
  groupId?: string;
  groupName?: string;
  assignedWrestlerIds?: string;
  totalSeconds?: string;
  totalMinutes?: string;
}) {
  if (!params.calendarEventId || !params.practicePlanId || !params.date) {
    return null;
  }

  return {
    id: params.calendarEventId,
    practicePlanId: params.practicePlanId,
    practicePlanTitle: params.title || "Scheduled practice",
    date: params.date,
    teamId: "",
    createdAt: "",
    updatedAt: "",
    assignmentType:
      params.assignmentType === "group" || params.assignmentType === "custom"
        ? params.assignmentType
        : "team",
    groupId: params.groupId || "",
    groupName: params.groupName || "",
    assignedWrestlerIds: parseAssignedIds(params.assignedWrestlerIds),
    totalSeconds: Number.parseInt(params.totalSeconds || "0", 10) || 0,
    totalMinutes: Number.parseInt(params.totalMinutes || "0", 10) || 0,
  } satisfies CalendarEventRecord;
}

function formatAssignmentLabel(event: CalendarEventRecord) {
  if (event.assignmentType === "group" && event.groupName) {
    return `Training group • ${event.groupName}`;
  }

  if (event.assignmentType === "custom") {
    return `Custom wrestlers • ${(event.assignedWrestlerIds || []).length}`;
  }

  return "Team-wide";
}

function isQrPayload(value: unknown): value is PracticeCheckInQrPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.type === "wrestlewell-athlete-checkin" &&
    record.version === 1 &&
    typeof record.teamId === "string" &&
    typeof record.wrestlerId === "string"
  );
}

export default function QrCheckInScreen() {
  const params = useLocalSearchParams<{
    calendarEventId?: string;
    practicePlanId?: string;
    title?: string;
    date?: string;
    assignmentType?: string;
    groupId?: string;
    groupName?: string;
    assignedWrestlerIds?: string;
    totalSeconds?: string;
    totalMinutes?: string;
  }>();
  const { firebaseUser, appUser, currentTeam, loading: authLoading } = useMobileAuthState();
  const [permission, requestPermission] = useCameraPermissions();
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [loadingWrestlers, setLoadingWrestlers] = useState(true);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanTone, setScanTone] = useState<"idle" | "success" | "error">("idle");
  const [processingScan, setProcessingScan] = useState(false);
  const [lastScanKey, setLastScanKey] = useState("");

  const event = useMemo(() => buildEventFromParams(params), [params]);

  useEffect(() => {
    async function load() {
      if (!currentTeam?.id) {
        setWrestlers([]);
        setLoadingWrestlers(false);
        return;
      }

      try {
        setLoadingWrestlers(true);
        setWrestlers(await listWrestlers(db, currentTeam.id));
      } catch (error) {
        console.error("Failed to load wrestlers for QR check-in:", error);
      } finally {
        setLoadingWrestlers(false);
      }
    }

    load();
  }, [currentTeam?.id]);

  async function handleScan(raw: string) {
    if (!currentTeam?.id || !firebaseUser?.uid || !event || processingScan) {
      return;
    }

    setProcessingScan(true);
    try {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("That code is not a WrestleWell check-in QR.");
      }

      if (!isQrPayload(parsed)) {
        throw new Error("That QR code is not a valid WrestleWell athlete check-in code.");
      }

      if (parsed.teamId !== currentTeam.id) {
        throw new Error("This QR code belongs to a different team.");
      }

      const wrestler = wrestlers.find((entry) => entry.id === parsed.wrestlerId) || null;
      if (!wrestler) {
        throw new Error("That wrestler is not on this team roster.");
      }

      if (!calendarEventMatchesWrestler(event, wrestler)) {
        throw new Error("That wrestler is not assigned to this practice.");
      }

      const scanKey = `${event.id}:${wrestler.id}`;
      if (scanKey === lastScanKey) {
        setScanTone("success");
        setScanMessage(`${wrestler.firstName} ${wrestler.lastName} was already scanned just now.`);
        return;
      }

      const existingAttendance = await listPracticeAttendanceForEvent(
        db,
        currentTeam.id,
        event.id,
        wrestler.id
      );
      const existing = existingAttendance[0] || null;
      const wrestlerName = `${wrestler.firstName} ${wrestler.lastName}`.trim() || "Unnamed Wrestler";

      if (existing?.status === "present") {
        setLastScanKey(scanKey);
        setScanTone("success");
        setScanMessage(`${wrestlerName} is already checked in.`);
        return;
      }

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
        wrestlerName,
        status: "present" satisfies PracticeAttendanceStatus,
        checkedInByUserId: firebaseUser.uid,
        checkedInByRole: "coach",
      });

      setLastScanKey(scanKey);
      setScanTone("success");
      setScanMessage(`${wrestlerName} checked in.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The QR scan could not be completed.";
      setScanTone("error");
      setScanMessage(message);
    } finally {
      setTimeout(() => setProcessingScan(false), 900);
    }
  }

  if (!authLoading && (!firebaseUser || !appUser)) {
    return (
      <MobileScreenShell
        title="QR Check-In"
        subtitle="Sign in as a coach to scan athlete check-in codes."
      >
        <View
          style={{
            borderRadius: 24,
            padding: 18,
            borderWidth: 1,
            borderColor: "#21486e",
            backgroundColor: "#0b2542",
            gap: 10,
          }}
        >
          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>Sign in required</Text>
          <Text style={{ color: "#b7c9df", lineHeight: 22 }}>
            Coaches can scan athlete QR codes from this screen once they are signed in.
          </Text>
        </View>
      </MobileScreenShell>
    );
  }

  return (
    <MobileScreenShell
      title="QR Check-In"
      subtitle="Scan athlete check-in codes at the door and mark them present instantly."
    >
      {appUser?.role !== "coach" ? (
        <View
          style={{
            borderRadius: 24,
            padding: 18,
            borderWidth: 1,
            borderColor: "#21486e",
            backgroundColor: "#0b2542",
            gap: 10,
          }}
        >
          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
            Coach-only scanner
          </Text>
          <Text style={{ color: "#b7c9df", lineHeight: 22 }}>
            This scanner is only for coaches managing live practice attendance.
          </Text>
        </View>
      ) : !event ? (
        <View
          style={{
            borderRadius: 24,
            padding: 18,
            borderWidth: 1,
            borderColor: "#21486e",
            backgroundColor: "#0b2542",
            gap: 10,
          }}
        >
          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
            Practice details missing
          </Text>
          <Text style={{ color: "#b7c9df", lineHeight: 22 }}>
            Open QR Check-In Mode from a scheduled practice so WrestleWell knows which event to update.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 14 }}>
          <View
            style={{
              borderRadius: 24,
              padding: 18,
              borderWidth: 1,
              borderColor: "#21486e",
              backgroundColor: "#0b2542",
              gap: 8,
            }}
          >
            <Text style={{ color: "#ffffff", fontSize: 22, fontWeight: "900" }}>
              {event.practicePlanTitle || "Scheduled practice"}
            </Text>
            <Text style={{ color: "#93c5fd", fontWeight: "800" }}>{event.date}</Text>
            <Text style={{ color: "#b7c9df" }}>{formatAssignmentLabel(event)}</Text>
          </View>

          {!permission ? (
            <Text style={{ color: "#b7c9df" }}>Checking camera permission…</Text>
          ) : !permission.granted ? (
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
              <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
                Camera permission needed
              </Text>
              <Text style={{ color: "#b7c9df", lineHeight: 22 }}>
                Allow camera access so coaches can scan WrestleWell athlete QR codes at practice.
              </Text>
              <Pressable
                onPress={() => requestPermission()}
                style={{
                  alignSelf: "flex-start",
                  paddingHorizontal: 16,
                  paddingVertical: 11,
                  borderRadius: 999,
                  backgroundColor: "#bf1029",
                }}
              >
                <Text style={{ color: "#ffffff", fontWeight: "900" }}>Enable Camera</Text>
              </Pressable>
            </View>
          ) : (
            <View
              style={{
                borderRadius: 28,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: "#21486e",
                backgroundColor: "#0b2542",
              }}
            >
              <CameraView
                style={{ width: "100%", aspectRatio: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={processingScan ? undefined : ({ data }) => void handleScan(data)}
              />
            </View>
          )}

          <View
            style={{
              borderRadius: 24,
              padding: 18,
              borderWidth: 1,
              borderColor:
                scanTone === "error" ? "#7f1d1d" : scanTone === "success" ? "#166534" : "#21486e",
              backgroundColor:
                scanTone === "error" ? "#3f1118" : scanTone === "success" ? "#0f2f1b" : "#0b2542",
              gap: 10,
            }}
          >
            <Text style={{ color: "#ffffff", fontSize: 18, fontWeight: "900" }}>
              {scanTone === "success"
                ? "Check-in confirmed"
                : scanTone === "error"
                  ? "Scan issue"
                  : "Ready to scan"}
            </Text>
            <Text style={{ color: "#dbeafe", lineHeight: 22 }}>
              {scanMessage ||
                "Have the athlete show their WrestleWell QR code. Scans for the wrong team or unassigned wrestlers will be blocked."}
            </Text>
          </View>

          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Pressable
              onPress={() => {
                setLastScanKey("");
                setScanTone("idle");
                setScanMessage(null);
              }}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 11,
                borderRadius: 999,
                backgroundColor: "#ffffff",
              }}
            >
              <Text style={{ color: "#061a33", fontWeight: "900" }}>Reset Scanner</Text>
            </Pressable>

            <Pressable
              onPress={() => router.back()}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 11,
                borderRadius: 999,
                backgroundColor: "#bf1029",
              }}
            >
              <Text style={{ color: "#ffffff", fontWeight: "900" }}>Back to Practice</Text>
            </Pressable>
          </View>

          {loadingWrestlers ? (
            <Text style={{ color: "#b7c9df" }}>Loading team roster for scan validation…</Text>
          ) : null}
        </View>
      )}
    </MobileScreenShell>
  );
}
