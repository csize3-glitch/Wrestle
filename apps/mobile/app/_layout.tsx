import { Slot } from "expo-router";
import { MobileAuthProvider } from "../components/auth-provider";
import { NotificationsProvider } from "../components/notifications-provider";

export default function RootLayout() {
  return (
    <MobileAuthProvider>
      <NotificationsProvider>
        <Slot />
      </NotificationsProvider>
    </MobileAuthProvider>
  );
}
