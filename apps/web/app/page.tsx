"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "@wrestlewell/firebase/client";
import {
  completeAccountSetup,
  listWrestlers,
  registerAccount,
  signInAccount,
} from "@wrestlewell/lib/index";
import { COLLECTIONS, type UserRole } from "@wrestlewell/types/index";
import { useAuthState } from "./auth-provider";

type AuthMode = "sign_in" | "sign_up";

type AuthFormState = {
  displayName: string;
  email: string;
  password: string;
  role: UserRole;
  teamName: string;
  teamCode: string;
  coachInviteCode: string;
};

function createInitialAuthForm(): AuthFormState {
  return {
    displayName: "",
    email: "",
    password: "",
    role: "coach",
    teamName: "",
    teamCode: "",
    coachInviteCode: "",
  };
}

const dashboardCards = [
  {
    title: "Team Management",
    href: "/team",
    copy: "Manage assistant coaches, athlete membership, and team join codes from one admin view.",
  },
  {
    title: "Roster",
    href: "/wrestlers",
    copy: "Manage shared wrestler profiles, style notes, and mat-side summaries.",
  },
  {
    title: "Practice Plans",
    href: "/practice-plans",
    copy: "Build and organize sessions from your technique library.",
  },
  {
    title: "Calendar",
    href: "/calendar",
    copy: "Assign plans across the week and keep training organized.",
  },
];

const athleteCards = [
  {
    title: "Upcoming Practices",
    href: "/calendar",
    copy: "See what is scheduled next for your team and stay ready for the week.",
  },
  {
    title: "Technique Library",
    href: "/library",
    copy: "Review the shared technique catalog and study the right style work.",
  },
  {
    title: "Tournament Hub",
    href: "/tournaments",
    copy: "Open official tournament registration links and season event details.",
  },
];

type UpcomingPractice = {
  id: string;
  date: string;
  practicePlanId: string;
  practicePlanTitle: string;
  practicePlanStyle: string;
  totalMinutes: number;
  totalSeconds?: number;
  notes?: string;
};

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

