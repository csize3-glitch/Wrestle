"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@wrestlewell/firebase/client";
import {
  listTeamMembers,
  regenerateCoachInviteCode,
  regenerateTeamCode,
  removeTeamMember,
  updateTeamMemberRole,
  updateTeamName,
} from "@wrestlewell/lib/index";
import type { TeamMemberRecord, UserRole } from "@wrestlewell/types/index";
import { useAuthState } from "../auth-provider";
import { RequireAuth } from "../require-auth";

function copyText(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return Promise.resolve(false);
  }

  return navigator.clipboard.writeText(value).then(() => true).catch(() => false);
}

function formatTeamActionError(error: unknown) {
  const baseMessage = error instanceof Error ? error.message : "Team update failed.";

  if (baseMessage.toLowerCase().includes("missing or insufficient permissions")) {
    return "Missing or insufficient permissions. If this is a new admin feature, deploy the latest Firestore rules and try again.";
  }

  return baseMessage;
}

export default function TeamPage() {
  const { appUser, currentTeam, refreshAppState } = useAuthState();
  const [members, setMembers] = useState<TeamMemberRecord[]>([]);
  const [teamName, setTeamName] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingTeam, setSavingTeam] = useState(false);
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<"team" | "coach" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isCoach = appUser?.role === "coach";
  const isOwner = Boolean(appUser && currentTeam && currentTeam.ownerUserId === appUser.id);

  const coachCount = useMemo(
    () => members.filter((member) => member.role === "coach").length,
    [members]
  );
  const athleteCount = useMemo(
    () => members.filter((member) => member.role === "athlete").length,
    [members]
  );

  useEffect(() => {
    setTeamName(currentTeam?.name || "");
  }, [currentTeam?.name]);

  useEffect(() => {
    async function loadMembers() {
      if (!currentTeam?.id || !isCoach) {
        setMembers([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setMembers(await listTeamMembers(db, { teamId: currentTeam.id, ownerUserId: currentTeam.ownerUserId }));
      } catch (nextError) {
        console.error("Failed to load team members:", nextError);
        setError(nextError instanceof Error ? nextError.message : "Failed to load team members.");
      } finally {
        setLoading(false);
      }
    }

    loadMembers();
  }, [currentTeam?.id, currentTeam?.ownerUserId, isCoach]);

  async function reloadTeamPage() {
    if (!currentTeam?.id) {
      setMembers([]);
      return;
    }

    await refreshAppState();
    setMembers(await listTeamMembers(db, { teamId: currentTeam.id, ownerUserId: currentTeam.ownerUserId }));
  }

  async function handleCopy(field: "team" | "coach", value?: string) {
    if (!value) {
      return;
    }

    const copied = await copyText(value);
    if (!copied) {
      return;
    }

    setCopiedField(field);
    window.setTimeout(() => setCopiedField(null), 1800);
  }

  async function handleSaveTeamName() {
    if (!currentTeam?.id || !isOwner) {
      return;
    }

    setSavingTeam(true);
    setError(null);
    setSuccess(null);

    try {
      await updateTeamName(db, currentTeam.id, teamName);
      await refreshAppState();
      setSuccess("Team name updated.");
    } catch (nextError) {
      console.error("Failed to update team name:", nextError);
      setError(formatTeamActionError(nextError));
    } finally {
      setSavingTeam(false);
    }
  }

  async function handleRegenerateCode(kind: "team" | "coach") {
    if (!currentTeam?.id || !isOwner) {
      return;
    }

    setSavingTeam(true);
    setError(null);
    setSuccess(null);

    try {
      if (kind === "team") {
        await regenerateTeamCode(db, currentTeam.id);
      } else {
        await regenerateCoachInviteCode(db, currentTeam.id);
      }

      await refreshAppState();
      setSuccess(kind === "team" ? "Team code refreshed." : "Coach invite code refreshed.");
    } catch (nextError) {
      console.error("Failed to regenerate code:", nextError);
      setError(formatTeamActionError(nextError));
    } finally {
      setSavingTeam(false);
    }
  }

  async function handleRoleChange(member: TeamMemberRecord, role: UserRole) {
    if (member.isOwner || member.role === role) {
      return;
    }

    setActiveMemberId(member.id);
    setError(null);
    setSuccess(null);

    try {
      await updateTeamMemberRole(db, member, role);
      await reloadTeamPage();
      setSuccess(`${member.displayName} is now a ${role}.`);
    } catch (nextError) {
      console.error("Failed to update team role:", nextError);
      setError(nextError instanceof Error ? nextError.message : "Failed to update member role.");
    } finally {
      setActiveMemberId(null);
    }
  }

  async function handleRemove(member: TeamMemberRecord) {
    if (member.isOwner) {
      return;
    }

    const confirmed = window.confirm(`Remove ${member.displayName} from ${currentTeam?.name || "this team"}?`);
    if (!confirmed) {
      return;
    }

    setActiveMemberId(member.id);
    setError(null);
    setSuccess(null);

    try {
      await removeTeamMember(db, member);
      await reloadTeamPage();
      setSuccess(`${member.displayName} was removed from the team.`);
    } catch (nextError) {
      console.error("Failed to remove team member:", nextError);
      setError(nextError instanceof Error ? nextError.message : "Failed to remove team member.");
    } finally {
      setActiveMemberId(null);
    }
  }

  return (
    <RequireAuth
      title="Team"
      description="Coach tools for managing staff access, athlete membership, and your team identity."
    >
      <main style={{ padding: 24, display: "grid", gap: 24 }}>
        <section className="hero-panel">
          <div className="hero-panel__inner" style={{ gridTemplateColumns: "1.2fr 0.95fr" }}>
            <div>
              <div className="eyebrow">Team management</div>
              <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 4vw, 3.2rem)" }}>
                Manage your coaching staff and athlete roster in one place.
              </h1>
              <p className="hero-copy">
                Share codes with the right people, promote assistants, and keep your team structure clean as the season grows.
              </p>
            </div>

            <div className="hero-side">
              <div className="stat-card stat-card--accent">
                <span className="stat-card__label">Coaches</span>
                <span className="stat-card__value">{coachCount}</span>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">Athletes</span>
                <span className="stat-card__value">{athleteCount}</span>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">Team</span>
                <span className="stat-card__value" style={{ fontSize: "1.45rem" }}>
                  {currentTeam?.name || "No team linked"}
                </span>
              </div>
            </div>
          </div>
        </section>

        {!isCoach ? (
          <section className="content-card">
            <h2 className="content-card__title">Coach access required</h2>
            <p className="content-card__copy">
              Team administration is available to coaches. Athletes can still use the roster, calendar, tournaments, and practice workflow from the main navigation.
            </p>
          </section>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "0.95fr 1.05fr", gap: 24 }}>
              <section className="content-card">
                <h2 className="content-card__title">Team profile</h2>
                <p className="content-card__copy">
                  Keep the team identity clean and make it easy for athletes and assistant coaches to join the right place.
                </p>

                <div className="form-grid" style={{ marginTop: 20 }}>
                  <label className="field-label">
                    Team name
                    <input
                      value={teamName}
                      onChange={(event) => setTeamName(event.target.value)}
                      disabled={!isOwner || savingTeam}
                      placeholder="United Wrestling Club"
                    />
                  </label>

                  <div className="field-grid">
                    <div className="content-card" style={{ padding: 18, borderRadius: 18 }}>
                      <h3 className="content-card__title" style={{ marginBottom: 8 }}>
                        Athlete Team Code
                      </h3>
                      <p className="content-card__copy" style={{ marginBottom: 14 }}>
                        {currentTeam?.teamCode || "Not available yet"}
                      </p>
                      <div className="hero-actions" style={{ marginTop: 0 }}>
                        <button
                          className="button-secondary"
                          type="button"
                          onClick={() => handleCopy("team", currentTeam?.teamCode)}
                          disabled={!currentTeam?.teamCode}
                        >
                          {copiedField === "team" ? "Copied" : "Copy Code"}
                        </button>
                        {isOwner ? (
                          <button
                            className="button-secondary"
                            type="button"
                            onClick={() => handleRegenerateCode("team")}
                            disabled={savingTeam}
                          >
                            Refresh
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="content-card" style={{ padding: 18, borderRadius: 18 }}>
                      <h3 className="content-card__title" style={{ marginBottom: 8 }}>
                        Coach Invite Code
                      </h3>
                      <p className="content-card__copy" style={{ marginBottom: 14 }}>
                        {currentTeam?.coachInviteCode || "Not available yet"}
                      </p>
                      <div className="hero-actions" style={{ marginTop: 0 }}>
                        <button
                          className="button-secondary"
                          type="button"
                          onClick={() => handleCopy("coach", currentTeam?.coachInviteCode)}
                          disabled={!currentTeam?.coachInviteCode}
                        >
                          {!currentTeam?.coachInviteCode
                            ? "Generate Code"
                            : copiedField === "coach"
                              ? "Copied"
                              : "Copy Code"}
                        </button>
                        {isOwner ? (
                          <button
                            className="button-secondary"
                            type="button"
                            onClick={() => handleRegenerateCode("coach")}
                            disabled={savingTeam}
                          >
                            {currentTeam?.coachInviteCode ? "Refresh" : "Generate"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {isOwner ? (
                    <div className="hero-actions" style={{ marginTop: 0 }}>
                      <button className="button-primary" type="button" onClick={handleSaveTeamName} disabled={savingTeam}>
                        {savingTeam ? "Saving..." : "Save Team Profile"}
                      </button>
                    </div>
                  ) : (
                    <p className="content-card__copy" style={{ marginTop: 0 }}>
                      Assistant coaches can manage members, but only the team owner can rename the team or refresh join codes.
                    </p>
                  )}
                </div>
              </section>

              <section className="content-card">
                <h2 className="content-card__title">How coach access works</h2>
                <p className="content-card__copy">
                  Share the coach invite code with assistant coaches. Once they join, you can promote or demote roles and keep the active staff list under control here.
                </p>

                <div className="feature-list" style={{ marginTop: 18 }}>
                  <span>Head coach stays protected and cannot be demoted or removed.</span>
                  <span>Assistant coaches can manage day-to-day roster access without creating a separate team.</span>
                  <span>Removing a member disconnects them from this team without deleting their WrestleWell account.</span>
                </div>
              </section>
            </div>

            {error ? <p style={{ color: "#911022", margin: 0 }}>{error}</p> : null}
            {success ? <p style={{ color: "#0f5b2b", margin: 0 }}>{success}</p> : null}

            <section className="content-card">
              <h2 className="content-card__title">Team roster and staff</h2>
              <p className="content-card__copy">
                Review everyone currently linked to this team and manage access inline.
              </p>

              <div style={{ display: "grid", gap: 16, marginTop: 22 }}>
                {loading ? (
                  <p style={{ margin: 0 }}>Loading team members...</p>
                ) : members.length === 0 ? (
                  <p style={{ margin: 0 }}>No team members linked yet.</p>
                ) : (
                  members.map((member) => {
                    const memberBusy = activeMemberId === member.id;
                    return (
                      <article
                        key={member.id}
                        className="content-card"
                        style={{
                          padding: 20,
                          borderRadius: 20,
                          boxShadow: "none",
                          display: "grid",
                          gap: 14,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: 16,
                            flexWrap: "wrap",
                          }}
                        >
                          <div>
                            <h3 className="content-card__title" style={{ marginBottom: 6 }}>
                              {member.displayName}
                            </h3>
                            <p className="content-card__copy" style={{ marginBottom: 6 }}>
                              {member.email || "No email on file"}
                            </p>
                            <div className="hero-actions" style={{ marginTop: 0 }}>
                              <span className="eyebrow" style={{ marginBottom: 0 }}>
                                {member.isOwner ? "Head Coach" : member.role === "coach" ? "Coach" : "Athlete"}
                              </span>
                              {member.currentTeamId !== currentTeam?.id ? (
                                <span className="eyebrow" style={{ marginBottom: 0, background: "rgba(15, 39, 72, 0.08)", color: "#0f2748" }}>
                                  Inactive Link
                                </span>
                              ) : null}
                            </div>
                          </div>

                          {member.isOwner ? (
                            <p className="content-card__copy" style={{ margin: 0, maxWidth: 280 }}>
                              The team owner keeps permanent control of the team profile and invite system.
                            </p>
                          ) : (
                            <div className="hero-actions" style={{ marginTop: 0 }}>
                              <button
                                className={member.role === "coach" ? "button-primary" : "button-secondary"}
                                type="button"
                                onClick={() => handleRoleChange(member, "coach")}
                                disabled={memberBusy}
                              >
                                Make Coach
                              </button>
                              <button
                                className={member.role === "athlete" ? "button-primary" : "button-secondary"}
                                type="button"
                                onClick={() => handleRoleChange(member, "athlete")}
                                disabled={memberBusy}
                              >
                                Make Athlete
                              </button>
                              <button
                                className="button-secondary"
                                type="button"
                                onClick={() => handleRemove(member)}
                                disabled={memberBusy}
                                style={{ borderColor: "rgba(191, 16, 41, 0.28)", color: "#911022" }}
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </RequireAuth>
  );
}
