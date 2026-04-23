import { Link } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { auth, db } from "@wrestlewell/firebase/client";
import {
  completeAccountSetup,
  registerAccount,
  signInAccount,
} from "@wrestlewell/lib/index";
import type { UserRole } from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import { ScreenShell } from "../components/screen-shell";

type AuthMode = "sign_in" | "sign_up";

type AuthFormState = {
  displayName: string;
  email: string;
  password: string;
  role: UserRole;
  teamName: string;
  teamCode: string;
};

function createInitialAuthForm(): AuthFormState {
  return {
    displayName: "",
    email: "",
    password: "",
    role: "coach",
    teamName: "",
    teamCode: "",
  };
}

const quickActions = [
  {
    href: "/notifications",
    title: "Notifications",
    description: "Send team announcements and review practice, tournament, and roster reminders.",
  },
  {
    href: "/calendar",
    title: "Calendar",
    description: "Review the live team schedule and open assigned practice plans for the week.",
  },
  {
    href: "/practice-plans",
    title: "Practice Plans",
    description: "Open saved plans and run a live coach timer during practice.",
  },
  {
    href: "/tournaments",
    title: "Tournaments",
    description: "Open season event links and jump directly to registration pages.",
  },
  {
    href: "/wrestlers",
    title: "Wrestlers",
    description: "Review synced profiles, strengths, style notes, goals, and coach guidance.",
  },
  {
    href: "/mat-side",
    title: "Mat-Side",
    description: "Open the fast coaching view for reminders, game plan, and warm-up details.",
  },
] as const;

const athleteQuickActions = [
  {
    href: "/notifications",
    title: "Notifications",
    description: "Review coach announcements plus your practice and tournament reminders.",
  },
  {
    href: "/calendar",
    title: "Schedule",
    description: "See your team's upcoming practices and open assigned plans from your phone.",
  },
  {
    href: "/practice-plans",
    title: "Practice Plans",
    description: "Review saved team practice plans and follow the session flow from your phone.",
  },
  {
    href: "/wrestlers",
    title: "My Profile",
    description: "Open your wrestler profile, style notes, goals, and development details.",
  },
  {
    href: "/mat-side",
    title: "My Mat-Side",
    description: "See your warm-up, quick reminders, game plan, and coach-prepared notes.",
  },
  {
    href: "/tournaments",
    title: "Tournaments",
    description: "Review team tournament links and official registration pages.",
  },
] as const;

function pillButton(active: boolean) {
  return {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: active ? "#bf1029" : "#ffffff",
    borderWidth: 1,
    borderColor: active ? "#bf1029" : "rgba(15, 39, 72, 0.12)",
  };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontWeight: "700", color: "#0f2748" }}>{label}</Text>
      {children}
    </View>
  );
}

const inputStyle = {
  minHeight: 46,
  borderWidth: 1,
  borderColor: "rgba(15, 39, 72, 0.12)",
  borderRadius: 14,
  paddingHorizontal: 12,
  backgroundColor: "#ffffff",
} as const;

