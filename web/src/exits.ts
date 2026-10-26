import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Item } from "./api";

/** How long one item takes to leave; matches `item-exit` in style.css. */
const EXIT_MS = 380;
/** The longest delay clearing staggers an item by; matches the `.items-clearing` rules in style.css. */
const MAX_STAGGER_MS = 200;

type ListEntry = { item: Item; leaving: boolean };

/**
 * The list to render: the current items plus, for a moment, the ones that just left (removed here,
 * on the other device, or by clearing), kept where they were so they can animate out.
 * `items` must keep its identity between renders unless it changes.
 */
export function useLeavingItems(items: Item[]): ListEntry[] {
  const previous = useRef(items);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [leaving, setLeaving] = useState<{ item: Item; index: number }[]>([]);

  useLayoutEffect(() => {
    const present = new Set(items.map((item) => item.id));
    const gone = previous.current.flatMap((item, index) => (present.has(item.id) ? [] : [{ item, index }]));
    previous.current = items;
    // An item that came back (an undone removal) stops leaving.
    setLeaving((current) => [...current.filter((entry) => !present.has(entry.item.id)), ...gone]);
    if (!gone.length) return;
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setLeaving((current) => current.filter((entry) => !gone.includes(entry)));
    }, EXIT_MS + MAX_STAGGER_MS);
    timers.current.add(timer);
  }, [items]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const entries: ListEntry[] = items.map((item) => ({ item, leaving: false }));
  for (const { item, index } of [...leaving].sort((a, b) => a.index - b.index)) {
    entries.splice(Math.min(index, entries.length), 0, { item, leaving: true });
  }
  return entries;
}
