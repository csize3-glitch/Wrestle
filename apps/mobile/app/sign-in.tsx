import { router } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { auth, db } from "@wrestlewell/firebase/client";
import {
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

type AuthMode = "sign_in" | "sign_up";

export default function SignInScreen() {
  const { refreshAppState } = useMobileAuthState();

  const [mode, setMode] = useState<AuthMode>("sign_in");
  const [role, setRole] = useState<UserRole>("coach");
  const [displayName, setDisplayName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [coachInviteCode, setCoachInviteCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || !password) {
      Alert.alert("Missing info", "Enter your email and password.");
      return;
    }

    if (mode === "sign_up" && !displayName.trim()) {
      Alert.alert("Missing name", "Add your display name before creating an account.");
      return;
    }

    if (mode === "sign_up" && role === "coach" && !teamName.trim() && !coachInviteCode.trim()) {
      Alert.alert(
        "Team needed",
        "Enter a new team name or use a coach invite code to join an existing staff."
      );
      return;
    }

    if (mode === "sign_up" && role === "athlete" && !teamCode.trim()) {
      Alert.alert("Team code needed", "Enter your team code to join as an athlete.");
      return;
    }

    try {
      setSubmitting(true);

      if (mode === "sign_in") {
        await signInAccount(auth, email.trim(), password);
      } else {
        await registerAccount(auth, db, {
          displayName: displayName.trim(),
          email: email.trim(),
          password,
          role,
          teamName: role === "coach" && teamName.trim() ? teamName.trim() : undefined,
          teamCode: role === "athlete" ? teamCode.trim() : undefined,
          coachInviteCode: role === "coach" && coachInviteCode.trim() ? coachInviteCode.trim() : undefined,
        });
      }

      await refreshAppState();
      router.replace("/");
    } catch (error: any) {
      console.error("Mobile auth failed:", error);
      Alert.alert(
        mode === "sign_in" ? "Login failed" : "Account setup failed",
        error?.message ?? "Something went wrong. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <MobileScreenShell
      title={mode === "sign_in" ? "Welcome Back" : "Join WrestleWell"}
      subtitle={
        mode === "sign_in"
          ? "Log in to your mat room command center."
          : "Create your coach or athlete account and connect to your team."
      }
      eyebrow="SECURE TEAM ACCESS"
    >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 18 }}
        >
          <View style={{ gap: 14 }}>
            <WWCard
              style={{
                backgroundColor: "#ffffff",
                borderColor: "#ffffff",
              }}
            >
              <Text
                style={{
                  color: "#061a33",
                  fontSize: 13,
                  fontWeight: "900",
                  letterSpacing: 1,
                  marginBottom: 8,
                }}
              >
                WRESTLEWELL LOGIN
              </Text>

              <Text
                style={{
                  color: "#061a33",
                  fontSize: 29,
                  fontWeight: "900",
                  letterSpacing: -0.8,
                }}
              >
                Coaches and athletes, one team system.
              </Text>

              <Text
                style={{
                  color: "#475569",
                  fontSize: 15,
                  lineHeight: 22,
                  marginTop: 8,
                }}
              >
                Coaches manage the room. Athletes stay connected to practice, tournaments,
                mat-side notes, and team alerts.
              </Text>
            </WWCard>

            <WWCard>
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
                <ToggleButton
                  label="Sign In"
                  active={mode === "sign_in"}
                  onPress={() => setMode("sign_in")}
                />
                <ToggleButton
                  label="Create Account"
                  active={mode === "sign_up"}
                  onPress={() => setMode("sign_up")}
                />
              </View>

              {mode === "sign_up" ? (
                <View style={{ gap: 14, marginBottom: 14 }}>
                  <View>
                    <Text style={stylesLabel}>I am a...</Text>

                    <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                      <RoleButton
                        label="Coach"
                        active={role === "coach"}
                        onPress={() => setRole("coach")}
                      />
                      <RoleButton
                        label="Athlete"
                        active={role === "athlete"}
                        onPress={() => setRole("athlete")}
                      />
                    </View>
                  </View>

                  <Field
                    label="Display Name"
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="Coach Miller"
                  />

                  {role === "coach" ? (
                    <>
                      <View
                        style={{
                          borderRadius: 20,
                          borderWidth: 1,
                          borderColor: "#315c86",
                          backgroundColor: "#102f52",
                          padding: 14,
                          gap: 8,
                        }}
                      >
                        <WWBadge label="COACH SETUP" tone="blue" />
                        <Text style={{ color: "#ffffff", fontSize: 17, fontWeight: "900" }}>
                          Create a team or join an existing staff.
                        </Text>
                        <Text style={{ color: "#b7c9df", fontSize: 14, lineHeight: 20 }}>
                          New head coaches can enter a team name. Assistant coaches can use a
                          coach invite code.
                        </Text>
                      </View>

                      <Field
                        label="New Team Name"
                        value={teamName}
                        onChangeText={setTeamName}
                        placeholder="United WC"
                      />

                      <Field
                        label="Coach Invite Code"
                        value={coachInviteCode}
                        onChangeText={setCoachInviteCode}
                        placeholder="COACH-XXXX-XXXX"
                        autoCapitalize="characters"
                      />
                    </>
                  ) : (
                    <>
                      <View
                        style={{
                          borderRadius: 20,
                          borderWidth: 1,
                          borderColor: "#166534",
                          backgroundColor: "#052e1b",
                          padding: 14,
                          gap: 8,
                        }}
                      >
                        <WWBadge label="ATHLETE SETUP" tone="green" />
                        <Text style={{ color: "#ffffff", fontSize: 17, fontWeight: "900" }}>
                          Join your team with the team code.
                        </Text>
                        <Text style={{ color: "#bbf7d0", fontSize: 14, lineHeight: 20 }}>
                          Your coach can share this code or show you the QR invite inside WrestleWell.
                        </Text>
                      </View>

                      <Field
                        label="Team Code"
                        value={teamCode}
                        onChangeText={setTeamCode}
                        placeholder="UNITED-QVFS"
                        autoCapitalize="characters"
                      />
                    </>
                  )}
                </View>
              ) : null}

              <View style={{ gap: 14 }}>
                <Field
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="coach@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <Field
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  secureTextEntry
                />

                <Pressable
                  onPress={handleSubmit}
                  disabled={submitting}
                  style={({ pressed }) => ({
                    backgroundColor: submitting
                      ? "#64748b"
                      : pressed
                        ? "#991b1b"
                        : "#bf1029",
                    borderRadius: 20,
                    paddingVertical: 16,
                    alignItems: "center",
                    marginTop: 4,
                  })}
                >
                  <Text style={{ color: "#ffffff", fontSize: 17, fontWeight: "900" }}>
                    {submitting
                      ? mode === "sign_in"
                        ? "Logging in..."
                        : "Creating account..."
                      : mode === "sign_in"
                        ? "Log In"
                        : role === "coach"
                          ? "Create Coach Account"
                          : "Create Athlete Account"}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => router.replace("/")}
                  style={({ pressed }) => ({
                    borderRadius: 18,
                    paddingVertical: 14,
                    alignItems: "center",
                    backgroundColor: pressed ? "#102f52" : "transparent",
                  })}
                >
                  <Text style={{ color: "#dbeafe", fontSize: 15, fontWeight: "900" }}>
                    Back to Dashboard
                  </Text>
                </Pressable>
              </View>
            </WWCard>

            <WWCard>
              <View style={{ gap: 10 }}>
                <WWBadge label="DEMO READY" tone="red" />
                <Text style={{ color: "#ffffff", fontSize: 22, fontWeight: "900" }}>
                  Built for the mat room.
                </Text>
                <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22 }}>
                  Coaches get team control. Athletes get their own profile, schedule,
                  mat-side preparation, and tournament visibility.
                </Text>
              </View>
            </WWCard>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </MobileScreenShell>
  );
}

