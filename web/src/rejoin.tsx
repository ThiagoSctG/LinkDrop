import { useEffect, useRef, useState } from "preact/hooks";
import QRCode from "qrcode";
import { pairingWithKey } from "./crypto";
import { type Pairing, isGone, request } from "./api";
import { CloseIcon } from "./icons";
import { t } from "./i18n";
import { useModal } from "./modal";
import { CONNECTED_MS, PairingDisplay } from "./pairing-display";
import { connectRealtime } from "./realtime";
import { timerDelay } from "./time";

export type RejoinDialogProps = {
  sessionId: string;
  screenKey: string;
  encryptionKey: string;
  onClose: () => void;
  /** The Session ended before a code could be issued. */
  onGone: () => void;
};

export function RejoinDialog({ sessionId, screenKey, encryptionKey, onClose, onGone }: RejoinDialogProps) {
  const [generation, setGeneration] = useState(0);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [qr, setQr] = useState("");
  const [failed, setFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [connected, setConnected] = useState(false);
  const { dialog, initialFocus, backdropProps } = useModal(onClose);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;

  const generateNew = () => {
    setPairing(null);
    setQr("");
    setExpired(false);
    setFailed(false);
    setGeneration((g) => g + 1);
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      const res = await request<Omit<Pairing, "encryptionKey">>(`/api/sessions/${sessionId}/pairing`, {
        method: "POST",
        key: screenKey,
      });
      if (!active) return;
      if (isGone(res)) {
        onGoneRef.current();
        return;
      }
      if (!res.ok) {
        setFailed(true);
        return;
      }
      try {
        const secured = pairingWithKey(res.data, encryptionKey);
        const svg = await QRCode.toString(secured.pairingUrl, { type: "svg", margin: 1 });
        if (!active) return;
        setPairing(secured);
        setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      } catch {
        if (!active) return;
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [sessionId, screenKey, encryptionKey, generation]);

  useEffect(() => {
    if (!pairing || connected || expired) return;
    const lifetime = timerDelay(Date.parse(pairing.expiresAt) - Date.now());
    const expiryTimer = setTimeout(() => setExpired(true), lifetime);

    const stop = connectRealtime({
      query: { pairingToken: pairing.token },
      key: screenKey,
      onMessage: (message) => {
        if (message.type === "paired") setConnected(true);
        else if (message.type === "pairing_expired") setExpired(true);
      },
      onDrop: async () => {
        const state = await request<{ status: string }>(`/api/pair/${pairing.token}`, {
          key: screenKey,
        });
        if (state.ok && state.data.status === "paired") setConnected(true);
        else if (isGone(state) || (!state.ok && state.code === "qr_expired")) setExpired(true);
      },
    });

    return () => {
      clearTimeout(expiryTimer);
      stop();
    };
  }, [pairing, connected, expired, screenKey]);

  useEffect(() => {
    if (!connected) return;
    const timer = setTimeout(() => onCloseRef.current(), CONNECTED_MS);
    return () => clearTimeout(timer);
  }, [connected]);

  return (
    <div className="dialog-backdrop" {...backdropProps}>
      <div ref={dialog} className="dialog rejoin-dialog" role="dialog" aria-modal="true" aria-labelledby="rejoin-title">
        <div className="rejoin-header">
          <h2 id="rejoin-title">{t("rejoin.title")}</h2>
          <button
            ref={initialFocus}
            className="icon-button"
            type="button"
            aria-label={t("rejoin.close")}
            title={t("rejoin.close")}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <p className="rejoin-warning">{t("rejoin.warning")}</p>

        <div className="rejoin-body">
          {expired ? (
            <div className="rejoin-expired">
              <p>{t("error.qr_expired")}</p>
              <button className="button button-secondary" type="button" onClick={generateNew}>
                {t("rejoin.generateNew")}
              </button>
            </div>
          ) : (
            <div className="qr-panel panel rejoin-qr-panel">
              <PairingDisplay
                pairing={pairing}
                qr={qr}
                connected={connected}
                connectedLabel={t("rejoin.connected")}
                error={failed}
                onRetry={generateNew}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
