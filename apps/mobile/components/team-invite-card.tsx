import QRCode from "react-native-qrcode-svg";
import { Alert, Pressable, Share, Text, View } from "react-native";
import { WWBadge, WWCard } from "./mobile-screen-shell";

type InviteKind = "athlete" | "coach";

function createJoinUrl(kind: InviteKind, code: string) {
  const encodedCode = encodeURIComponent(code);

  if (kind === "coach") {
    return `wrestlewell://join?role=coach&coachInviteCode=${encodedCode}`;
  }

  return `wrestlewell://join?role=athlete&teamCode=${encodedCode}`;
}

export function TeamInviteCard({
  teamName,
  teamCode,
  coachInviteCode,
  compact = false,
}: {
  teamName: string;
  teamCode?: string;
  coachInviteCode?: string;
  compact?: boolean;
}) {
  const athleteCode = teamCode || "";
  const coachCode = coachInviteCode || "";

  async function shareInvite(kind: InviteKind) {
    const isCoach = kind === "coach";
    const code = isCoach ? coachCode : athleteCode;

    if (!code) {
      Alert.alert("Code missing", "This invite code is not set yet.");
      return;
    }

    const joinUrl = createJoinUrl(kind, code);

    const message = isCoach
      ? `Join ${teamName} on WrestleWell as a coach.\n\nCoach Invite Code: ${code}\n\nOpen this link on your phone:\n${joinUrl}`
      : `Join ${teamName} on WrestleWell as an athlete.\n\nTeam Code: ${code}\n\nOpen this link on your phone:\n${joinUrl}`;

    await Share.share({ message });
  }

  return (
    <WWCard>
      <View style={{ gap: 14 }}>
        <View>
          <WWBadge label="TEAM INVITES" tone="blue" />

          <Text
            style={{
              color: "#ffffff",
              fontSize: compact ? 22 : 26,
              fontWeight: "900",
              marginTop: 12,
              letterSpacing: -0.5,
            }}
          >
            Get your team on WrestleWell
          </Text>

          <Text
            style={{
              color: "#b7c9df",
              fontSize: 15,
              lineHeight: 22,
              marginTop: 7,
            }}
          >
            Athletes scan the team QR. Assistant coaches scan the coach QR. Both codes can also be shared by text.
          </Text>
        </View>

        <InvitePass
          label="Athlete Team Code"
          code={athleteCode || "Not set yet"}
          description="For wrestlers joining your team."
          tone="green"
          qrValue={athleteCode ? createJoinUrl("athlete", athleteCode) : ""}
          compact={compact}
          onShare={() => shareInvite("athlete")}
        />

        <InvitePass
          label="Coach Invite Code"
          code={coachCode || "Not set yet"}
          description="For assistant coaches joining your staff."
          tone="orange"
          qrValue={coachCode ? createJoinUrl("coach", coachCode) : ""}
          compact={compact}
          onShare={() => shareInvite("coach")}
        />
      </View>
    </WWCard>
  );
}

function InvitePass({
  label,
  code,
  description,
  tone,
  qrValue,
  compact,
  onShare,
}: {
  label: string;
  code: string;
  description: string;
  tone: "green" | "orange";
  qrValue: string;
  compact: boolean;
  onShare: () => void;
}) {
  const borderColor = tone === "green" ? "#166534" : "#9a3412";
  const backgroundColor = tone === "green" ? "#052e1b" : "#431407";
  const textColor = tone === "green" ? "#bbf7d0" : "#fed7aa";
  const buttonColor = tone === "green" ? "#16a34a" : "#ea580c";

  return (
    <View
      style={{
        borderRadius: 24,
        borderWidth: 1,
        borderColor,
        backgroundColor,
        padding: 14,
      }}
    >
      <View
        style={{
          flexDirection: compact ? "column" : "row",
          gap: 14,
          alignItems: compact ? "stretch" : "center",
        }}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: textColor,
              fontSize: 12,
              fontWeight: "900",
              letterSpacing: 0.8,
              marginBottom: 8,
            }}
          >
            {label.toUpperCase()}
          </Text>

          <Text
            selectable
            style={{
              color: "#ffffff",
              fontSize: compact ? 22 : 25,
              fontWeight: "900",
              letterSpacing: 1.2,
            }}
          >
            {code}
          </Text>

          <Text
            style={{
              color: textColor,
              fontSize: 13,
              lineHeight: 18,
              marginTop: 8,
            }}
          >
            {description}
          </Text>
        </View>

        <View
          style={{
            width: compact ? "100%" : 112,
            height: compact ? 170 : 112,
            borderRadius: 22,
            backgroundColor: "#ffffff",
            alignItems: "center",
            justifyContent: "center",
            padding: 10,
          }}
        >
          {qrValue ? (
            <>
              <QRCode value={qrValue} size={compact ? 128 : 92} />
              {compact ? (
                <Text
                  style={{
                    color: "#061a33",
                    fontSize: 11,
                    fontWeight: "900",
                    textAlign: "center",
                    marginTop: 8,
                  }}
                >
                  Scan to join
                </Text>
              ) : null}
            </>
          ) : (
            <Text
              style={{
                color: "#061a33",
                fontSize: 11,
                fontWeight: "900",
                textAlign: "center",
              }}
            >
              QR unavailable
            </Text>
          )}
        </View>
      </View>

      <Pressable
        onPress={onShare}
        style={({ pressed }) => ({
          marginTop: 14,
          backgroundColor: pressed ? "#ffffff" : buttonColor,
          borderRadius: 16,
          paddingVertical: 13,
          alignItems: "center",
        })}
      >
        {({ pressed }) => (
          <Text
            style={{
              color: pressed ? "#061a33" : "#ffffff",
              fontSize: 15,
              fontWeight: "900",
            }}
          >
            Share Invite
          </Text>
        )}
      </Pressable>
    </View>
  );
}