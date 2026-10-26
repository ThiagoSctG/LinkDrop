import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Pairing } from "./api";
import { CheckIcon, CopyIcon } from "./icons";
import { t } from "./i18n";
import { formatClock, useNow } from "./time";

/** The QR timer warns once this little time is left before the code runs out. */
const QR_LOW_MS = 20_000;
/** How long the "phone connected" confirmation shows before it gives way. */
export const CONNECTED_MS = 900;

export type PairingDisplayProps = {
  /** The code on show, or null while a new one is being issued. */
  pairing: Pairing | null;
  /** The QR code for `pairing` as a data URI; empty until it is drawn. */
  qr: string;
  connected: boolean;
  connectedLabel?: string;
  /** A renewing code is replaced by a fresh one when it runs out; otherwise it just expires. */
  autoRenews?: boolean;
  error: boolean;
  onRetry: () => void;
};

/** A Pairing token's QR code with its countdown and a button to copy its link. */
export function PairingDisplay({
  pairing,
  qr,
  connected,
  connectedLabel,
  autoRenews = false,
  error,
  onRetry,
}: PairingDisplayProps): JSX.Element {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  useNow(1_000); // re-render every second so the countdown moves

  useEffect(() => {
    setCopyState("idle");
  }, [pairing]);

  const remainingMs = pairing ? Math.max(0, Date.parse(pairing.expiresAt) - Date.now()) : 0;
  const lifetimeMs = useMemo(() => (pairing ? Date.parse(pairing.expiresAt) - Date.now() : 0), [pairing]);

  const copyLink = async () => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.pairingUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <>
      <div className={connected ? "qr-frame qr-frame-connected" : qr ? "qr-frame qr-frame-ready" : "qr-frame"}>
        {connected && (
          <div className="qr-connected" role="status">
            <span className="qr-connected-mark" aria-hidden="true">
              <CheckIcon size={34} />
            </span>
            <strong>{connectedLabel ?? t("pairing.connected")}</strong>
          </div>
        )}
        {qr ? (
          <img src={qr} alt={t("pairing.qrAlt")} />
        ) : (
          <div className="qr-skeleton" role="status">
            <span className="visually-hidden">{t("pairing.generating")}</span>
          </div>
        )}
      </div>

      {/* A renewing code keeps its spent timer under the confirmation; one that only expires has nothing left to count. */}
      {pairing && lifetimeMs > 0 && (autoRenews || !connected) && (
        <p
          className={`qr-timer${remainingMs <= QR_LOW_MS ? " qr-timer-low" : ""}${connected ? " qr-timer-spent" : ""}`}
        >
          <progress max={lifetimeMs} value={remainingMs} aria-hidden="true" />
          <span>{t(autoRenews ? "pairing.renewsIn" : "pairing.expiresIn", { time: formatClock(remainingMs) })}</span>
        </p>
      )}

      {error ? (
        <div className="pairing-error" role="alert">
          <p>{t("pairing.unavailable")}</p>
          <button className="button button-secondary" type="button" onClick={onRetry}>
            {t("pairing.retry")}
          </button>
        </div>
      ) : (
        <>
          <button
            className="button button-secondary copy-link"
            type="button"
            onClick={() => void copyLink()}
            disabled={!pairing || connected}
          >
            {copyState === "copied" ? <CheckIcon /> : <CopyIcon />}
            {copyState === "copied"
              ? t("pairing.linkCopied")
              : copyState === "error"
                ? t("pairing.copyFailed")
                : t("pairing.copyLink")}
          </button>
        </>
      )}
    </>
  );
}
