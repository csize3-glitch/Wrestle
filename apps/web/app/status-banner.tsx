"use client";

type StatusTone = "success" | "error" | "info";

export type StatusMessage = {
  tone: StatusTone;
  text: string;
};

const toneStyles: Record<StatusTone, { border: string; background: string; color: string }> = {
  success: {
    border: "rgba(27, 94, 32, 0.18)",
    background: "#eef9f0",
    color: "#1b5e20",
  },
  error: {
    border: "rgba(145, 16, 34, 0.18)",
    background: "#fff1f3",
    color: "#911022",
  },
  info: {
    border: "rgba(15, 39, 72, 0.14)",
    background: "#f4f7fb",
    color: "#0f2748",
  },
};

export function StatusBanner({
  message,
  onDismiss,
}: {
  message: StatusMessage;
  onDismiss?: () => void;
}) {
  const palette = toneStyles[message.tone];

  return (
    <div
      style={{
        marginBottom: 18,
        padding: "12px 14px",
        borderRadius: 12,
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "center",
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1.5 }}>{message.text}</span>
      {onDismiss ? (
        <button
          onClick={onDismiss}
          style={{
            border: "none",
            background: "transparent",
            color: palette.color,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
