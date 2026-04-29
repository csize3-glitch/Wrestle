import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { auth, db } from "@wrestlewell/firebase/client";
import {
  completeAccountSetup,
  registerAccount,
  signInAccount,
} from "@wrestlewell/lib/index";
import type { UserRole } from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import {
  MobileScreenShell,
  WWBadge,
  WWCard,
} from "../components/mobile-screen-shell";

type JoinMode = "sign_in" | "sign_up";

function cleanParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function routeAfterJoin(role: UserRole) {
  if (role === "athlete") {
    router.replace("/vark-questionnaire");
    return;
  }

  router.replace("/");
}

export default function JoinScreen() {
  const params = useLocalSearchParams<{
    role?: string;
    teamCode?: string;
    coachInviteCode?: string;
  }>();

  const { firebaseUser, appUser, refreshAppState } = useMobileAuthState();

  const scannedRole = cleanParam(params.role) === "coach" ? "coach" : "athlete";
  const scannedTeamCode = cleanParam(params.teamCode);
  const scannedCoachInviteCode = cleanParam(params.coachInviteCode);

  const [mode, setMode] = useState<JoinMode>("sign_up");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState(firebaseUser?.email || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const role = scannedRole as UserRole;
  const inviteCode = role === "coach" ? scannedCoachInviteCode : scannedTeamCode;
  const codeLabel = role === "coach" ? "Coach Invite Code" : "Team Code";

  const title = useMemo(() => {
    return role === "coach" ? "Join as Coach" : "Join as Athlete";
  }, [role]);

  async function handleJoin() {
    if (!inviteCode) {
      Alert.alert(
        "Invite missing",
        role === "coach"
          ? "This QR code is missing a coach invite code."
          : "This QR code is missing a team code."
      );
      return;
    }

    if (firebaseUser && appUser) {
      Alert.alert(
        "Already signed in",
        "You are already signed into a WrestleWell account. Sign out first if you need to join with a different account."
      );
      return;
    }

    if (!firebaseUser && (!email.trim() || !password)) {
      Alert.alert("Missing info", "Enter your email and password.");
      return;
    }

    if (mode === "sign_up" && !firebaseUser && !displayName.trim()) {
      Alert.alert("Missing name", "Enter your display name.");
      return;
    }

    try {
      setBusy(true);

      if (firebaseUser && !appUser) {
        await completeAccountSetup(db, {
          uid: firebaseUser.uid,
          email: firebaseUser.email || email.trim(),
          displayName:
            displayName.trim() ||
            firebaseUser.email?.split("@")[0] ||
            "WrestleWell User",
          role,
          teamCode: role === "athlete" ? inviteCode : undefined,
          coachInviteCode: role === "coach" ? inviteCode : undefined,
        });
      } else if (!firebaseUser && mode === "sign_in") {
        await signInAccount(auth, email.trim(), password);

        const signedInUser = auth.currentUser;

        if (!signedInUser?.uid) {
          throw new Error("Sign in worked, but the user account was not available. Try again.");
        }

        await completeAccountSetup(db, {
          uid: signedInUser.uid,
          email: signedInUser.email || email.trim(),
          displayName:
            displayName.trim() ||
            signedInUser.email?.split("@")[0] ||
            "WrestleWell User",
          role,
          teamCode: role === "athlete" ? inviteCode : undefined,
          coachInviteCode: role === "coach" ? inviteCode : undefined,
        });
      } else if (!firebaseUser && mode === "sign_up") {
        await registerAccount(auth, db, {
          displayName: displayName.trim(),
          email: email.trim(),
          password,
          role,
          teamCode: role === "athlete" ? inviteCode : undefined,
          coachInviteCode: role === "coach" ? inviteCode : undefined,
        });
      }

      await refreshAppState();
      routeAfterJoin(role);
    } catch (error: any) {
      console.error("Join failed:", error);
      Alert.alert("Join failed", error?.message || "There was a problem joining the team.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <MobileScreenShell
      title={title}
      subtitle="Scan-to-join setup for WrestleWell teams."
      eyebrow="TEAM INVITE"
    >
      <View style={{ gap: 14 }}>
        <WWCard>
          <WWBadge
            label={role === "coach" ? "COACH ACCESS" : "ATHLETE ACCESS"}
            tone={role === "coach" ? "orange" : "green"}
          />

          <Text
            style={{
              color: "#ffffff",
              fontSize: 28,
              fontWeight: "900",
              letterSpacing: -0.7,
              marginTop: 14,
            }}
          >
            {role === "coach" ? "Join the coaching staff" : "Join your wrestling team"}
          </Text>

          <Text
            style={{
              color: "#b7c9df",
              fontSize: 15,
              lineHeight: 22,
              marginTop: 8,
            }}
          >
            This invite was opened from a WrestleWell QR code. The code is already filled in below.
          </Text>

          <View
            style={{
              marginTop: 16,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: role === "coach" ? "#9a3412" : "#166534",
              backgroundColor: role === "coach" ? "#431407" : "#052e1b",
              padding: 16,
            }}
          >
            <Text
              style={{
                color: role === "coach" ? "#fed7aa" : "#bbf7d0",
                fontSize: 12,
                fontWeight: "900",
                letterSpacing: 1,
                marginBottom: 8,
              }}
            >
              {codeLabel.toUpperCase()}
            </Text>

            <Text
              selectable
              style={{
                color: "#ffffff",
                fontSize: 24,
                fontWeight: "900",
                letterSpacing: 1.2,
              }}
            >
              {inviteCode || "Missing code"}
            </Text>
          </View>
        </WWCard>

        <WWCard>
          <Text
            style={{
              color: "#ffffff",
              fontSize: 22,
              fontWeight: "900",
              marginBottom: 12,
            }}
          >
            {firebaseUser
              ? appUser
                ? "You are already signed in"
                : "Finish your account setup"
              : "Continue with your account"}
          </Text>

          {!firebaseUser ? (
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
              <Pressable
                onPress={() => setMode("sign_up")}
                style={{
                  flex: 1,
                  borderRadius: 999,
                  paddingVertical: 12,
                  alignItems: "center",
                  backgroundColor: mode === "sign_up" ? "#bf1029" : "#102f52",
                  borderWidth: 1,
                  borderColor: mode === "sign_up" ? "#bf1029" : "#315c86",
                }}
              >
                <Text style={{ color: "#ffffff", fontWeight: "900" }}>Create</Text>
              </Pressable>

              <Pressable
                onPress={() => setMode("sign_in")}
                style={{
                  flex: 1,
                  borderRadius: 999,
                  paddingVertical: 12,
                  alignItems: "center",
                  backgroundColor: mode === "sign_in" ? "#bf1029" : "#102f52",
                  borderWidth: 1,
                  borderColor: mode === "sign_in" ? "#bf1029" : "#315c86",
                }}
              >
                <Text style={{ color: "#ffffff", fontWeight: "900" }}>Sign In</Text>
              </Pressable>
            </View>
          ) : null}

          {firebaseUser && appUser ? (
            <View style={{ gap: 12 }}>
              <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22 }}>
                You are already signed in as {appUser.displayName}. Go back to your dashboard.
              </Text>

              <PrimaryButton label="Go to Dashboard" onPress={() => router.replace("/")} />
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              {mode === "sign_up" || firebaseUser ? (
                <JoinField
                  label="Display Name"
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder={role === "coach" ? "Coach Miller" : "Alex Martinez"}
                />
              ) : null}

              {!firebaseUser ? (
                <>
                  <JoinField
                    label="Email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />

                  <JoinField
                    label="Password"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Password"
                    secureTextEntry
                  />
                </>
              ) : (
                <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22 }}>
                  Signed in as {firebaseUser.email}. Tap below to attach this account to the scanned invite.
                </Text>
              )}

              <PrimaryButton
                label={
                  busy
                    ? "Joining..."
                    : mode === "sign_in"
                      ? "Sign In & Join"
                      : role === "athlete"
                        ? "Join Team & Start WrestleIQ"
                        : "Join Team"
                }
                onPress={handleJoin}
                disabled={busy}
              />

              {role === "athlete" ? (
                <Text style={{ color: "#93c5fd", fontSize: 13, lineHeight: 19 }}>
                  Athletes will complete the WrestleIQ learning style questionnaire after joining.
                </Text>
              ) : null}
            </View>
          )}
        </WWCard>

        <Pressable
          onPress={() => router.replace("/")}
          style={{
            borderRadius: 18,
            paddingVertical: 14,
            alignItems: "center",
            backgroundColor: "#102f52",
            borderWidth: 1,
            borderColor: "#315c86",
          }}
        >
          <Text style={{ color: "#ffffff", fontSize: 15, fontWeight: "900" }}>
            Back to Home
          </Text>
        </Pressable>
      </View>
    </MobileScreenShell>
  );
}

function JoinField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <View>
      <Text style={{ color: "#ffffff", fontWeight: "900", marginBottom: 8 }}>
        {label}
      </Text>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#7c8da3"
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={{
          minHeight: 50,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: "#315c86",
          backgroundColor: "#102f52",
          color: "#ffffff",
          paddingHorizontal: 14,
          fontWeight: "800",
        }}
      />
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        marginTop: 4,
        borderRadius: 18,
        paddingVertical: 16,
        alignItems: "center",
        backgroundColor: disabled ? "#64748b" : pressed ? "#991b1b" : "#bf1029",
      })}
    >
      <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "900" }}>
        {label}
      </Text>
    </Pressable>
  );
}