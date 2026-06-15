import { router } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { signOut } from "firebase/auth";
import { auth } from "@wrestlewell/firebase/client";
import { useMobileAuthState } from "../components/auth-provider";
import { MobileScreenShell } from "../components/mobile-screen-shell";

export default function UatResetScreen() {
  const { refreshAppState } = useMobileAuthState();

  useEffect(() => {
    async function resetSession() {
      try {
        await signOut(auth);
      } catch {
        // Already signed out is fine for UAT reset.
      }

      try {
        await refreshAppState();
      } catch {
        // Continue even if provider refresh lags.
      }

      router.replace("/sign-in" as any);
    }

    resetSession();
  }, [refreshAppState]);

  return (
    <MobileScreenShell
      title="Resetting UAT"
      subtitle="Signing out and returning to the login screen."
    >
      <View
        style={{
          borderWidth: 1,
          borderColor: "#21486e",
          borderRadius: 24,
          padding: 18,
          backgroundColor: "#0b2542",
        }}
      >
        <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
          Resetting UAT session...
        </Text>
      </View>
    </MobileScreenShell>
  );
}
