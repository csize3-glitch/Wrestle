const NOTIFICATION_SEEN_PREFIX = "ww-notifications-last-seen";

function createSeenKey(userId: string, teamId: string, role: string) {
  return `${NOTIFICATION_SEEN_PREFIX}:${userId}:${teamId}:${role}`;
}

export function readLastSeenNotificationAt(userId: string, teamId: string, role: string): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(createSeenKey(userId, teamId, role)) || "";
}

export function markNotificationsSeen(userId: string, teamId: string, role: string, isoDate: string) {
  if (typeof window === "undefined" || !isoDate) {
    return;
  }

  window.localStorage.setItem(createSeenKey(userId, teamId, role), isoDate);
  window.dispatchEvent(
    new CustomEvent("ww-notifications-seen", {
      detail: { userId, teamId, role, isoDate },
    })
  );
}
