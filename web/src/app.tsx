import { useEffect, useState } from "preact/hooks";
import { cryptoAvailable } from "./crypto";
import { detectLocale, t } from "./i18n";
import { PhoneApp } from "./phone";
import { ScreenApp } from "./screen";

const PAIR_ROUTE = /^\/pair(?:\/([^/]+))?\/?$/;

/** `/` is the screen; `/pair/{token}` (and `/pair` after pairing) is the phone. */
export function App() {
  const [route] = useState(() => window.location.pathname.match(PAIR_ROUTE));

  useEffect(() => {
    document.documentElement.lang = detectLocale();
  }, []);

  if (!cryptoAvailable()) {
    return (
      <main className="phone-wait">
        <section role="alert">
          <h1>{t("security.title")}</h1>
          <p>{t("error.crypto_unavailable")}</p>
        </section>
      </main>
    );
  }
  return (
    <>
      {window.location.protocol === "http:" && (
        <aside className="transport-notice" role="note">
          {t("security.httpNotice")}
        </aside>
      )}
      {route ? <PhoneApp token={route[1] ? decodeURIComponent(route[1]) : undefined} /> : <ScreenApp />}
    </>
  );
}
