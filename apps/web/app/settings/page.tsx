"use client";

import { useEffect, useState } from "react";
import { db } from "@wrestlewell/firebase/client";
import {
  updateTeamBranding,
  updateTeamPracticeSettings,
  updateUserNotificationPreferences,
} from "@wrestlewell/lib/index";
import type { NotificationPreferences } from "@wrestlewell/types/index";
import { useAuthState } from "../auth-provider";
import { RequireAuth } from "../require-auth";

function createDefaultPreferences(): NotificationPreferences {
  return {
    announcements: true,
    tournamentAlerts: true,
    practiceReminders: true,
  };
}

export default function SettingsPage() {
  const { appUser, currentTeam, refreshAppState } = useAuthState();
  const [preferences, setPreferences] = useState<NotificationPreferences>(createDefaultPreferences);
  const [teamName, setTeamName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);
  const [savingPracticeSettings, setSavingPracticeSettings] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [practiceSettings, setPracticeSettings] = useState({
    practiceCheckInEnabled: true,
    athleteCheckInEnabled: true,
    parentCheckInEnabled: true,
    coachCanOverrideAttendance: true,
    attendanceRequiredForCloseout: false,
    showAttendanceToAthletes: true,
    showAttendanceToParents: true,
  });

  const isOwner = Boolean(appUser && currentTeam && currentTeam.ownerUserId === appUser.id);

  useEffect(() => {
    setPreferences(appUser?.notificationPreferences || createDefaultPreferences());
  }, [appUser?.notificationPreferences]);

  useEffect(() => {
    setTeamName(currentTeam?.name || "");
    setLogoUrl(currentTeam?.logoUrl || "");
  }, [currentTeam?.logoUrl, currentTeam?.name]);

  useEffect(() => {
    setPracticeSettings({
      practiceCheckInEnabled: currentTeam?.practiceCheckInEnabled !== false,
      athleteCheckInEnabled: currentTeam?.athleteCheckInEnabled !== false,
      parentCheckInEnabled: currentTeam?.parentCheckInEnabled !== false,
      coachCanOverrideAttendance: currentTeam?.coachCanOverrideAttendance !== false,
      attendanceRequiredForCloseout: currentTeam?.attendanceRequiredForCloseout === true,
      showAttendanceToAthletes: currentTeam?.showAttendanceToAthletes !== false,
      showAttendanceToParents: currentTeam?.showAttendanceToParents !== false,
    });
  }, [
    currentTeam?.practiceCheckInEnabled,
    currentTeam?.athleteCheckInEnabled,
    currentTeam?.parentCheckInEnabled,
    currentTeam?.coachCanOverrideAttendance,
    currentTeam?.attendanceRequiredForCloseout,
    currentTeam?.showAttendanceToAthletes,
    currentTeam?.showAttendanceToParents,
  ]);

  async function savePreferences() {
    if (!appUser) {
      return;
    }

    setSavingPrefs(true);
    setMessage(null);

    try {
      await updateUserNotificationPreferences(db, appUser.id, preferences);
      await refreshAppState();
      setMessage("Notification preferences updated.");
    } catch (error) {
      console.error("Failed to update preferences:", error);
      setMessage("Failed to update notification preferences.");
    } finally {
      setSavingPrefs(false);
    }
  }

  async function saveBranding() {
    if (!currentTeam?.id || !isOwner) {
      return;
    }

    setSavingBranding(true);
    setMessage(null);

    try {
      await updateTeamBranding(db, currentTeam.id, { name: teamName, logoUrl });
      await refreshAppState();
      setMessage("Team branding updated.");
    } catch (error) {
      console.error("Failed to update team branding:", error);
      setMessage("Failed to update team branding.");
    } finally {
      setSavingBranding(false);
    }
  }

  async function savePracticeSettings() {
    if (!currentTeam?.id || !isOwner) {
      return;
    }

    setSavingPracticeSettings(true);
    setMessage(null);

    try {
      await updateTeamPracticeSettings(db, currentTeam.id, practiceSettings);
      await refreshAppState();
      setMessage("Practice-day settings updated.");
    } catch (error) {
      console.error("Failed to update practice settings:", error);
      setMessage("Failed to update practice-day settings.");
    } finally {
      setSavingPracticeSettings(false);
    }
  }

  return (
    <RequireAuth
      title="Settings"
      description="Manage your team identity and personal notification preferences."
    >
      <main style={{ padding: 24, display: "grid", gap: 24 }}>
        <section className="hero-panel">
          <div className="hero-panel__inner" style={{ gridTemplateColumns: "1.2fr 0.95fr" }}>
            <div>
              <div className="eyebrow">Settings</div>
              <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 4vw, 3.2rem)" }}>
                Tune your team identity and notification flow.
              </h1>
              <p className="hero-copy">
                Keep branding clean, decide which alerts matter most, and make WrestleWell feel more like your actual program.
              </p>
            </div>

            <div className="hero-side">
              <div className="stat-card stat-card--accent">
                <span className="stat-card__label">Current Team</span>
                <span className="stat-card__value" style={{ fontSize: "1.4rem" }}>
                  {currentTeam?.name || "No team"}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">Role</span>
                <span className="stat-card__value" style={{ fontSize: "1.4rem" }}>
                  {appUser?.role || "Guest"}
                </span>
              </div>
            </div>
          </div>
        </section>

        {message ? (
          <section className="content-card">
            <p className="content-card__copy" style={{ marginBottom: 0 }}>
              {message}
            </p>
          </section>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <section className="content-card">
            <h2 className="content-card__title">Notification preferences</h2>
            <p className="content-card__copy">
              Choose what matters most in your team workflow.
            </p>

            <div className="form-grid" style={{ marginTop: 18 }}>
              {[
                ["announcements", "Coach announcements"],
                ["tournamentAlerts", "Tournament registration alerts"],
                ["practiceReminders", "Practice reminders"],
              ].map(([key, label]) => (
                <label
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={preferences[key as keyof NotificationPreferences]}
                    onChange={(event) =>
                      setPreferences((prev) => ({
                        ...prev,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}

              <div className="hero-actions" style={{ marginTop: 0 }}>
                <button className="button-primary" onClick={savePreferences} disabled={savingPrefs}>
                  {savingPrefs ? "Saving..." : "Save Preferences"}
                </button>
              </div>
            </div>
          </section>

          <section className="content-card">
            <h2 className="content-card__title">Team branding</h2>
            <p className="content-card__copy">
              Give your team a cleaner identity inside the platform.
            </p>

            {!isOwner ? (
              <p className="content-card__copy" style={{ marginTop: 18 }}>
                Only the team owner can change branding.
              </p>
            ) : (
              <div className="form-grid" style={{ marginTop: 18 }}>
                <label className="field-label">
                  Team name
                  <input value={teamName} onChange={(e) => setTeamName(e.target.value)} />
                </label>

                <label className="field-label">
                  Logo URL
                  <input
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </label>

                {logoUrl ? (
                  <div
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 18,
                      padding: 16,
                      background: "#f8fafc",
                    }}
                  >
                    <div style={{ fontSize: 12, textTransform: "uppercase", color: "#64748b", marginBottom: 10 }}>
                      Logo Preview
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUrl}
                      alt={`${teamName || "Team"} logo`}
                      style={{ maxWidth: 120, maxHeight: 120, objectFit: "contain", borderRadius: 14 }}
                    />
                  </div>
                ) : null}

                <div className="hero-actions" style={{ marginTop: 0 }}>
                  <button className="button-primary" onClick={saveBranding} disabled={savingBranding}>
                    {savingBranding ? "Saving..." : "Save Branding"}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        <section className="content-card">
          <h2 className="content-card__title">Practice-day attendance controls</h2>
          <p className="content-card__copy">
            Decide who can check in, whether attendance is required before closeout, and how much athletes and parents can see.
          </p>

          {!isOwner ? (
            <p className="content-card__copy" style={{ marginTop: 18 }}>
              Only the team owner can change practice-day settings.
            </p>
          ) : (
            <div
              style={{
                marginTop: 18,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 14,
              }}
            >
              {[
                ["practiceCheckInEnabled", "Practice-day check-in enabled"],
                ["athleteCheckInEnabled", "Athletes can check themselves in"],
                ["parentCheckInEnabled", "Parents can check in linked wrestlers"],
                ["coachCanOverrideAttendance", "Coaches can override attendance"],
                ["attendanceRequiredForCloseout", "Attendance required before closeout"],
                ["showAttendanceToAthletes", "Show attendance status to athletes"],
                ["showAttendanceToParents", "Show attendance status to parents"],
              ].map(([key, label]) => (
                <label
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "14px 16px",
                    borderRadius: 16,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={practiceSettings[key as keyof typeof practiceSettings]}
                    onChange={(event) =>
                      setPracticeSettings((prev) => ({
                        ...prev,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}

              <div className="hero-actions" style={{ marginTop: 0, gridColumn: "1 / -1" }}>
                <button
                  className="button-primary"
                  onClick={savePracticeSettings}
                  disabled={savingPracticeSettings}
                >
                  {savingPracticeSettings ? "Saving..." : "Save Practice Settings"}
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </RequireAuth>
  );
}
