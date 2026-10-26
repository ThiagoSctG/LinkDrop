import { readPairingKey } from "./crypto";
import { useEffect, useState } from "preact/hooks";
import { type Connection, type EndReason, request } from "./api";
import { TopBar } from "./chrome";
import { errorMessage, t } from "./i18n";
import { AlertIcon, BrandIcon, QrIcon } from "./icons";
import { Session } from "./session";
import { loadConnection, saveConnection } from "./storage";

type PhoneState =
  | { kind: "connecting" }
  | { kind: "connected"; connection: Connection }
  | { kind: "failed"; message: string }
  | { kind: "ended"; reason: EndReason };

/**
 * A token in the URL means a fresh scan, so it always wins over a saved session.
 * Before pairing the token and encryption fragment leave the address bar; reloading /pair resumes the saved session.
 */
function initialState(token: string | undefined): PhoneState {
  if (token) return { kind: "connecting" };
  const saved = loadConnection("phone");
  return saved ? { kind: "connected", connection: saved } : { kind: "failed", message: t("phone.rescan") };
}

export function PhoneApp({ token }: { token?: string }) {
  const [encryptionKey] = useState(() => {
    const key = token ? readPairingKey() : null;
    if (token) window.history.replaceState(window.history.state, "", "/pair");
    return key;
  });
  const [state, setState] = useState<PhoneState>(() => initialState(token));

  useEffect(() => {
    if (!token) return;
    if (!encryptionKey) {
      setState({ kind: "failed", message: errorMessage("encryption_key") });
      return;
    }
    let canceled = false;
    void request<Omit<Connection, "encryptionKey">>(`/api/pair/${encodeURIComponent(token)}`, { method: "POST" }).then(
      (result) => {
        if (canceled) return;
        if (!result.ok) {
          setState({ kind: "failed", message: errorMessage(result.code) });
          return;
        }
        const connection: Connection = { ...result.data, role: "phone", encryptionKey };
        saveConnection(connection);
        window.history.replaceState(window.history.state, "", "/pair");
        setState({ kind: "connected", connection });
      },
    );
    return () => {
      canceled = true;
    };
  }, [token, encryptionKey]);

  if (state.kind === "connected") {
    return <Session connection={state.connection} onEnded={(reason) => setState({ kind: "ended", reason })} />;
  }

  const problem = state.kind === "failed" || state.kind === "ended";
  const heading =
    state.kind === "connecting"
      ? t("phone.connecting")
      : state.kind === "ended"
        ? t(`ended.${state.reason}`)
        : t("phone.failed");
  const detail =
    state.kind === "connecting"
      ? t("phone.connectingHelp")
      : state.kind === "ended"
        ? t("phone.endedHelp")
        : state.message;

  return (
    <main className="phone-wait">
      <TopBar homeLink={false} />
      <section>
        <div className={problem ? "status-symbol status-error" : "status-symbol status-loading"} aria-hidden="true">
          {problem ? <AlertIcon size={26} /> : <BrandIcon size={72} />}
        </div>
        <h1>{heading}</h1>
        <p role={state.kind === "failed" ? "alert" : undefined}>{detail}</p>
        {/* No link to "/": that is the screen's page, and the way back is scanning the screen again. */}
        {problem && (
          <p className="phone-help">
            <span aria-hidden="true">
              <QrIcon size={20} />
            </span>
            {t("phone.recovery")}
          </p>
        )}
      </section>
    </main>
  );
}
