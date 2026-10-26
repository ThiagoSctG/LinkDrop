import { useEffect, useState } from "preact/hooks";
import { detectLocale, t } from "./i18n";

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function timeAgo(iso: string, now: number): string {
  const elapsed = now - Date.parse(iso);
  if (Number.isNaN(elapsed)) return "";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return t("time.now");
  const format = new Intl.RelativeTimeFormat(detectLocale(), { numeric: "auto" });
  if (minutes < 60) return format.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? format.format(-hours, "hour") : format.format(-Math.floor(hours / 24), "day");
}

export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Mirrors the server's rule: only an absolute http(s) URL without spaces becomes a link. */
export function isLinkText(text: string): boolean {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed) || /\s/.test(trimmed)) return false;
  try {
    return new URL(trimmed).host !== "";
  } catch {
    return false;
  }
}

const AVATAR_COLORS = 8;

export function siteAvatar(host: string): { initial: string; color: number } {
  // FNV-1a: spreads similar hosts across the colors better than a plain multiply-and-add.
  let hash = 0x811c9dc5;
  for (const char of host) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  return { initial: (Array.from(host)[0] ?? "?").toUpperCase(), color: hash % AVATAR_COLORS };
}

export function readableUrl(url: string): string {
  try {
    const { hostname, port } = new URL(url);
    return hostname.replace(/^www\./, "") + (port ? `:${port}` : "") + readablePath(url);
  } catch {
    return url;
  }
}

export function readablePath(url: string): string {
  try {
    const { pathname, search, hash } = new URL(url);
    return decodeOrKeep((pathname === "/" ? "" : pathname) + search + hash);
  } catch {
    return "";
  }
}

/** Percent-escapes as the characters they stand for; malformed escapes stay as they are. */
function decodeOrKeep(text: string): string {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}