export default function HomeScreen() {
  const { firebaseUser, appUser, currentTeam, loading, refreshAppState, signOut } = useMobileAuthState();
  const [mode, setMode] = useState<AuthMode>("sign_in");
  const [form, setForm] = useState<AuthFormState>(createInitialAuthForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsSetup = Boolean(firebaseUser && !appUser);
  const isCoach = appUser?.role === "coach";
  const homeActions = isCoach ? quickActions : athleteQuickActions;

  function updateField<K extends keyof AuthFormState>(field: K, value: AuthFormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit() {
    setError(null);
    setBusy(true);

    try {
      if (mode === "sign_in") {
        await signInAccount(auth, form.email, form.password);
      } else {
        await registerAccount(auth, db, {
          displayName: form.displayName,
          email: form.email,
          password: form.password,
          role: form.role,
          teamName: form.role === "coach" ? form.teamName : undefined,
          teamCode: form.role === "athlete" ? form.teamCode : undefined,
        });
      }

      await refreshAppState();
    } catch (nextError) {
      console.error("Mobile authentication failed:", nextError);
      setError(nextError instanceof Error ? nextError.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetupSubmit() {
    if (!firebaseUser?.email) {
      setError("No Firebase user available for setup.");
      return;
    }

    setError(null);
    setBusy(true);

    try {
      await completeAccountSetup(db, {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: form.displayName || firebaseUser.email.split("@")[0],
        role: form.role,
        teamName: form.role === "coach" ? form.teamName : undefined,
        teamCode: form.role === "athlete" ? form.teamCode : undefined,
      });
      await refreshAppState();
    } catch (nextError) {
      console.error("Mobile account setup failed:", nextError);
      setError(nextError instanceof Error ? nextError.message : "Account setup failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <ScreenShell>
        <View style={{ borderRadius: 24, padding: 20, backgroundColor: "#fff" }}>
          <Text style={{ fontSize: 22, fontWeight: "800", color: "#091729" }}>Loading WrestleWell...</Text>
          <Text style={{ marginTop: 8, color: "#5f6d83" }}>Checking your mobile session.</Text>
        </View>
      </ScreenShell>
    );
  }

  if (needsSetup) {
    return (
      <ScreenShell>
        <View style={{ borderRadius: 24, padding: 20, backgroundColor: "#fff", gap: 14 }}>
          <Text style={{ fontSize: 30, fontWeight: "800", color: "#091729" }}>Finish account setup</Text>
          <Text style={{ fontSize: 16, color: "#5f6d83", lineHeight: 24 }}>
            Choose your role and connect your mobile app to the right team.
          </Text>

          <Field label="Display name">
            <TextInput
              value={form.displayName}
              onChangeText={(value) => updateField("displayName", value)}
              style={inputStyle}
              placeholder="Coach Miller"
            />
          </Field>

          <View style={{ flexDirection: "row", gap: 10 }}>
            {(["coach", "athlete"] as UserRole[]).map((role) => (
              <Pressable key={role} onPress={() => updateField("role", role)} style={pillButton(form.role === role)}>
                <Text style={{ color: form.role === role ? "#fff" : "#0f2748", fontWeight: "800" }}>
                  {role === "coach" ? "Coach" : "Athlete"}
                </Text>
              </Pressable>
            ))}
          </View>

          {form.role === "coach" ? (
            <Field label="Team name">
              <TextInput
                value={form.teamName}
                onChangeText={(value) => updateField("teamName", value)}
                style={inputStyle}
                placeholder="Bearcats Wrestling Club"
              />
            </Field>
          ) : (
            <Field label="Team code">
              <TextInput
                value={form.teamCode}
                onChangeText={(value) => updateField("teamCode", value)}
                style={inputStyle}
                placeholder="Coach team code"
              />
            </Field>
          )}

          {error ? <Text style={{ color: "#911022" }}>{error}</Text> : null}

          <Pressable
            onPress={handleSetupSubmit}
            style={{
              minHeight: 48,
              borderRadius: 16,
              backgroundColor: "#bf1029",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "800" }}>{busy ? "Saving..." : "Complete Setup"}</Text>
          </Pressable>
        </View>
      </ScreenShell>
    );
  }

  if (!firebaseUser || !appUser) {
    return (
      <ScreenShell contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View style={{ borderRadius: 28, padding: 24, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "rgba(15, 39, 72, 0.12)", marginBottom: 18 }}>
          <Text style={{ fontSize: 34, fontWeight: "800", color: "#091729", marginBottom: 12 }}>WrestleWell</Text>
          <Text style={{ fontSize: 16, color: "#5f6d83", lineHeight: 24, marginBottom: 20 }}>
            Sign in on mobile to access your team roster, tournament workflow, and mat-side tools.
          </Text>

          <View style={{ flexDirection: "row", gap: 10, marginBottom: 18 }}>
            <Pressable onPress={() => setMode("sign_in")} style={pillButton(mode === "sign_in")}>
              <Text style={{ color: mode === "sign_in" ? "#fff" : "#0f2748", fontWeight: "800" }}>Sign In</Text>
            </Pressable>
            <Pressable onPress={() => setMode("sign_up")} style={pillButton(mode === "sign_up")}>
              <Text style={{ color: mode === "sign_up" ? "#fff" : "#0f2748", fontWeight: "800" }}>Create Account</Text>
            </Pressable>
          </View>

          <View style={{ gap: 14 }}>
            {mode === "sign_up" ? (
              <Field label="Display name">
                <TextInput
                  value={form.displayName}
                  onChangeText={(value) => updateField("displayName", value)}
                  style={inputStyle}
                  placeholder="Coach Miller"
                />
              </Field>
            ) : null}

            <Field label="Email">
              <TextInput
                value={form.email}
                onChangeText={(value) => updateField("email", value)}
                style={inputStyle}
                autoCapitalize="none"
                placeholder="coach@wrestlewell.com"
              />
            </Field>

            <Field label="Password">
              <TextInput
                value={form.password}
                onChangeText={(value) => updateField("password", value)}
                style={inputStyle}
                secureTextEntry
                placeholder="Enter password"
              />
            </Field>

            {mode === "sign_up" ? (
              <>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {(["coach", "athlete"] as UserRole[]).map((role) => (
                    <Pressable key={role} onPress={() => updateField("role", role)} style={pillButton(form.role === role)}>
                      <Text style={{ color: form.role === role ? "#fff" : "#0f2748", fontWeight: "800" }}>
                        {role === "coach" ? "Coach" : "Athlete"}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {form.role === "coach" ? (
                  <Field label="Team name">
                    <TextInput
                      value={form.teamName}
                      onChangeText={(value) => updateField("teamName", value)}
                      style={inputStyle}
                      placeholder="Bearcats Wrestling Club"
                    />
                  </Field>
                ) : (
                  <Field label="Team code">
                    <TextInput
                      value={form.teamCode}
                      onChangeText={(value) => updateField("teamCode", value)}
                      style={inputStyle}
                      placeholder="Coach team code"
                    />
                  </Field>
                )}
              </>
            ) : null}

            {error ? <Text style={{ color: "#911022" }}>{error}</Text> : null}

            <Pressable
              onPress={handleSubmit}
              style={{
                minHeight: 48,
                borderRadius: 16,
                backgroundColor: "#bf1029",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "800" }}>
                {busy ? "Working..." : mode === "sign_in" ? "Sign In" : "Create Account"}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <View
        style={{
          borderRadius: 28,
          padding: 24,
          backgroundColor: "#ffffff",
          borderWidth: 1,
          borderColor: "rgba(15, 39, 72, 0.12)",
          marginBottom: 18,
        }}
      >
        <Text style={{ fontSize: 34, fontWeight: "800", color: "#091729", marginBottom: 12 }}>
          Welcome back, {appUser.displayName}
        </Text>
        <Text style={{ fontSize: 16, color: "#5f6d83", lineHeight: 24, marginBottom: 20 }}>
          {appUser.role === "coach"
            ? "Your mobile coach workflow is ready for roster, tournaments, and mat-side decisions."
            : "Your athlete mobile view is ready for your profile, schedule prep, and personal mat-side reminders."}
        </Text>

        <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
          <View style={{ flexGrow: 1, minWidth: 130, borderRadius: 18, padding: 16, backgroundColor: "#0f2748" }}>
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "700" }}>ROLE</Text>
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 8 }}>{appUser.role}</Text>
          </View>
          <View style={{ flexGrow: 1, minWidth: 130, borderRadius: 18, padding: 16, backgroundColor: "#bf1029" }}>
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "700" }}>TEAM</Text>
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 8 }}>
              {currentTeam?.name || "No Team"}
            </Text>
          </View>
        </View>

        {isCoach && currentTeam?.teamCode ? (
          <View
            style={{
              marginTop: 12,
              borderRadius: 18,
              padding: 16,
              backgroundColor: "#ffffff",
              borderWidth: 1,
              borderColor: "rgba(15, 39, 72, 0.12)",
            }}
          >
            <Text style={{ color: "#5f6d83", fontSize: 12, fontWeight: "800" }}>TEAM CODE</Text>
            <Text style={{ color: "#091729", fontSize: 24, fontWeight: "800", marginTop: 8 }}>
              {currentTeam.teamCode}
            </Text>
            <Text style={{ color: "#5f6d83", fontSize: 14, lineHeight: 20, marginTop: 8 }}>
              Share this code with athletes so they can join your team.
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => signOut()}
          style={{
            marginTop: 16,
            alignSelf: "flex-start",
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 999,
            backgroundColor: "#e5e7eb",
          }}
        >
          <Text style={{ color: "#111827", fontWeight: "800" }}>Sign Out</Text>
        </Pressable>
      </View>

      <View style={{ gap: 14 }}>
        {homeActions.map((action) => (
          <Link key={action.href} href={action.href} asChild>
            <Pressable
              style={{
                borderWidth: 1,
                borderColor: "rgba(15, 39, 72, 0.12)",
                borderRadius: 22,
                padding: 20,
                backgroundColor: "#ffffff",
              }}
            >
              <Text style={{ fontSize: 24, fontWeight: "800", color: "#091729", marginBottom: 8 }}>
                {action.title}
              </Text>
              <Text style={{ fontSize: 15, color: "#5f6d83", lineHeight: 22 }}>
                {action.description}
              </Text>
              <Text style={{ marginTop: 14, fontSize: 14, fontWeight: "800", color: "#bf1029" }}>
                Open {action.title}
              </Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </ScreenShell>
  );
}
