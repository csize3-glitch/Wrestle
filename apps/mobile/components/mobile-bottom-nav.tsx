import { router, usePathname } from "expo-router";
import { Pressable, Text, View } from "react-native";

const navItems = [
  {
    label: "Home",
    href: "/",
    icon: "⌂",
  },
  {
    label: "Practice",
    href: "/practice-plans",
    icon: "⏱",
  },
  {
    label: "Calendar",
    href: "/calendar",
    icon: "▦",
  },
  {
    label: "Roster",
    href: "/wrestlers",
    icon: "◉",
  },
  {
    label: "Alerts",
    href: "/notifications",
    icon: "!",
  },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <View
      style={{
        position: "absolute",
        left: 14,
        right: 14,
        bottom: 18,
        borderRadius: 28,
        backgroundColor: "#061a33",
        borderWidth: 1,
        borderColor: "#21486e",
        paddingHorizontal: 8,
        paddingVertical: 8,
        flexDirection: "row",
        justifyContent: "space-between",
        shadowColor: "#000",
        shadowOpacity: 0.22,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 12,
      }}
    >
      {navItems.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

        return (
          <Pressable
            key={item.href}
            onPress={() => router.push(item.href as any)}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 22,
              paddingVertical: 8,
              backgroundColor: active
                ? "#bf1029"
                : pressed
                  ? "#102f52"
                  : "transparent",
            })}
          >
            <Text
              style={{
                color: active ? "#ffffff" : "#93c5fd",
                fontSize: 18,
                fontWeight: "900",
                lineHeight: 20,
              }}
            >
              {item.icon}
            </Text>

            <Text
              numberOfLines={1}
              style={{
                color: active ? "#ffffff" : "#b7c9df",
                fontSize: 10,
                fontWeight: "900",
                marginTop: 2,
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}