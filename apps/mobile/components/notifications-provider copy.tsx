"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import { db } from "@wrestlewell/firebase/client";
import { upsertPushRegistration } from "@wrestlewell/lib/index";
import { useMobileAuthState } from "./auth-provider";

const EXPO_PROJECT_ID = "d27873ba-78af-4020-8900-b701311cf9c3";

type ExpoNotificationsModule = typeof import("expo-notifications");

let notificationsModulePromise: Promise<ExpoNotificationsModule> | null = null;

async function getNotificationsModule() {
  if (!notificationsModulePromise) {
    notificationsModulePromise = import("expo-notifications");
  }

  return notificationsModulePromise;
}

type NotificationsContextValue = {
  permissionStatus: string;
  expoPushToken: string | null;
  registered: boolean;
  error: string | null;
  scheduleLocalTestNotification: (args?: { title?: string; body?: string }) => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { firebaseUser, appUser, currentTeam } = useMobileAuthState();
  const [permissionStatus, setPermissionStatus] = useState("unknown");
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function register() {
      if (!firebaseUser || !appUser || !currentTeam?.id) {
        setRegistered(false);
        return;
      }

      try {
        if (!Device.isDevice) {
          setPermissionStatus("unsupported");
          setError("Push registration needs a physical device. Local notification testing is disabled on this target.");
          await upsertPushRegistration(db, {
            userId: firebaseUser.uid,
            teamId: currentTeam.id,
            userRole: appUser.role,
            notificationPreferences: appUser.notificationPreferences,
            platform: Platform.OS,
            permissionsStatus: "unsupported",
            deviceName: Device.modelName || Device.deviceName || "Simulator or Mac target",
          });
          setRegistered(true);
          return;
        }

        const Notifications = await getNotificationsModule();

        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });

        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "default",
            importance: Notifications.AndroidImportance.MAX,
          });
        }

        const existing = await Notifications.getPermissionsAsync();
        let finalStatus = existing.status;

        if (existing.status !== "granted") {
          const requested = await Notifications.requestPermissionsAsync();
          finalStatus = requested.status;
        }

        setPermissionStatus(finalStatus);

        if (finalStatus !== "granted") {
          setError("Notification permission is not granted on this device yet.");
        await upsertPushRegistration(db, {
          userId: firebaseUser.uid,
          teamId: currentTeam.id,
          userRole: appUser.role,
          notificationPreferences: appUser.notificationPreferences,
          platform: Platform.OS,
          permissionsStatus: finalStatus,
          deviceName: Device.modelName || Device.deviceName || "Unknown device",
          });
          setRegistered(true);
          return;
        }

        const deviceToken = await Notifications.getDevicePushTokenAsync();
        let nextExpoPushToken: string | undefined;

        try {
          nextExpoPushToken = (await Notifications.getExpoPushTokenAsync({
            projectId: EXPO_PROJECT_ID,
          })).data;
          setExpoPushToken(nextExpoPushToken);
          setError(null);
        } catch (tokenError) {
          console.error("Failed to fetch Expo push token:", tokenError);
          setError(
            "Expo push token is not available yet. A development build or project push setup may still be needed."
          );
        }

        await upsertPushRegistration(db, {
          userId: firebaseUser.uid,
          teamId: currentTeam.id,
          userRole: appUser.role,
          notificationPreferences: appUser.notificationPreferences,
          platform: Platform.OS,
          permissionsStatus: finalStatus,
          expoPushToken: nextExpoPushToken,
          devicePushToken:
            deviceToken && "data" in deviceToken ? String(deviceToken.data) : undefined,
          deviceName: Device.modelName || Device.deviceName || "Unknown device",
        });

        setRegistered(true);
      } catch (nextError) {
        console.error("Failed to register mobile notifications:", nextError);
        setError(nextError instanceof Error ? nextError.message : "Notification setup failed.");
      }
    }

    register().catch((nextError) => {
      console.error("Mobile notification registration crashed:", nextError);
      setError(nextError instanceof Error ? nextError.message : "Notification setup failed.");
    });
  }, [appUser, currentTeam?.id, firebaseUser]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      permissionStatus,
      expoPushToken,
      registered,
      error,
      scheduleLocalTestNotification: async (args) => {
        const Notifications = await getNotificationsModule();
        await Notifications.scheduleNotificationAsync({
          content: {
            title: args?.title || "WrestleWell reminder",
            body: args?.body || "Your test reminder is working on this device.",
            sound: true,
          },
          trigger: null,
        });
      },
    }),
    [error, expoPushToken, permissionStatus, registered]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotificationsState() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotificationsState must be used within NotificationsProvider");
  }

  return context;
}
