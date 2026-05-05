import { router, usePathname } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useMobileAuthState } from "./auth-provider";

type MenuItem = {
  label: string;
  icon: string;
  href: string;
};

const coachMenuItems: MenuItem[] = [
  { label: "Home", icon: "WW", href: "/" },
  { label: "Plans", icon: "PL", href: "/practice-plans" },
  { label: "Schedule", icon: "SC", href: "/calendar" },
  { label: "Mat", icon: "MS", href: "/mat-side" },
  { label: "Alerts", icon: "AL", href: "/notifications" },
];

const athleteMenuItems: MenuItem[] = [
  { label: "Home", icon: "WW", href: "/" },
  { label: "Schedule", icon: "SC", href: "/calendar" },
  { label: "Events", icon: "EV", href: "/tournaments" },
  { label: "Profile", icon: "PR", href: "/wrestlers" },
  { label: "Alerts", icon: "AL", href: "/notifications" },
];

const parentMenuItems: MenuItem[] = [
  { label: "Home", icon: "WW", href: "/" },
  { label: "Schedule", icon: "SC", href: "/calendar" },
  { label: "Attend", icon: "AT", href: "/parent-attendance" },
  { label: "Events", icon: "EV", href: "/tournaments" },
  { label: "Alerts", icon: "AL", href: "/notifications" },
];

function getMenuItems(role?: string | null) {
  if (role === "parent") return parentMenuItems;
  if (role === "athlete") return athleteMenuItems;
  return coachMenuItems;
}

export function MobileMenu() {
  const pathname = usePathname();
  const { appUser } = useMobileAuthState();
  const menuItems = getMenuItems(appUser?.role);

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: "#142f4f",
        backgroundColor: "#030f1f",
        paddingTop: 8,
        paddingBottom: 18,
        paddingHorizontal: 8,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 5,
        }}
      >
        {menuItems.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));

          return (
            <Pressable
              key={item.href}
              onPress={() => router.push(item.href as any)}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 7,
                borderRadius: 18,
                backgroundColor: active
                  ? "#ffffff"
                  : pressed
                    ? "#12345a"
                    : "transparent",
                borderWidth: active ? 0 : 1,
                borderColor: active ? "transparent" : "rgba(147,197,253,0.12)",
              })}
            >
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: active ? "#061a33" : "#0b2542",
                  borderWidth: 1,
                  borderColor: active ? "#061a33" : "#21486e",
                  marginBottom: 4,
                }}
              >
                <Text
                  style={{
                    color: active ? "#ffffff" : "#93c5fd",
                    fontSize: 10,
                    fontWeight: "900",
                    letterSpacing: 0.4,
                  }}
                >
                  {item.icon}
                </Text>
              </View>

              <Text
                numberOfLines={1}
                style={{
                  color: active ? "#061a33" : "#dbeafe",
                  fontSize: 10,
                  fontWeight: "900",
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
