import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@wrestlewell/firebase/client";
import {
  getVarkCompletionPercent,
  scoreVarkAnswers,
  VARK_QUESTION_BANK,
  VARK_STYLE_DESCRIPTIONS,
  VARK_STYLE_LABELS,
  type VarkAnswerMap,
  type VarkStyle,
} from "@wrestlewell/lib/index";
import { COLLECTIONS } from "@wrestlewell/types/index";
import { useMobileAuthState } from "../components/auth-provider";
import {
  MobileScreenShell,
  WWBadge,
  WWCard,
} from "../components/mobile-screen-shell";

export default function VarkQuestionnaireScreen() {
  const { firebaseUser, appUser, refreshAppState, loading } = useMobileAuthState();

  const [answers, setAnswers] = useState<VarkAnswerMap>({});
  const [saving, setSaving] = useState(false);

  const completionPercent = useMemo(() => getVarkCompletionPercent(answers), [answers]);
  const scorePreview = useMemo(() => scoreVarkAnswers(answers), [answers]);

  const answeredCount = useMemo(
    () =>
      VARK_QUESTION_BANK.filter((question) => {
        return (answers[question.id] || []).length > 0;
      }).length,
    [answers]
  );

  const primaryLabel = VARK_STYLE_LABELS[scorePreview.primaryStyle];

  function toggleAnswer(questionId: string, optionId: string) {
    setAnswers((prev) => {
      const current = prev[questionId] || [];
      const selected = current.includes(optionId);

      return {
        ...prev,
        [questionId]: selected
          ? current.filter((id) => id !== optionId)
          : [...current, optionId],
      };
    });
  }

  async function handleComplete() {
    if (!firebaseUser?.uid) {
      Alert.alert("Sign in required", "Please sign in before saving your WrestleWellIQ profile.");
      return;
    }

    if (answeredCount < VARK_QUESTION_BANK.length) {
      Alert.alert(
        "Questionnaire incomplete",
        `Please answer all ${VARK_QUESTION_BANK.length} questions before finishing.`
      );
      return;
    }

    const result = scoreVarkAnswers(answers);

    try {
      setSaving(true);

      await updateDoc(doc(db, COLLECTIONS.USERS, firebaseUser.uid), {
        varkCompleted: true,
        varkProfile: {
          visual: result.visual,
          auditory: result.auditory,
          readingWriting: result.readingWriting,
          kinesthetic: result.kinesthetic,
          primaryStyle: result.primaryStyle,
          secondaryStyle: result.secondaryStyle || "",
          isMultimodal: result.isMultimodal,
          completedAt: serverTimestamp(),
        },
        varkAnswers: answers,
        updatedAt: serverTimestamp(),
      });

      await refreshAppState();

      Alert.alert(
        "WrestleWellIQ complete",
        `Your primary learning style is ${VARK_STYLE_LABELS[result.primaryStyle]}.`,
        [
          {
            text: "Continue",
            onPress: () => router.replace("/"),
          },
        ]
      );
    } catch (error: any) {
      console.error("Failed to save VARK questionnaire:", error);
      Alert.alert(
        "Save failed",
        error?.message || "There was a problem saving your WrestleWellIQ profile."
      );
    } finally {
      setSaving(false);
    }
  }

  if (!loading && (!firebaseUser || !appUser)) {
    return (
      <MobileScreenShell
        title="WrestleWellIQ"
        subtitle="Sign in to complete your athlete learning profile."
        eyebrow="ATHLETE SETUP"
      >
        <WWCard>
          <Text style={{ color: "#ffffff", fontSize: 24, fontWeight: "900" }}>
            Sign in required
          </Text>

          <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22, marginTop: 8 }}>
            You need an athlete account before completing the WrestleWellIQ questionnaire.
          </Text>

          <Pressable
            onPress={() => router.replace("/")}
            style={{
              marginTop: 16,
              alignSelf: "flex-start",
              borderRadius: 999,
              paddingHorizontal: 16,
              paddingVertical: 11,
              backgroundColor: "#bf1029",
            }}
          >
            <Text style={{ color: "#ffffff", fontWeight: "900" }}>Go Home</Text>
          </Pressable>
        </WWCard>
      </MobileScreenShell>
    );
  }

  if (appUser?.role === "coach") {
    return (
      <MobileScreenShell
        title="WrestleWellIQ"
        subtitle="This questionnaire is for athlete learning profiles."
        eyebrow="ATHLETE SETUP"
      >
        <WWCard>
          <Text style={{ color: "#ffffff", fontSize: 24, fontWeight: "900" }}>
            Coaches do not need this step
          </Text>

          <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22, marginTop: 8 }}>
            WrestleWellIQ is used to help coaches understand how each athlete learns best.
          </Text>

          <Pressable
            onPress={() => router.replace("/")}
            style={{
              marginTop: 16,
              alignSelf: "flex-start",
              borderRadius: 999,
              paddingHorizontal: 16,
              paddingVertical: 11,
              backgroundColor: "#bf1029",
            }}
          >
            <Text style={{ color: "#ffffff", fontWeight: "900" }}>Go Dashboard</Text>
          </Pressable>
        </WWCard>
      </MobileScreenShell>
    );
  }

  return (
    <MobileScreenShell
      title="WrestleWellIQ"
      subtitle="Complete your athlete learning profile so your coach can teach you the way you learn best."
      eyebrow="ATHLETE SETUP"
    >
      <View style={{ gap: 14 }}>
        <WWCard>
          <WWBadge label="LEARNING STYLE QUESTIONNAIRE" tone="red" />

          <Text
            style={{
              color: "#ffffff",
              fontSize: 28,
              fontWeight: "900",
              letterSpacing: -0.7,
              marginTop: 14,
            }}
          >
            How do you learn wrestling best?
          </Text>

          <Text style={{ color: "#b7c9df", fontSize: 15, lineHeight: 22, marginTop: 8 }}>
            Choose every answer that sounds like you. Some athletes learn one main way, and some
            are multimodal.
          </Text>

          <View
            style={{
              marginTop: 16,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: "#315c86",
              backgroundColor: "#0b2542",
              padding: 14,
            }}
          >
            <Text style={{ color: "#93c5fd", fontSize: 12, fontWeight: "900" }}>
              PROGRESS
            </Text>

            <Text style={{ color: "#ffffff", fontSize: 32, fontWeight: "900", marginTop: 6 }}>
              {completionPercent}%
            </Text>

            <Text style={{ color: "#b7c9df", fontSize: 14, marginTop: 4 }}>
              {answeredCount} of {VARK_QUESTION_BANK.length} questions answered
            </Text>
          </View>
        </WWCard>

        <WWCard>
          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "900" }}>
            Current preview
          </Text>

          <Text style={{ color: "#b7c9df", fontSize: 14, lineHeight: 21, marginTop: 8 }}>
            Based on your answers so far, your strongest style is:
          </Text>

          <Text style={{ color: "#ffffff", fontSize: 26, fontWeight: "900", marginTop: 10 }}>
            {primaryLabel}
          </Text>

          <Text style={{ color: "#93c5fd", fontSize: 14, lineHeight: 21, marginTop: 8 }}>
            {VARK_STYLE_DESCRIPTIONS[scorePreview.primaryStyle]}
          </Text>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            <ScorePill label="Visual" value={scorePreview.visual} tone="blue" />
            <ScorePill label="Auditory" value={scorePreview.auditory} tone="orange" />
            <ScorePill label="Read/Write" value={scorePreview.readingWriting} tone="green" />
            <ScorePill label="Kinesthetic" value={scorePreview.kinesthetic} tone="red" />
          </View>
        </WWCard>

        {VARK_QUESTION_BANK.map((question, index) => {
          const selectedOptionIds = answers[question.id] || [];

          return (
            <WWCard key={question.id}>
              <Text
                style={{
                  color: "#93c5fd",
                  fontSize: 12,
                  fontWeight: "900",
                  letterSpacing: 1,
                }}
              >
                QUESTION {index + 1} OF {VARK_QUESTION_BANK.length}
              </Text>

              <Text
                style={{
                  color: "#ffffff",
                  fontSize: 21,
                  lineHeight: 27,
                  fontWeight: "900",
                  marginTop: 10,
                }}
              >
                {question.question}
              </Text>

              {question.context ? (
                <Text style={{ color: "#b7c9df", fontSize: 14, lineHeight: 21, marginTop: 8 }}>
                  {question.context}
                </Text>
              ) : null}

              <View style={{ gap: 10, marginTop: 16 }}>
                {question.options.map((option) => {
                  const active = selectedOptionIds.includes(option.id);

                  return (
                    <Pressable
                      key={option.id}
                      onPress={() => toggleAnswer(question.id, option.id)}
                      style={{
                        borderRadius: 18,
                        borderWidth: 1,
                        borderColor: active ? "#bf1029" : "#315c86",
                        backgroundColor: active ? "#431407" : "#102f52",
                        padding: 14,
                      }}
                    >
                      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            borderWidth: 2,
                            borderColor: active ? "#fecaca" : "#93c5fd",
                            backgroundColor: active ? "#bf1029" : "transparent",
                            alignItems: "center",
                            justifyContent: "center",
                            marginTop: 1,
                          }}
                        >
                          {active ? (
                            <Text style={{ color: "#ffffff", fontSize: 12, fontWeight: "900" }}>
                              ✓
                            </Text>
                          ) : null}
                        </View>

                        <View style={{ flex: 1 }}>
                          <Text style={{ color: "#ffffff", fontSize: 15, lineHeight: 21 }}>
                            {option.text}
                          </Text>

                          <Text
                            style={{
                              color: active ? "#fecaca" : "#93c5fd",
                              fontSize: 12,
                              fontWeight: "900",
                              marginTop: 7,
                            }}
                          >
                            {VARK_STYLE_LABELS[option.style].toUpperCase()}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </WWCard>
          );
        })}

        <Pressable
          onPress={handleComplete}
          disabled={saving}
          style={({ pressed }) => ({
            borderRadius: 22,
            paddingVertical: 18,
            alignItems: "center",
            backgroundColor: saving ? "#64748b" : pressed ? "#991b1b" : "#bf1029",
          })}
        >
          <Text style={{ color: "#ffffff", fontSize: 18, fontWeight: "900" }}>
            {saving ? "Saving WrestleWellIQ..." : "Finish WrestleWellIQ Profile"}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => router.replace("/")}
          style={{
            borderRadius: 18,
            paddingVertical: 14,
            alignItems: "center",
            backgroundColor: "#102f52",
            borderWidth: 1,
            borderColor: "#315c86",
          }}
        >
          <Text style={{ color: "#ffffff", fontSize: 15, fontWeight: "900" }}>
            Skip for now
          </Text>
        </Pressable>
      </View>
    </MobileScreenShell>
  );
}

function ScorePill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "blue" | "red" | "green" | "orange";
}) {
  const color =
    tone === "red"
      ? "#fecaca"
      : tone === "green"
        ? "#bbf7d0"
        : tone === "orange"
          ? "#fed7aa"
          : "#93c5fd";

  const border =
    tone === "red"
      ? "#7f1d1d"
      : tone === "green"
        ? "#166534"
        : tone === "orange"
          ? "#9a3412"
          : "#315c86";

  const background =
    tone === "red"
      ? "#3b0a16"
      : tone === "green"
        ? "#052e1b"
        : tone === "orange"
          ? "#431407"
          : "#0b2542";

  return (
    <View
      style={{
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: background,
      }}
    >
      <Text style={{ color, fontSize: 12, fontWeight: "900" }}>
        {label}: {value}
      </Text>
    </View>
  );
}