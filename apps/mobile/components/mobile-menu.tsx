import { router, usePathname } from "expo-router";
import { Pressable, Text, View } from "react-native";

const menuItems = [
  { label: "Home", icon: "WW", href: "/" },
  { label: "Plans", icon: "PL", href: "/practice-plans" },
  { label: "Schedule", icon: "SC", href: "/calendar" },
  { label: "Roster", icon: "RT", href: "/wrestlers" },
  { label: "Mat", icon: "MS", href: "/mat-side" },
  { label: "Alerts", icon: "AL", href: "/notifications" },
];

export function MobileMenu() {
  const pathname = usePathname();

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