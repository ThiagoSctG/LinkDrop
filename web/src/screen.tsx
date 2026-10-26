import QRCode from "qrcode";
import { createEncryptionKey, pairingWithKey } from "./crypto";
import { useEffect, useRef, useState } from "preact/hooks";
import { type Connection, type EndReason, type Pairing, isGone, request } from "./api";
import { StatusPill, TopBar } from "./chrome";
import { AlertIcon, ClipboardIcon, CloseIcon, ExternalLinkIcon, QrIcon, ShieldIcon } from "./icons";
import { t } from "./i18n";
import { CONNECTED_MS, PairingDisplay } from "./pairing-display";
import { connectRealtime } from "./realtime";
import { Session } from "./session";
import { loadConnection, saveConnection } from "./storage";

/** Never replace a QR code more often than this, even if the device clock disagrees with the server. */
const MIN_QR_LIFETIME_MS = 10_000;

export function ScreenApp() {
  const [connection, setConnection] = useState(() => loadConnection("screen"));
  /** A session the phone just opened, held back while the screen confirms the connection. */
  const [confirming, setConfirming] = useState<Connection | null>(null);
  const [endedReason, setEndedReason] = useState<EndReason | null>(null);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => {
      setConnection(confirming);
      setConfirming(null);
    }, CONNECTED_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (connection) {
    return (
      <Session
        connection={connection}
        onEnded={(reason) => {
          setEndedReason(reason);
          setConnection(null);
        }}
      />
    );
  }
  return (
    <PairingView
      endedReason={endedReason}
      connected={confirming !== null}
      onDismissNotice={() => setEndedReason(null)}
      onPaired={(paired) => {
        // Saved at once so a reload during the confirmation still resumes the session.
        saveConnection(paired);
        setEndedReason(null);
        // A repeated "paired" (say, from the reconnect check) must not restart the confirmation.
        setConfirming((current) => current ?? paired);
      }}
    />
  );
}

function PairingView({
  endedReason,
  connected,
  onDismissNotice,
  onPaired,
}: {
  endedReason: EndReason | null;
  connected: boolean;
  onDismissNotice: () => void;
  onPaired: (connection: Connection) => void;
}) {
  const [generation, setGeneration] = useState(0);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [qr, setQr] = useState("");
  const [failed, setFailed] = useState(false);
  const onPairedRef = useRef(onPaired);
  onPairedRef.current = onPaired;
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  const replaceCode = () => {
    // Once a phone is in, the code is spent; replacing it would only flash a new one under the confirmation.
    if (connectedRef.current) return;
    setPairing(null);
    setQr("");
    setGeneration((value) => value + 1);
  };

  useEffect(() => {
    let canceled = false;
    setFailed(false);
    void (async () => {
      const encryptionKey = createEncryptionKey();
      const result = await request<Omit<Pairing, "encryptionKey">>("/api/screens", { method: "POST" });
      if (canceled) return;
      if (!result.ok) {
        setFailed(true);
        return;
      }
      const secured = pairingWithKey(result.data, encryptionKey);
      const svg = await QRCode.toString(secured.pairingUrl, { type: "svg", margin: 1 });
      if (canceled) return;
      setPairing(secured);
      setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    })().catch(() => {
      if (!canceled) setFailed(true);
    });
    return () => {
      canceled = true;
    };
  }, [generation]);

  useEffect(() => {
    if (!pairing) return;
    const paired = (sessionId: string) =>
      onPairedRef.current({
        sessionId,
        endpointKey: pairing.screenKey,
        role: "screen",
        encryptionKey: pairing.encryptionKey,
      });
    const lifetime = Math.max(MIN_QR_LIFETIME_MS, Date.parse(pairing.expiresAt) - Date.now());
    const expiry = setTimeout(replaceCode, lifetime);
    const stop = connectRealtime({
      query: { pairingToken: pairing.token },
      key: pairing.screenKey,
      onMessage: (message) => {
        if (message.type === "paired") paired(message.sessionId);
        else if (message.type === "pairing_expired") replaceCode();
      },
      onDrop: async () => {
        const state = await request<{ status: string; sessionId?: string }>(`/api/pair/${pairing.token}`, {
          key: pairing.screenKey,
        });
        if (state.ok && state.data.status === "paired" && state.data.sessionId) paired(state.data.sessionId);
        else if (isGone(state) || (!state.ok && state.code === "qr_expired")) replaceCode();
      },
    });
    return () => {
      clearTimeout(expiry);
      stop();
    };
  }, [pairing]);

  return (
    <main className="waiting">
      <TopBar />
      <section className="pairing-layout">
        <div className="pairing-intro">
          {endedReason && (
            <div className="notice">
              <AlertIcon />
              <p role="status">{t(`ended.${endedReason}`)}</p>
              <button
                className="notice-dismiss"
                type="button"
                aria-label={t("notice.dismiss")}
                title={t("notice.dismiss")}
                onClick={onDismissNotice}
              >
                <CloseIcon size={16} />
              </button>
            </div>
          )}
          <StatusPill>{connected ? t("pairing.connected") : t("pairing.status")}</StatusPill>
          <h1>
            {t("pairing.title")} <mark>{t("pairing.titleMark")}</mark>
          </h1>
          <p className="lead">{t("pairing.lead")}</p>
          <ol className="steps">
            <li>
              <span aria-hidden="true">
                <QrIcon size={16} />
              </span>
              {t("pairing.step1")}
            </li>
            <li>
              <span aria-hidden="true">
                <ClipboardIcon size={16} />
              </span>
              {t("pairing.step2")}
            </li>
            <li>
              <span aria-hidden="true">
                <ExternalLinkIcon size={16} />
              </span>
              {t("pairing.step3")}
            </li>
          </ol>
        </div>
        <div className="qr-panel panel">
          <div className="qr-heading">
            <strong>{t("pairing.connectPhone")}</strong>
            <span className="badge">{t("pairing.temporary")}</span>
          </div>
          <PairingDisplay
            pairing={pairing}
            qr={qr}
            connected={connected}
            autoRenews
            error={failed}
            onRetry={replaceCode}
          />
        </div>
      </section>
      <footer className="waiting-footer">
        <span>
          <ShieldIcon size={15} />
          {t("pairing.footerTemporary")}
        </span>
        <span>{t("pairing.footerNoAccount")}</span>
        <span>{t("pairing.footerRemoved")}</span>
      </footer>
    </main>
  );
}
