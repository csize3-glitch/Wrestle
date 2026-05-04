import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { db } from "@wrestlewell/firebase/client";
import { listWrestlers } from "@wrestlewell/lib/index";
import type { PracticeCheckInQrPayload, WrestlerProfile } from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell } from "../components/mobile-screen-shell";

export default function MyCheckInQrScreen() {
  const { firebaseUser, appUser, currentTeam, loading: authLoading } = useMobileAuthState();
  const [wrestlers, setWrestlers] = useState<WrestlerProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!currentTeam?.id || !firebaseUser?.uid) {
        setWrestlers([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setWrestlers(await listWrestlers(db, currentTeam.id));
      } catch (error) {
        console.error("Failed to load wrestler QR profile:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [currentTeam?.id, firebaseUser?.uid]);

  const ownWrestler = useMemo(
    () =>
      appUser?.role === "athlete"
        ? wrestlers.find((wrestler) => wrestler.ownerUserId === firebaseUser?.uid) || null
        : null,
    [appUser?.role, firebaseUser?.uid, wrestlers]
  );

  const qrPayload = useMemo<PracticeCheckInQrPayload | null>(() => {
    if (!currentTeam?.id || !ownWrestler?.id) {
      return null;
    }

    return {
      type: "wrestlewell-athlete-checkin",
      version: 1,
      teamId: currentTeam.id,
      wrestlerId: ownWrestler.id,
    };
  }, [currentTeam?.id, ownWrestler?.id]);

  if (!authLoading && (!firebaseUser || !appUser)) {
    return (
      <MobileScreenShell
        title="My Check-In QR"
        subtitle="Sign in to show your WrestleWell practice check-in code."
      >
        <View
          style={{
            borderRadius: 24,
            padding: 18,
            borderWidth: 1,
            borderColor: "#21486e",
            backgroundColor: "#0b2542",
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: "900", color: "#ffffff" }}>Sign in required</Text>
          <Text style={{ color: "#b7c9df", lineHeight: 22, marginTop: 8 }}>
            Sign in as an athlete to show your check-in QR code to a coach at practice.
          </Text>
        </View>
      </MobileScreenShell>
    );
  }

  return (
    <MobileScreenShell
      title="My Check-In QR"
      subtitle="Show this code to your coach at practice for a fast, no-typing check-in."
    >
      {appUser?.role !== "athlete" ? (
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
            Athlete QR only
          </Text>
          <Text style={{ color: "#b7c9df", lineHeight: 22 }}>
            This screen is built for athlete check-in. Coaches and parents use the practice calendar to manage attendance.
          </Text>
        </View>
      ) : loading ? (
        <Text style={{ color: "#b7c9df" }}>Loading your wrestler profile...</Text>
      ) : !ownWrestler || !qrPayload ? (
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
            No wrestler profile yet
          </Text>
          <Text style={{ color: "#b7c9df", lineHeight: 22 }}>
            Create or connect your wrestler profile first. Once your athlete profile is linked, your check-in QR will show here automatically.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 14 }}>
          <View
            style={{
              borderRadius: 28,
              padding: 20,
              borderWidth: 1,
              borderColor: "#21486e",
              backgroundColor: "#0b2542",
              alignItems: "center",
            }}
          >
            <View
              style={{
                width: 270,
                maxWidth: "100%",
                aspectRatio: 1,
                borderRadius: 28,
                backgroundColor: "#ffffff",
                alignItems: "center",
                justifyContent: "center",
                padding: 18,
              }}
            >
              <QRCode value={JSON.stringify(qrPayload)} size={210} />
            </View>

            <Text
              style={{
                color: "#ffffff",
                fontSize: 24,
                fontWeight: "900",
                marginTop: 18,
                textAlign: "center",
              }}
            >
              {`${ownWrestler.firstName} ${ownWrestler.lastName}`.trim() || "Your Wrestler Profile"}
            </Text>

            <Text
              style={{
                color: "#93c5fd",
                fontSize: 15,
                fontWeight: "800",
                marginTop: 8,
                textAlign: "center",
              }}
            >
              {currentTeam?.name || "Your Team"}
            </Text>

            <Text
              style={{
                color: "#b7c9df",
                fontSize: 14,
                lineHeight: 21,
                textAlign: "center",
                marginTop: 14,
              }}
            >
              Open this screen when you walk in. A coach can scan it to mark you present instantly for today’s scheduled practice.
            </Text>
          </View>

          <View
            style={{
              borderRadius: 22,
              padding: 18,
              borderWidth: 1,
              borderColor: "#21486e",
              backgroundColor: "#0b2542",
              gap: 10,
            }}
          >
            <Text style={{ color: "#ffffff", fontSize: 18, fontWeight: "900" }}>
              Practice-day tip
            </Text>
            <Text style={{ color: "#b7c9df", lineHeight: 22 }}>
              Keep this code ready at mat-side or have a parent pull it up for you. It only contains your team and wrestler identifiers, not private personal data.
            </Text>

            <View
              style={{
                marginTop: 4,
                alignSelf: "flex-start",
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 999,
                backgroundColor: "#ffffff",
              }}
            >
              <Text style={{ color: "#061a33", fontWeight: "900" }}>QR Ready</Text>
            </View>
          </View>
        </View>
      )}
    </MobileScreenShell>
  );
}
