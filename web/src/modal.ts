import { useEffect, useRef } from "preact/hooks";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * What every modal dialog does: focus starts on `initialFocus`, Tab stays inside `dialog`, and
 * focus returns to whatever opened it. Escape and a click outside close it. Spread
 * `backdropProps` on the backdrop that wraps the dialog.
 */
export function useModal<T extends HTMLElement = HTMLButtonElement>(onClose: () => void) {
  const dialog = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<T>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    initialFocus.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const focusable = dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onMouseDown = (event: MouseEvent) => {
    if (event.target === event.currentTarget) onClose();
  };

  return { dialog, initialFocus, backdropProps: { onKeyDown, onMouseDown } };
}