const stylesLabel = {
  color: "#ffffff",
  fontSize: 14,
  fontWeight: "900" as const,
};

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize = "sentences",
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
      <Text style={stylesLabel}>{label}</Text>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#7c8da3"
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={{
          height: 52,
          borderRadius: 18,
          backgroundColor: "#102f52",
          borderWidth: 1,
          borderColor: "#315c86",
          paddingHorizontal: 14,
          color: "#ffffff",
          marginTop: 8,
          fontWeight: "800",
        }}
      />
    </View>
  );
}

function ToggleButton({
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
      style={({ pressed }) => ({
        flex: 1,
        paddingVertical: 13,
        borderRadius: 18,
        alignItems: "center",
        backgroundColor: active ? "#ffffff" : pressed ? "#173b67" : "#102f52",
        borderWidth: 1,
        borderColor: active ? "#ffffff" : "#315c86",
      })}
    >
      <Text
        style={{
          color: active ? "#061a33" : "#dbeafe",
          fontWeight: "900",
          fontSize: 14,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function RoleButton({
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
      style={({ pressed }) => ({
        flex: 1,
        paddingVertical: 14,
        borderRadius: 18,
        alignItems: "center",
        backgroundColor: active ? "#bf1029" : pressed ? "#173b67" : "#102f52",
        borderWidth: 1,
        borderColor: active ? "#bf1029" : "#315c86",
      })}
    >
      <Text
        style={{
          color: "#ffffff",
          fontWeight: "900",
          fontSize: 15,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}