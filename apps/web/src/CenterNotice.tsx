import { useEffect } from "react";
import { createPortal } from "react-dom";

export type NoticeVariant = "error" | "ok";

interface Props {
  text: string | null;
  variant?: NoticeVariant;
  /** Auto-hide after ms; 0 = stay until dismiss */
  durationMs?: number;
  onClose: () => void;
}

/** Centered framed toast with outlined label — errors & short notices. */
export function CenterNotice({
  text,
  variant = "error",
  durationMs = 3400,
  onClose,
}: Props) {
  useEffect(() => {
    if (!text || durationMs <= 0) return;
    const id = window.setTimeout(onClose, durationMs);
    return () => window.clearTimeout(id);
  }, [text, durationMs, onClose]);

  if (!text) return null;

  return createPortal(
    <div
      className={`center-notice center-notice-${variant}`}
      role={variant === "error" ? "alert" : "status"}
      aria-live="assertive"
      onClick={onClose}
    >
      <div className="center-notice-frame" onClick={(e) => e.stopPropagation()}>
        <p className="center-notice-text">{text}</p>
        <button
          type="button"
          className="center-notice-dismiss"
          onClick={onClose}
          aria-label="ОК"
        >
          ОК
        </button>
      </div>
    </div>,
    document.body,
  );
}
