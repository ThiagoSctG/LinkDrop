import { useEffect, useRef } from "preact/hooks";
import type { Item } from "./api";

const COUNT_PREFIX = /^\(\d+\) /;

function showUnread(count: number) {
  const title = document.title.replace(COUNT_PREFIX, "");
  document.title = count ? `(${count}) ${title}` : title;
}

/**
 * Flags items that arrive while the page is hidden: a count in the tab title and a short vibration.
 * The first snapshot only records what already exists, and an item is announced once even if a
 * reconnect replays it, so only genuinely new items alert.
 */
export function useNewItemAlert(): (items: Item[]) => void {
  const seen = useRef<Set<string> | null>(null);
  const unread = useRef(0);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) return;
      unread.current = 0;
      showUnread(0);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      showUnread(0);
    };
  }, []);

  return (items) => {
    const known = seen.current;
    seen.current = new Set([...(known ?? []), ...items.map((item) => item.id)]);
    if (!known || !document.hidden) return;
    const arrived = items.filter((item) => !known.has(item.id)).length;
    if (!arrived) return;
    unread.current += arrived;
    showUnread(unread.current);
    navigator.vibrate?.(80);
  };
}
