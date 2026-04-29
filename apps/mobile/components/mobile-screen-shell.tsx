import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { MobileMenu } from "./mobile-menu";

export function MobileScreenShell({
  title,
  subtitle,
  eyebrow = "WRESTLEWELL",
  children,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: "#030f1f" }}>
      <View
        style={{
          position: "absolute",
          top: -120,
          right: -90,
          width: 260,
          height: 260,
          borderRadius: 130,
          backgroundColor: "rgba(191,16,41,0.22)",
        }}
      />

      <View
        style={{
          position: "absolute",
          top: 120,
          left: -120,
          width: 260,
          height: 260,
          borderRadius: 130,
          backgroundColor: "rgba(37,99,235,0.18)",
        }}
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingTop: 58,
          paddingBottom: 96,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            marginBottom: 18,
            borderRadius: 36,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: "rgba(147,197,253,0.22)",
            backgroundColor: "#061a33",
            shadowColor: "#000",
            shadowOpacity: 0.3,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 12 },
          }}
        >
          <View
            style={{
              height: 7,
              backgroundColor: "#bf1029",
            }}
          />

          <View style={{ padding: 20 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <View
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 18,
                  backgroundColor: "#ffffff",
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 2,
                  borderColor: "#bf1029",
                }}
              >
                <Text
                  style={{
                    color: "#061a33",
                    fontSize: 16,
                    fontWeight: "900",
                    letterSpacing: -1,
                  }}
                >
                  WW
                </Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: "#93c5fd",
                    fontSize: 11,
                    fontWeight: "900",
                    letterSpacing: 1.4,
                  }}
                >
                  {eyebrow}
                </Text>

                <Text
                  style={{
                    color: "#dbeafe",
                    fontSize: 13,
                    fontWeight: "800",
                    marginTop: 2,
                  }}
                >
                  Mat room command center
                </Text>
              </View>

              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: "rgba(191,16,41,0.18)",
                  borderWidth: 1,
                  borderColor: "rgba(248,113,113,0.35)",
                }}
              >
                <Text
                  style={{
                    color: "#fecaca",
                    fontSize: 11,
                    fontWeight: "900",
                  }}
                >
                  LIVE
                </Text>
              </View>
            </View>

            <Text
              style={{
                color: "#ffffff",
                fontSize: 37,
                lineHeight: 41,
                fontWeight: "900",
                letterSpacing: -1.2,
              }}
            >
              {title}
            </Text>

            {subtitle ? (
              <Text
                style={{
                  color: "#b7c9df",
                  fontSize: 16,
                  lineHeight: 23,
                  marginTop: 10,
                }}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>

        {children}
      </ScrollView>

      <MobileMenu />
    </View>
  );
}

export function WWCard({
  children,
  style,
}: {
  children: ReactNode;
  style?: object;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: "#061a33",
          borderWidth: 1,
          borderColor: "rgba(147,197,253,0.20)",
          borderRadius: 28,
          padding: 18,
          shadowColor: "#000",
          shadowOpacity: 0.2,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function WWBadge({
  label,
  tone = "blue",
}: {
  label: string;
  tone?: "blue" | "red" | "green" | "orange" | "white" | "dark";
}) {
  const badgeStyles = {
    blue: { bg: "#0b2542", border: "#315c86", text: "#93c5fd" },
    red: { bg: "#3b0a16", border: "#7f1d1d", text: "#fecaca" },
    green: { bg: "#052e1b", border: "#166534", text: "#bbf7d0" },
    orange: { bg: "#431407", border: "#9a3412", text: "#fed7aa" },
    white: { bg: "#ffffff", border: "#ffffff", text: "#061a33" },
    dark: { bg: "#030f1f", border: "#21486e", text: "#dbeafe" },
  }[tone];

  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 11,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: badgeStyles.bg,
        borderWidth: 1,
        borderColor: badgeStyles.border,
      }}
    >
      <Text
        style={{
          color: badgeStyles.text,
          fontSize: 11,
          fontWeight: "900",
          letterSpacing: 0.7,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function WWPrimaryButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 20,
        overflow: "hidden",
        backgroundColor: pressed ? "#991b1b" : "#bf1029",
      })}
    >
      <Text
        style={{
          color: "#ffffff",
          textAlign: "center",
          fontSize: 16,
          fontWeight: "900",
          paddingVertical: 16,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function WWStat({
  label,
  value,
  tone = "blue",
}: {
  label: string;
  value: string;
  tone?: "blue" | "red" | "green" | "orange";
}) {
  const accent =
    tone === "red"
      ? "#bf1029"
      : tone === "green"
        ? "#16a34a"
        : tone === "orange"
          ? "#ea580c"
          : "#2563eb";

  return (
    <View
      style={{
        flex: 1,
        minWidth: 92,
        borderRadius: 20,
        padding: 13,
        backgroundColor: "#0b2542",
        borderWidth: 1,
        borderColor: "#21486e",
      }}
    >
      <View
        style={{
          width: 34,
          height: 5,
          borderRadius: 999,
          backgroundColor: accent,
          marginBottom: 9,
        }}
      />

      <Text
        style={{
          color: "#93c5fd",
          fontSize: 11,
          fontWeight: "900",
          letterSpacing: 0.8,
        }}
      >
        {label.toUpperCase()}
      </Text>

      <Text
        numberOfLines={1}
        style={{
          color: "#ffffff",
          fontSize: 18,
          fontWeight: "900",
          marginTop: 4,
        }}
      >
        {value}
      </Text>
    </View>
  );
}