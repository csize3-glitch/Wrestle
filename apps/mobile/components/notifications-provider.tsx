import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type NotificationsContextValue = {
  permissionStatus: string;
  expoPushToken: string | null;
  registered: boolean;
  error: string | null;
  scheduleLocalTestNotification: (args?: { title?: string; body?: string }) => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [permissionStatus] = useState("disabled-for-local-ios-dev");
  const [expoPushToken] = useState<string | null>(null);
  const [registered] = useState(false);
  const [error] = useState<string | null>(
    "Push notifications are disabled for this local iPhone development build."
  );

  const value = useMemo<NotificationsContextValue>(
    () => ({
      permissionStatus,
      expoPushToken,
      registered,
      error,
      scheduleLocalTestNotification: async () => {
        console.log("Local notification test skipped in local iOS dev build.");
      },
    }),
    [error, expoPushToken, permissionStatus, registered]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotificationsState() {
  const context = useContext(NotificationsContext);

  if (!context) {
    throw new Error("useNotificationsState must be used within NotificationsProvider");
  }

  return context;
}