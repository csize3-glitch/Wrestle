import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

export function ScreenShell({
  children,
  contentContainerStyle,
}: {
  children: ReactNode;
  contentContainerStyle?: object;
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.background}>
        <View style={styles.outerCircle} />
        <View style={styles.innerCircle} />
        <View style={styles.centerCircle} />
        <View style={styles.redLane} />
        <View style={styles.blueLane} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, contentContainerStyle]}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#eef3fb",
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    backgroundColor: "#eef3fb",
  },
  outerCircle: {
    position: "absolute",
    width: 720,
    height: 720,
    borderRadius: 360,
    borderWidth: 14,
    borderColor: "rgba(15, 39, 72, 0.11)",
    top: -140,
    left: -180,
  },
  innerCircle: {
    position: "absolute",
    width: 420,
    height: 420,
    borderRadius: 210,
    borderWidth: 12,
    borderColor: "rgba(191, 16, 41, 0.12)",
    top: 12,
    right: -110,
  },
  centerCircle: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 10,
    borderColor: "rgba(15, 39, 72, 0.08)",
    top: 230,
    left: "50%",
    marginLeft: -90,
  },
  redLane: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 18,
    borderColor: "rgba(191, 16, 41, 0.08)",
    bottom: -70,
    left: -30,
  },
  blueLane: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    borderWidth: 18,
    borderColor: "rgba(15, 39, 72, 0.08)",
    bottom: 50,
    right: -90,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
});
