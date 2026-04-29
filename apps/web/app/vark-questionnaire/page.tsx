"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@wrestlewell/firebase/client";
import {
  getVarkCompletionPercent,
  scoreVarkAnswers,
  VARK_QUESTION_BANK,
  VARK_STYLE_DESCRIPTIONS,
  VARK_STYLE_LABELS,
  type VarkAnswerMap,
} from "@wrestlewell/lib/index";
import { COLLECTIONS } from "@wrestlewell/types/index";
import { useAuthState } from "../auth-provider";

function getAnsweredCount(answers: VarkAnswerMap) {
  return VARK_QUESTION_BANK.filter((question) => {
    return (answers[question.id] || []).length > 0;
  }).length;
}

export default function VarkQuestionnairePage() {
  const router = useRouter();
  const { firebaseUser, appUser, loading, refreshAppState } = useAuthState();

  const [answers, setAnswers] = useState<VarkAnswerMap>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completionPercent = useMemo(() => getVarkCompletionPercent(answers), [answers]);
  const scorePreview = useMemo(() => scoreVarkAnswers(answers), [answers]);
  const answeredCount = useMemo(() => getAnsweredCount(answers), [answers]);

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
      setError("Please sign in before saving your WrestleIQ profile.");
      return;
    }

    if (appUser?.role !== "athlete") {
      setError("WrestleIQ is only required for athlete accounts.");
      return;
    }

    if (answeredCount < VARK_QUESTION_BANK.length) {
      setError(`Please answer all ${VARK_QUESTION_BANK.length} questions before finishing.`);
      return;
    }

    const result = scoreVarkAnswers(answers);

    try {
      setSaving(true);
      setError(null);

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
      router.replace("/");
    } catch (nextError) {
      console.error("Failed to save WrestleIQ questionnaire:", nextError);
      setError(nextError instanceof Error ? nextError.message : "Failed to save WrestleIQ.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="content-card">
        <h1 className="content-card__title">Loading WrestleIQ</h1>
        <p className="content-card__copy">Checking your athlete setup...</p>
      </div>
    );
  }

  if (!firebaseUser || !appUser) {
    return (
      <div className="dashboard-grid">
        <section className="content-card">
          <div className="eyebrow">WrestleIQ</div>
          <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 4vw, 3.2rem)" }}>
            Sign in required.
          </h1>
          <p className="hero-copy">
            You need to sign in before completing your athlete learning profile.
          </p>

          <div className="hero-actions">
            <Link href="/" className="button-primary">
              Go to Sign In
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (appUser.role === "coach") {
    return (
      <div className="dashboard-grid">
        <section className="content-card">
          <div className="eyebrow">Coach account</div>
          <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 4vw, 3.2rem)" }}>
            WrestleIQ is for athletes.
          </h1>
          <p className="hero-copy">
            Coaches do not need to complete the athlete learning style questionnaire.
          </p>

          <div className="hero-actions">
            <Link href="/" className="button-primary">
              Back to Dashboard
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="dashboard-grid">
      <section className="hero-panel">
        <div className="hero-panel__inner">
          <div>
            <div className="eyebrow">Athlete setup</div>

            <h1 className="hero-title" style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
              Complete your WrestleIQ profile.
            </h1>

            <p className="hero-copy">
              Choose every answer that sounds like you. This helps coaches understand how you learn
              technique, corrections, match strategy, and practice details best.
            </p>

            <div className="hero-actions">
              <button className="button-primary" onClick={handleComplete} disabled={saving}>
                {saving ? "Saving..." : "Finish WrestleIQ"}
              </button>

              <Link href="/" className="button-secondary">
                Back
              </Link>
            </div>

            {error ? (
              <p style={{ color: "#911022", fontWeight: 800, marginTop: 16 }}>{error}</p>
            ) : null}
          </div>

          <div className="hero-side">
            <div className="stat-card stat-card--accent">
              <span className="stat-card__label">Progress</span>
              <span className="stat-card__value">{completionPercent}%</span>
              <p className="stat-card__copy">
                {answeredCount} of {VARK_QUESTION_BANK.length} questions answered.
              </p>
            </div>

            <div className="stat-card">
              <span className="stat-card__label">Current Preview</span>
              <span className="stat-card__value" style={{ fontSize: "1.5rem" }}>
                {VARK_STYLE_LABELS[scorePreview.primaryStyle]}
              </span>
              <p className="stat-card__copy">
                {VARK_STYLE_DESCRIPTIONS[scorePreview.primaryStyle]}
              </p>
            </div>

            <div className="stat-card">
              <span className="stat-card__label">Scores</span>
              <div className="feature-list" style={{ marginTop: 12 }}>
                <span>Visual: {scorePreview.visual}</span>
                <span>Auditory: {scorePreview.auditory}</span>
                <span>Read/Write: {scorePreview.readingWriting}</span>
                <span>Kinesthetic: {scorePreview.kinesthetic}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside className="dashboard-stack">
        {VARK_QUESTION_BANK.map((question, index) => {
          const selectedOptionIds = answers[question.id] || [];

          return (
            <div key={question.id} className="content-card">
              <div className="eyebrow">
                Question {index + 1} of {VARK_QUESTION_BANK.length}
              </div>

              <h2 className="content-card__title">{question.question}</h2>

              {question.context ? (
                <p className="content-card__copy">{question.context}</p>
              ) : null}

              <div className="feature-list" style={{ gap: 10 }}>
                {question.options.map((option) => {
                  const active = selectedOptionIds.includes(option.id);

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggleAnswer(question.id, option.id)}
                      className={active ? "content-card" : ""}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        borderRadius: 18,
                        border: active ? "2px solid #bf1029" : "1px solid rgba(15, 39, 72, 0.18)",
                        background: active ? "#fff5f6" : "#ffffff",
                        padding: 14,
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          color: "#0f2748",
                          fontWeight: 900,
                          lineHeight: 1.35,
                        }}
                      >
                        {active ? "✓ " : ""}
                        {option.text}
                      </span>

                      <span
                        style={{
                          display: "block",
                          color: active ? "#bf1029" : "#64748b",
                          fontWeight: 900,
                          fontSize: 12,
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          marginTop: 8,
                        }}
                      >
                        {VARK_STYLE_LABELS[option.style]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="content-card">
          <h2 className="content-card__title">Finish setup</h2>
          <p className="content-card__copy">
            Once every question is answered, save your WrestleIQ profile and continue to your
            athlete dashboard.
          </p>

          {error ? <p style={{ color: "#911022", fontWeight: 800 }}>{error}</p> : null}

          <div className="hero-actions">
            <button className="button-primary" onClick={handleComplete} disabled={saving}>
              {saving ? "Saving..." : "Finish WrestleIQ"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}