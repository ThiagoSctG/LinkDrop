import { useEffect, useState } from "preact/hooks";
import { detectLocale } from "./i18n";
import { PhoneApp } from "./phone";
import { ScreenApp } from "./screen";

const PAIR_ROUTE = /^\/pair(?:\/([^/]+))?\/?$/;

/** `/` is the screen; `/pair/{token}` (and `/pair` after pairing) is the phone. */
export function App() {
  const [route] = useState(() => window.location.pathname.match(PAIR_ROUTE));

  useEffect(() => {
    document.documentElement.lang = detectLocale();
  }, []);

  return route ? <PhoneApp token={route[1] ? decodeURIComponent(route[1]) : undefined} /> : <ScreenApp />;
}
