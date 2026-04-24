"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { db } from "@wrestlewell/firebase/client";
import { getAppUser, listTeamAnnouncements, listTeamNotifications } from "@wrestlewell/lib/index";
import { useAuthState } from "./auth-provider";
import { readLastSeenNotificationAt } from "./notifications-storage";

export function AuthNav() {
  const { appUser, currentTeam, firebaseUser, loading, signOut } = useAuthState();
  const [unreadCount, setUnreadCount] = useState(0);

  const notificationScope = useMemo(
    () =>
      firebaseUser?.uid && currentTeam?.id && appUser?.role
        ? {
            userId: firebaseUser.uid,
            teamId: currentTeam.id,
            role: appUser.role,
          }
        : null,
    [appUser?.role, currentTeam?.id, firebaseUser?.uid]
  );

  useEffect(() => {
    async function refreshUnreadCount() {
      if (!notificationScope) {
        setUnreadCount(0);
        return;
      }

      try {
        const [announcements, notifications] = await Promise.all([
          listTeamAnnouncements(db, notificationScope.teamId),
          listTeamNotifications(db, notificationScope.teamId, notificationScope.role),
        ]);
        const latestUser = await getAppUser(db, notificationScope.userId);

        const lastSeenAt =
          latestUser?.lastSeenNotificationsAt ||
          readLastSeenNotificationAt(
            notificationScope.userId,
            notificationScope.teamId,
            notificationScope.role
          );

        const unreadItems = [...announcements, ...notifications].filter(
          (item) => item.createdAt && (!lastSeenAt || item.createdAt > lastSeenAt)
        );
        setUnreadCount(unreadItems.length);
      } catch (error) {
        console.error("Failed to load unread notifications:", error);
      }
    }

    function handleSeenEvent() {
      refreshUnreadCount().catch((error) => {
        console.error("Failed to refresh unread notifications:", error);
      });
    }

    refreshUnreadCount().catch((error) => {
      console.error("Failed to load unread notifications:", error);
    });

    window.addEventListener("focus", handleSeenEvent);
    window.addEventListener("ww-notifications-seen", handleSeenEvent as EventListener);

    return () => {
      window.removeEventListener("focus", handleSeenEvent);
      window.removeEventListener("ww-notifications-seen", handleSeenEvent as EventListener);
    };
  }, [notificationScope]);

  if (loading) {
    return <div className="site-auth-pill">Checking session...</div>;
  }

  if (!firebaseUser) {
    return (
      <Link href="/" className="site-auth-pill site-auth-pill--ghost">
        Sign In
      </Link>
    );
  }

  return (
    <div className="site-auth-group">
      <Link href="/notifications" className="site-auth-pill site-auth-pill--ghost site-auth-pill--notification">
        <strong>Notifications</strong>
        {unreadCount > 0 ? <span className="site-auth-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : <span>No new</span>}
      </Link>

      <div className="site-auth-pill">
        <strong>{appUser?.displayName || firebaseUser.email || "Signed in"}</strong>
        <span>{currentTeam?.name || (appUser ? appUser.role : "Finish setup")}</span>
      </div>

      <button className="site-auth-pill site-auth-pill--ghost" onClick={() => signOut()}>
        Sign Out
      </button>
    </div>
  );
}
