export const PILOT_SELF_SERVICE_ENABLED = false;

export const PILOT_ACCESS_MESSAGE =
  "WrestleWell pilot access is invite-only. Contact the pilot administrator for account or team-access changes.";

export function requirePilotSelfService(): void {
  if (!PILOT_SELF_SERVICE_ENABLED) {
    throw new Error(PILOT_ACCESS_MESSAGE);
  }
}