export default function HomePage() {
  const { firebaseUser, appUser, currentTeam, loading, refreshAppState } = useAuthState();
  const [mode, setMode] = useState<AuthMode>("sign_in");
  const [form, setForm] = useState<AuthFormState>(createInitialAuthForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teamCodeCopied, setTeamCodeCopied] = useState(false);
  const [upcomingPractices, setUpcomingPractices] = useState<UpcomingPractice[]>([]);
  const [rosterCount, setRosterCount] = useState(0);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const needsSetup = Boolean(firebaseUser && !appUser);
  const isCoach = appUser?.role === "coach";

  const heroStats = useMemo(
    () => [
      { label: "Current Mode", value: appUser ? appUser.role : needsSetup ? "Setup" : "Guest" },
      { label: "Team", value: currentTeam?.name || (isCoach ? "Create your team" : "Join a team") },
      { label: "Account", value: firebaseUser?.email || "Not signed in" },
    ],
    [appUser, currentTeam, firebaseUser, isCoach, needsSetup]
  );
  const homeCards = appUser?.role === "athlete" ? athleteCards : dashboardCards;
  const athleteHighlights = useMemo(
    () => [
      {
        label: "Next Session",
        value: upcomingPractices[0]
          ? `${formatPracticeDate(upcomingPractices[0].date)}`
          : currentTeam
            ? "No practice scheduled"
            : "Join a team",
      },
      {
        label: "Team Roster",
        value: currentTeam ? `${rosterCount} wrestler${rosterCount === 1 ? "" : "s"}` : "Not linked",
      },
      {
        label: "Focus",
        value: upcomingPractices[0]?.practicePlanStyle || "Stay ready",
      },
    ],
    [currentTeam, upcomingPractices, rosterCount]
  );

  function updateField<K extends keyof AuthFormState>(field: K, value: AuthFormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function copyTeamCode() {
    if (!currentTeam?.teamCode || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(currentTeam.teamCode);
    setTeamCodeCopied(true);
    window.setTimeout(() => setTeamCodeCopied(false), 2000);
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
          coachInviteCode: form.role === "coach" ? form.coachInviteCode : undefined,
        });
      }

      await refreshAppState();
    } catch (nextError) {
      console.error("Authentication failed:", nextError);
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
        coachInviteCode: form.role === "coach" ? form.coachInviteCode : undefined,
      });
      await refreshAppState();
    } catch (nextError) {
      console.error("Account setup failed:", nextError);
      setError(nextError instanceof Error ? nextError.message : "Account setup failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    async function loadDashboardData() {
      if (!currentTeam?.id || !appUser) {
        setUpcomingPractices([]);
        setRosterCount(0);
        return;
      }

      try {
        setDashboardLoading(true);

        const [roster, eventSnapshot] = await Promise.all([
          listWrestlers(db, currentTeam.id),
          getDocs(query(collection(db, COLLECTIONS.CALENDAR_EVENTS), where("teamId", "==", currentTeam.id))),
        ]);

        const todayKey = new Date().toISOString().split("T")[0];
        const nextEvents = eventSnapshot.docs
          .map((doc) => ({
            id: doc.id,
            ...(doc.data() as Omit<UpcomingPractice, "id">),
          }))
          .filter((event) => event.date >= todayKey)
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 3);

        setRosterCount(roster.length);
        setUpcomingPractices(nextEvents);
      } catch (nextError) {
        console.error("Failed to load dashboard data:", nextError);
        setUpcomingPractices([]);
      } finally {
        setDashboardLoading(false);
      }
    }

    loadDashboardData();
  }, [appUser, currentTeam?.id]);

  if (loading) {
    return (
      <div className="content-card">
        <h1 className="content-card__title">Loading WrestleWell</h1>
        <p className="content-card__copy">Checking your session and team setup...</p>
      </div>
    );
  }

  if (needsSetup) {
    return (
      <div className="dashboard-grid">
        <section className="content-card">
          <div className="eyebrow">Finish account setup</div>
          <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 4vw, 3.2rem)" }}>
            Choose your role and team setup.
          </h1>
          <p className="hero-copy">
            Your Firebase account exists. Now we need to create your WrestleWell role, team link,
            and roster ownership model.
          </p>

          <div className="form-grid" style={{ marginTop: 24 }}>
            <label className="field-label">
              Display name
              <input
                value={form.displayName}
                onChange={(e) => updateField("displayName", e.target.value)}
                placeholder="Coach Miller"
              />
            </label>

            <div className="role-toggle">
              {(["coach", "athlete"] as UserRole[]).map((role) => (
                <button
                  key={role}
                  className={form.role === role ? "is-active" : ""}
                  onClick={() => updateField("role", role)}
                  type="button"
                >
                  {role === "coach" ? "Coach" : "Athlete"}
                </button>
              ))}
            </div>

            {form.role === "coach" ? (
              <div className="field-grid">
                <label className="field-label">
                  Team name
                  <input
                    value={form.teamName}
                    onChange={(e) => updateField("teamName", e.target.value)}
                    placeholder="Bearcats Wrestling Club"
                  />
                </label>

                <label className="field-label">
                  Coach invite code
                  <input
                    value={form.coachInviteCode}
                    onChange={(e) => updateField("coachInviteCode", e.target.value)}
                    placeholder="Optional existing coach invite code"
                  />
                </label>
              </div>
            ) : (
              <label className="field-label">
                Team code
                <input
                  value={form.teamCode}
                  onChange={(e) => updateField("teamCode", e.target.value)}
                  placeholder="Optional coach team code"
                />
              </label>
            )}

            {error ? <p style={{ color: "#911022", margin: 0 }}>{error}</p> : null}

            <div className="hero-actions" style={{ marginTop: 4 }}>
              <button className="button-primary" onClick={handleSetupSubmit} disabled={busy}>
                {busy ? "Saving..." : "Complete Setup"}
              </button>
            </div>
          </div>
        </section>

        <aside className="dashboard-stack">
          {heroStats.map((item) => (
            <div key={item.label} className="content-card">
              <h2 className="content-card__title">{item.label}</h2>
              <p className="content-card__copy">{item.value}</p>
            </div>
          ))}
        </aside>
      </div>
    );
  }

  if (!firebaseUser || !appUser) {
    return (
      <div className="dashboard-grid">
        <section className="hero-panel">
          <div className="hero-panel__inner">
            <div>
              <div className="eyebrow">Coach and athlete access</div>
              <h1 className="hero-title">Sign in to unlock your roster, team, and training workflow.</h1>
              <p className="hero-copy">
                WrestleWell now supports real account roles. Coaches get roster ownership and team
                management, while athletes get a personal lane into their own development and prep.
              </p>

              <div className="role-toggle" style={{ marginTop: 26 }}>
                <button
                  className={mode === "sign_in" ? "is-active" : ""}
                  onClick={() => setMode("sign_in")}
                  type="button"
                >
                  Sign In
                </button>
                <button
                  className={mode === "sign_up" ? "is-active" : ""}
                  onClick={() => setMode("sign_up")}
                  type="button"
                >
                  Create Account
                </button>
              </div>

              <div className="form-grid" style={{ marginTop: 22 }}>
                {mode === "sign_up" ? (
                  <label className="field-label">
                    Display name
                    <input
                      value={form.displayName}
                      onChange={(e) => updateField("displayName", e.target.value)}
                      placeholder="Coach Miller"
                    />
                  </label>
                ) : null}

                <div className="field-grid">
                  <label className="field-label">
                    Email
                    <input
                      value={form.email}
                      onChange={(e) => updateField("email", e.target.value)}
                      placeholder="coach@wrestlewell.com"
                    />
                  </label>

                  <label className="field-label">
                    Password
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => updateField("password", e.target.value)}
                      placeholder="Enter password"
                    />
                  </label>
                </div>

                {mode === "sign_up" ? (
                  <>
                    <div className="role-toggle">
                      {(["coach", "athlete"] as UserRole[]).map((role) => (
                        <button
                          key={role}
                          className={form.role === role ? "is-active" : ""}
                          onClick={() => updateField("role", role)}
                          type="button"
                        >
                          {role === "coach" ? "Coach" : "Athlete"}
                        </button>
                      ))}
                    </div>

                    {form.role === "coach" ? (
                      <div className="field-grid">
                        <label className="field-label">
                          Team name
                          <input
                            value={form.teamName}
                            onChange={(e) => updateField("teamName", e.target.value)}
                            placeholder="Bearcats Wrestling Club"
                          />
                        </label>

                        <label className="field-label">
                          Coach invite code
                          <input
                            value={form.coachInviteCode}
                            onChange={(e) => updateField("coachInviteCode", e.target.value)}
                            placeholder="Optional existing coach invite code"
                          />
                        </label>
                      </div>
                    ) : (
                      <label className="field-label">
                        Team code
                        <input
                          value={form.teamCode}
                          onChange={(e) => updateField("teamCode", e.target.value)}
                          placeholder="Optional coach team code"
                        />
                      </label>
                    )}
                  </>
                ) : null}

                {error ? <p style={{ color: "#911022", margin: 0 }}>{error}</p> : null}

                <div className="hero-actions" style={{ marginTop: 4 }}>
                  <button className="button-primary" onClick={handleSubmit} disabled={busy}>
                    {busy
                      ? "Working..."
                      : mode === "sign_in"
                        ? "Sign In to WrestleWell"
                        : "Create WrestleWell Account"}
                  </button>
                </div>
              </div>
            </div>

            <div className="hero-side">
              <div className="stat-card">
                <span className="stat-card__label">Coach Path</span>
                <span className="stat-card__value">Team Owner</span>
                <p className="stat-card__copy">
                  Build your roster, assign plans, manage practice flow, and prep athletes for match day.
                </p>
              </div>

              <div className="stat-card stat-card--accent">
                <span className="stat-card__label">Athlete Path</span>
                <span className="stat-card__value">Personal View</span>
                <p className="stat-card__copy">
                  Join a team, track your development, and view role-specific prep and goals.
                </p>
              </div>
            </div>
          </div>
        </section>

        <aside className="dashboard-stack">
          {dashboardCards.map((card) => (
            <div key={card.title} className="content-card">
              <h2 className="content-card__title">{card.title}</h2>
              <p className="content-card__copy">{card.copy}</p>
            </div>
          ))}
        </aside>
      </div>
    );
  }

  return (
    <div className="dashboard-grid">
      <section className="hero-panel">
        <div className="hero-panel__inner">
          <div>
            <div className="eyebrow">{appUser.role === "coach" ? "Coach dashboard" : "Athlete dashboard"}</div>
            <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 4vw, 3.4rem)" }}>
              Welcome back, {appUser.displayName}.
            </h1>
            <p className="hero-copy">
              {appUser.role === "coach"
                ? "Your team hub is live. From here you can manage the roster, shape practice, and prep the mat-side workflow."
                : "Your athlete account is active. Check upcoming practices, review team resources, and stay connected to your season workflow."}
            </p>

            <div className="hero-actions">
              <Link href={appUser.role === "coach" ? "/team" : "/wrestlers"} className="button-primary">
                {appUser.role === "coach" ? "Open Team Management" : "View Team Roster"}
              </Link>
              <Link href={appUser.role === "coach" ? "/wrestlers" : "/practice-plans"} className="button-secondary">
                {appUser.role === "coach" ? "Open Roster" : "Review Practice Plans"}
              </Link>
            </div>
          </div>

          <div className="hero-side">
            {(appUser.role === "athlete" ? athleteHighlights : heroStats).map((item) => (
              <div key={item.label} className={`stat-card${item.label === "Team" ? " stat-card--accent" : ""}`}>
                <span className="stat-card__label">{item.label}</span>
                <span className="stat-card__value" style={{ fontSize: "1.5rem" }}>
                  {item.value}
                </span>
              </div>
            ))}

            {appUser.role === "coach" && currentTeam?.teamCode ? (
              <div className="stat-card stat-card--accent">
                <span className="stat-card__label">Team Code</span>
                <span className="stat-card__value" style={{ fontSize: "1.8rem", letterSpacing: "0.08em" }}>
                  {currentTeam.teamCode}
                </span>
                <p className="stat-card__copy" style={{ marginBottom: 12 }}>
                  Share this code with athletes so they can join your team.
                </p>
                <button className="button-secondary" onClick={copyTeamCode} type="button">
                  {teamCodeCopied ? "Copied" : "Copy Team Code"}
                </button>
              </div>
            ) : null}

            {appUser.role === "coach" && currentTeam?.coachInviteCode ? (
              <div className="stat-card">
                <span className="stat-card__label">Coach Invite Code</span>
                <span className="stat-card__value" style={{ fontSize: "1.45rem", letterSpacing: "0.04em" }}>
                  {currentTeam.coachInviteCode}
                </span>
                <p className="stat-card__copy" style={{ marginBottom: 0 }}>
                  Share this with assistant coaches so they can join the same team as coaches.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <aside className="dashboard-stack">
        {homeCards.map((card) => (
          <Link key={card.title} href={card.href} className="content-card">
            <h2 className="content-card__title">{card.title}</h2>
            <p className="content-card__copy">{card.copy}</p>
          </Link>
        ))}

        <div className="content-card">
          <h2 className="content-card__title">
            {appUser.role === "coach" ? "Upcoming Practices" : "Your Team Schedule"}
          </h2>
          <p className="content-card__copy">
            {appUser.role === "coach"
              ? "Check the next scheduled sessions so practice flow and calendar stay aligned."
              : "See the next sessions coming up for your team and stay ready."}
          </p>

          <div className="feature-list">
            {dashboardLoading ? (
              <span>Loading upcoming practices...</span>
            ) : upcomingPractices.length === 0 ? (
              <span>No upcoming practices scheduled yet.</span>
            ) : (
              upcomingPractices.map((event) => (
                <span key={event.id}>
                  {formatPracticeDate(event.date)}: {event.practicePlanTitle || "Untitled plan"} •{" "}
                  {event.practicePlanStyle || "Mixed"} •{" "}
                  {formatDurationLabel(event.totalSeconds || event.totalMinutes * 60 || 0)}
                </span>
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
