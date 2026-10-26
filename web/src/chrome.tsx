import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { t } from "./i18n";
import { BrandIcon, CheckIcon, AlertIcon, MoonIcon, SunIcon, UndoIcon } from "./icons";
import { useModal } from "./modal";
import { saveTheme } from "./storage";

type Theme = "light" | "dark";

/** The logo. It links home only on the screen: on a phone, "/" is the screen's page. */
function Brand({ homeLink = true }: { homeLink?: boolean }) {
  const content = (
    <>
      <span className="brand-mark" aria-hidden="true">
        <BrandIcon />
      </span>
      <span>LinkDrop</span>
    </>
  );
  return homeLink ? (
    <a className="brand" aria-label={t("brand.home")} href="/">
      {content}
    </a>
  ) : (
    <span className="brand">{content}</span>
  );
}

function currentTheme(): Theme {
  const applied = document.documentElement.dataset.theme;
  if (applied === "light" || applied === "dark") return applied;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const next: Theme = theme === "light" ? "dark" : "light";
  const label = next === "dark" ? t("theme.useDark") : t("theme.useLight");
  const toggle = () => {
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    saveTheme(next);
    setTheme(next);
  };
  return (
    <button className="icon-button" type="button" onClick={toggle} aria-label={label} title={label}>
      {theme === "light" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

export function TopBar({ homeLink, children }: { homeLink?: boolean; children?: ComponentChildren }) {
  return (
    <div className="topbar">
      <Brand homeLink={homeLink} />
      <div className="topbar-actions">
        {children}
        <ThemeToggle />
      </div>
    </div>
  );
}

export function StatusPill({ children }: { children: ComponentChildren }) {
  return (
    <p className="status-pill">
      <span aria-hidden="true" />
      {children}
    </p>
  );
}

const LOW_TIME_MS = 5 * 60_000;

const RING_RADIUS = 7;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export function SessionTimer({
  remainingMs,
  totalMs,
  onRenew,
  renewing,
}: {
  remainingMs: number;
  totalMs: number;
  onRenew?: () => void;
  renewing?: boolean;
}) {
  const label =
    remainingMs < 60_000
      ? t("session.lessThanMinute")
      : t("session.minutesLeft", { minutes: Math.ceil(remainingMs / 60_000) });
  const left = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
  const isLow = remainingMs <= LOW_TIME_MS;

  return (
    <button
      type="button"
      className={isLow ? "session-timer session-timer-low" : "session-timer"}
      title={t("session.timerHelp")}
      onClick={onRenew}
      disabled={renewing}
    >
      <svg className="timer-ring" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <circle className="timer-ring-track" cx="9" cy="9" r={RING_RADIUS} />
        {/* Starts at 12 o'clock and drains clockwise. */}
        <circle
          className="timer-ring-value"
          cx="9"
          cy="9"
          r={RING_RADIUS}
          transform="rotate(-90 9 9)"
          stroke-dasharray={RING_LENGTH}
          stroke-dashoffset={RING_LENGTH * (1 - left)}
        />
        <path className="timer-ring-hands" d="M9 5.5V9l2.25 1.5" />
      </svg>
      <span className="visually-hidden">{t("session.keepAlive")} — </span>
      <span>{label}</span>
      {isLow && <span className="session-timer-renew">{t("session.renew")}</span>}
    </button>
  );
}

export type ToastAction = { label: string; onClick: () => void };

export function Toast({ text, error, action }: { text: string; error: boolean; action?: ToastAction }) {
  return (
    <div className={error ? "toast toast-error" : "toast"}>
      <span className="toast-text" role="status">
        {error ? <AlertIcon size={16} /> : <CheckIcon size={16} />}
        {text}
      </span>
      {action && (
        <button className="toast-action" type="button" onClick={action.onClick}>
          <UndoIcon size={16} />
          {action.label}
        </button>
      )}
    </div>
  );
}

type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const { dialog, initialFocus, backdropProps } = useModal(onCancel);

  return (
    <div className="dialog-backdrop" {...backdropProps}>
      <div
        ref={dialog}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-message"
      >
        <h2 id="dialog-title">{title}</h2>
        <p id="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button className="button button-secondary" type="button" ref={initialFocus} onClick={onCancel}>
            {t("dialog.cancel")}
          </button>
          <button className="button button-danger" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
