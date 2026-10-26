import { ContentError, decryptItem, encryptItem } from "./crypto";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { TargetedEvent } from "preact";
import { useNewItemAlert } from "./alerts";
import { type Connection, type EndReason, type Item, isGone, request, sessionPath } from "./api";
import { ConfirmDialog, SessionTimer, StatusPill, Toast, type ToastAction, TopBar } from "./chrome";
import { detectLocale, errorMessage, t } from "./i18n";
import {
  AlertIcon,
  CheckIcon,
  ClipboardIcon,
  CopyIcon,
  ExpandIcon,
  ExternalLinkIcon,
  HandoffIllustration,
  LinkIcon,
  MinusIcon,
  NoteIcon,
  PlusIcon,
  PowerIcon,
  QrIcon,
  SendIcon,
  TrashIcon,
} from "./icons";
import { Spotlight } from "./spotlight";
import { RejoinDialog } from "./rejoin";
import { useLeavingItems } from "./exits";
import { connectRealtime } from "./realtime";
import { forgetConnection } from "./storage";
import { hostOf, isLinkText, readablePath, readableUrl, siteAvatar, timeAgo, useNow } from "./time";

type Action = { method: string; path: string; body?: unknown; keepalive?: boolean };

const MAX_CONTENT = 10_000;
/** The character count is noise until the text gets close to the limit. */
const SHOW_COUNTER_AT = 8_000;
const TOAST_MS = 2_400;
/** How long "copied" stays on a copy button before it reads normally again. */
const FEEDBACK_MS = 2_000;
/**
 * How long the send button shows its check. Kept short: the item landing in the list is the real
 * confirmation, and a long "sent" state made sending feel slower than it is.
 */
const SENT_MS = 900;
/** How long a removed item can be brought back before the delete reaches the server. */
export const UNDO_MS = 5_000;

const without = (id: string) => (previous: ReadonlySet<string>) => {
  const next = new Set(previous);
  next.delete(id);
  return next;
};

function dialogText(kind: "end" | "clear") {
  return kind === "end"
    ? { title: t("session.confirmEnd"), message: t("session.confirmEndHelp"), confirmLabel: t("session.end") }
    : { title: t("list.confirmClear"), message: t("list.confirmClearHelp"), confirmLabel: t("list.clear") };
}

export function Session({ connection, onEnded }: { connection: Connection; onEnded: (reason: EndReason) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [unstable, setUnstable] = useState(false);
  const [error, setError] = useState("");
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "sent">("idle");
  const [copyFeedback, setCopyFeedback] = useState<{ itemId: string; status: "copied" | "error" } | null>(null);
  const [dialog, setDialog] = useState<"end" | "clear" | null>(null);
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [showRejoin, setShowRejoin] = useState(false);
  const [toast, setToast] = useState<{ text: string; error: boolean; action?: ToastAction } | null>(null);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRemoval = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  /** Items in the first snapshot; anything not in it arrived while this page was open. */
  const firstSeen = useRef<Set<string> | null>(null);
  const [deadline, setDeadline] = useState<{ at: number; total: number } | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [showTitle, setShowTitle] = useState(false);
  const [draft, setDraft] = useState("");
  const now = useNow(15_000);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const alertNewItems = useNewItemAlert();
  const ended = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  const end = (reason: EndReason) => {
    if (ended.current) return;
    ended.current = true;
    forgetConnection(connection.role);
    onEndedRef.current(reason);
  };

  const showToast = (text: string, options: { error?: boolean; action?: ToastAction; ms?: number } = {}) => {
    clearTimeout(toastTimer.current);
    setToast({ text, error: options.error ?? false, action: options.action });
    toastTimer.current = setTimeout(() => setToast(null), options.ms ?? TOAST_MS);
  };
  const hideToast = () => {
    clearTimeout(toastTimer.current);
    setToast(null);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    if (submitState !== "sent") return;
    const timer = setTimeout(() => setSubmitState("idle"), SENT_MS);
    return () => clearTimeout(timer);
  }, [submitState]);

  useEffect(() => {
    if (!copyFeedback) return;
    const timer = setTimeout(() => setCopyFeedback(null), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copyFeedback]);

  useEffect(() => {
    let active = true;
    let revision = 0;
    const stop = connectRealtime({
      query: { sessionId: connection.sessionId },
      key: connection.endpointKey,
      onOpen: () => setUnstable(false),
      onMessage: (message) => {
        if (message.type === "session") {
          const current = ++revision;
          if (!Array.isArray(message.items)) {
            setItems([]);
            setError(errorMessage("encryption"));
            return;
          }
          // One item that fails to authenticate is dropped and reported; the rest stay readable.
          void Promise.allSettled(message.items.map((item) => decryptItem(connection, item))).then((results) => {
            if (!active || current !== revision || ended.current) return;
            const decoded = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
            firstSeen.current ??= new Set(decoded.map((item) => item.id));
            setItems(decoded);
            if (decoded.length < results.length) setError(errorMessage("encryption"));
            else setError((previous) => (previous === errorMessage("encryption") ? "" : previous));
            alertNewItems(decoded);
            const left = message.expiresInMs;
            if (typeof left === "number") {
              setDeadline((previous) => ({ at: Date.now() + left, total: Math.max(previous?.total ?? 0, left) }));
            }
          });
        } else if (message.type === "session_ended") {
          ++revision;
          end(message.reason);
        }
      },
      onDrop: async () => {
        setUnstable(true);
        if (isGone(await request(sessionPath(connection), { key: connection.endpointKey }))) end("gone");
      },
    });
    return () => {
      active = false;
      ++revision;
      stop();
    };
  }, [connection.sessionId, connection.endpointKey, connection.encryptionKey]);

  const act = async ({ method, path, body, keepalive }: Action) => {
    setError("");
    const result = await request(sessionPath(connection, path), {
      method,
      body,
      keepalive,
      key: connection.endpointKey,
    });
    if (result.ok) return true;
    if (isGone(result)) {
      end("gone");
      return false;
    }
    setError(errorMessage(result.code));
    return false;
  };

  const recordActivity = () => void act({ method: "POST", path: "/activity" });

  const renew = async () => {
    if (renewing) return;
    setRenewing(true);
    const ok = await act({ method: "POST", path: "/activity" });
    setRenewing(false);
    if (ok) {
      showToast(t("toast.renewed"));
    }
  };

  const submit = async (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSubmitState("sending");
    let created = false;
    try {
      const body = await encryptItem(connection, String(data.get("title") ?? ""), String(data.get("content") ?? ""));
      if (ended.current) return;
      created = await act({ method: "POST", path: "/items", body });
    } catch (error) {
      setError(errorMessage(error instanceof ContentError ? error.code : "encryption"));
    }
    if (created) {
      form.reset();
      setDraft("");
      setShowTitle(false);
    }
    setSubmitState(created ? "sent" : "idle");
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const field = contentRef.current;
      if (!field) return;
      field.value = text.slice(0, MAX_CONTENT);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.focus();
    } catch {
      setError(errorMessage("paste"));
    }
  };

  const submitOnShortcut = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    (event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
  };

  const copyItem = async (item: Item) => {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopyFeedback({ itemId: item.id, status: "copied" });
      showToast(t("toast.copied"));
      recordActivity();
    } catch {
      setCopyFeedback({ itemId: item.id, status: "error" });
      showToast(t("item.copyFailedStatus"), { error: true });
    }
  };

  const commitRemoval = (keepalive = false) => {
    const pending = pendingRemoval.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRemoval.current = null;
    if (ended.current) return;
    void act({ method: "DELETE", path: `/items/${encodeURIComponent(pending.id)}`, keepalive }).then((ok) => {
      if (!ok) setRemoved(without(pending.id));
    });
  };

  const undoRemoval = (id: string) => {
    const pending = pendingRemoval.current;
    if (pending?.id !== id) return;
    clearTimeout(pending.timer);
    pendingRemoval.current = null;
    setRemoved(without(id));
    hideToast();
  };

  const removeItem = (item: Item) => {
    commitRemoval();
    setRemoved((previous) => new Set(previous).add(item.id));
    pendingRemoval.current = { id: item.id, timer: setTimeout(() => commitRemoval(), UNDO_MS) };
    showToast(t("item.removed"), {
      ms: UNDO_MS,
      action: { label: t("item.undo"), onClick: () => undoRemoval(item.id) },
    });
  };

  // A delete still waiting on its undo window goes out when the page closes or the session view leaves.
  useEffect(() => {
    const flush = () => commitRemoval(true);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const confirmDialog = async () => {
    const action = dialog;
    setDialog(null);
    if (action === "end") {
      if (await act({ method: "POST", path: "/end" })) end("ended");
    } else if (action === "clear") {
      // The list empties at once, so it animates out on confirm instead of after the round trip.
      const ids = visibleItems.map((item) => item.id);
      commitRemoval();
      hideToast();
      setRemoved((previous) => new Set([...previous, ...ids]));
      if (!(await act({ method: "POST", path: "/clear" }))) {
        setRemoved((previous) => new Set([...previous].filter((id) => !ids.includes(id))));
      }
    }
  };

  const visibleItems = useMemo(() => items.filter((item) => !removed.has(item.id)), [items, removed]);
  const entries = useLeavingItems(visibleItems);

  useEffect(() => {
    if (spotlightId && !visibleItems.some((item) => item.id === spotlightId)) {
      setSpotlightId(null);
    }
  }, [spotlightId, visibleItems]);

  const openSpotlight = (item: Item) => {
    setSpotlightId(item.id);
    recordActivity();
  };

  const renderItem = (item: Item) => {
    const isLink = item.type === "link";
    const host = isLink ? hostOf(item.content) : "";
    const heading = item.title || host;
    // An untitled link already headlines its host, so the line below adds only the path.
    const detail = isLink ? (item.title ? readableUrl(item.content) : readablePath(item.content)) : "";
    const copied = copyFeedback?.itemId === item.id ? copyFeedback.status : null;
    const avatar = host ? siteAvatar(host) : null;
    const arrived = firstSeen.current !== null && !firstSeen.current.has(item.id);
    return (
      <article className={`item ${isLink ? "item-link" : "item-note"}${arrived ? " item-arrived" : ""}`} key={item.id}>
        {avatar ? (
          <span className={`item-icon item-avatar item-avatar-${avatar.color}`} aria-hidden="true">
            {avatar.initial}
          </span>
        ) : (
          <span className={isLink ? "item-icon item-icon-link" : "item-icon"} aria-hidden="true">
            {isLink ? <LinkIcon /> : <NoteIcon />}
          </span>
        )}
        <div className="item-body">
          <p className="item-meta">
            <span className="item-type">{isLink ? t("item.link") : t("item.note")}</span>
            <time dateTime={item.createdAt}>{timeAgo(item.createdAt, now)}</time>
          </p>
          {heading && <h3>{heading}</h3>}
          {isLink ? (
            detail &&
            detail !== heading && (
              <p className="item-url" title={item.content}>
                {detail}
              </p>
            )
          ) : (
            <pre>{item.content}</pre>
          )}
        </div>
        <div className="item-actions">
          {isLink && (
            <a
              className="button button-soft button-compact"
              href={item.content}
              target="_blank"
              rel="noopener noreferrer"
              onClick={recordActivity}
            >
              <ExternalLinkIcon />
              <span className="button-label">{t("item.open")}</span>
            </a>
          )}
          <button
            className="button button-secondary button-compact item-copy"
            type="button"
            onClick={() => void copyItem(item)}
          >
            {copied === "copied" ? <CheckIcon /> : <CopyIcon />}
            <span className="button-label">
              {copied === "copied" ? t("item.copied") : copied === "error" ? t("item.copyFailed") : t("item.copy")}
            </span>
          </button>
          {isLink ? (
            <button
              className="icon-button"
              type="button"
              aria-label={t("spotlight.showQr")}
              title={t("spotlight.showQr")}
              onClick={() => openSpotlight(item)}
            >
              <QrIcon />
            </button>
          ) : (
            <button
              className="icon-button"
              type="button"
              aria-label={t("spotlight.enlarge")}
              title={t("spotlight.enlarge")}
              onClick={() => openSpotlight(item)}
            >
              <ExpandIcon />
            </button>
          )}
          <button
            className="icon-button icon-button-danger"
            type="button"
            aria-label={t("item.remove")}
            title={t("item.remove")}
            onClick={() => removeItem(item)}
          >
            <TrashIcon />
          </button>
        </div>
      </article>
    );
  };

  const canPaste = typeof navigator.clipboard?.readText === "function";

  const formatCount = (value: number) => value.toLocaleString(detectLocale());
  const length = draft.length;
  const draftIsLink = isLinkText(draft);
  const draftLabel = !draft.trim()
    ? ""
    : draftIsLink
      ? t("composer.kindLink", { host: hostOf(draft.trim()) })
      : t("composer.kindNote");

  // `now` only exists to re-render on a timer; the clock itself is read fresh.
  const remaining = deadline ? Math.max(0, deadline.at - Math.max(now, Date.now())) : null;
  const spotlightItem = spotlightId ? (visibleItems.find((item) => item.id === spotlightId) ?? null) : null;

  return (
    <>
      <main
        className={`shell role-${connection.role}`}
        inert={dialog || spotlightItem || showRejoin ? true : undefined}
      >
        <TopBar homeLink={connection.role === "screen"}>
          <button
            className="button button-danger-ghost button-compact session-end"
            type="button"
            aria-label={t("session.end")}
            onClick={() => setDialog("end")}
          >
            <PowerIcon />
            <span className="session-end-label">{t("session.end")}</span>
          </button>
        </TopBar>
        <div className="session-bar">
          <StatusPill>
            {connection.role === "screen" ? t("session.screenConnected") : t("session.phoneConnected")}
          </StatusPill>
          {connection.role === "screen" && (
            <button
              className="button button-quiet button-compact session-rejoin"
              type="button"
              aria-label={t("rejoin.button")}
              title={t("rejoin.button")}
              onClick={() => setShowRejoin(true)}
            >
              <QrIcon />
              <span className="button-label">{t("rejoin.button")}</span>
            </button>
          )}
          {deadline && remaining !== null && (
            <SessionTimer remainingMs={remaining} totalMs={deadline.total} onRenew={renew} renewing={renewing} />
          )}
        </div>

        <div className="workspace">
          <form
            className="composer panel"
            onSubmit={submit}
            onInput={(event) => {
              setSubmitState("idle");
              const field = event.target as HTMLTextAreaElement;
              if (field.id === "content") setDraft(field.value);
            }}
          >
            <div className="composer-head">
              <h2>{t("composer.title")}</h2>
              {draftLabel && (
                <span className={draftIsLink ? "composer-kind composer-kind-link" : "composer-kind"}>{draftLabel}</span>
              )}
            </div>
            <label className="visually-hidden" htmlFor="content">
              {t("composer.contentLabel")}
            </label>
            <div className="composer-field">
              <textarea
                id="content"
                name="content"
                ref={contentRef}
                aria-keyshortcuts="Control+Enter Meta+Enter"
                onKeyDown={submitOnShortcut}
                placeholder={t("composer.contentPlaceholder")}
                maxLength={MAX_CONTENT}
                rows={3}
                required
              />
              {length >= SHOW_COUNTER_AT && (
                <small className="counter" aria-hidden="true">
                  {formatCount(length)} / {formatCount(MAX_CONTENT)}
                </small>
              )}
            </div>
            {showTitle && (
              <>
                <label className="visually-hidden" htmlFor="title">
                  {t("composer.titleLabel")}
                </label>
                <input id="title" name="title" placeholder={t("composer.titlePlaceholder")} maxLength={200} autoFocus />
              </>
            )}
            <div className="composer-actions">
              <div className="composer-tools">
                {canPaste && (
                  <button
                    className="button button-secondary button-compact"
                    type="button"
                    onClick={() => void pasteFromClipboard()}
                  >
                    <ClipboardIcon />
                    {t("composer.paste")}
                  </button>
                )}
                <button
                  className="button button-quiet button-compact"
                  type="button"
                  aria-expanded={showTitle}
                  aria-label={showTitle ? t("composer.removeTitle") : t("composer.addTitle")}
                  onClick={() => setShowTitle(!showTitle)}
                >
                  {showTitle ? <MinusIcon /> : <PlusIcon />}
                  {t("composer.titleShort")}
                </button>
              </div>
              <button
                className={`button button-primary composer-send composer-send-${submitState}`}
                type="submit"
                title="Ctrl+Enter"
                disabled={submitState === "sending"}
              >
                {submitState === "sent" ? <CheckIcon /> : <SendIcon />}
                {t("composer.send")}
              </button>
            </div>
          </form>

          <div className="list-column">
            <div className="list-toolbar">
              <h2>
                {t("list.title")} {visibleItems.length > 0 && <span className="count">{visibleItems.length}</span>}
              </h2>
              {connection.role === "screen" && visibleItems.length > 0 && (
                <button
                  className="button button-secondary button-compact"
                  type="button"
                  onClick={() => setDialog("clear")}
                >
                  <TrashIcon />
                  {t("list.clear")}
                </button>
              )}
            </div>

            {unstable && (
              <p className="error" role="status">
                <AlertIcon />
                {t("session.unstable")}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                <AlertIcon />
                {error}
              </p>
            )}
            <section
              className={visibleItems.length || !entries.length ? "items panel" : "items items-clearing panel"}
              aria-live="polite"
              aria-label={t("list.title")}
            >
              {entries.map(({ item, leaving }) =>
                leaving ? (
                  // A copy of an item that just left, kept for its exit animation and out of reach.
                  <div className="item-exit" key={`exit-${item.id}`} aria-hidden="true" inert>
                    <div className="item-exit-inner">{renderItem(item)}</div>
                  </div>
                ) : (
                  renderItem(item)
                ),
              )}
              {!visibleItems.length && (
                <div className="empty">
                  <HandoffIllustration />
                  <strong>{t("list.emptyTitle")}</strong>
                  <p>{t("list.emptyHelp")}</p>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
      {toast && <Toast text={toast.text} error={toast.error} action={toast.action} />}
      {dialog && (
        <ConfirmDialog
          {...dialogText(dialog)}
          onConfirm={() => void confirmDialog()}
          onCancel={() => setDialog(null)}
        />
      )}
      {spotlightItem && (
        <Spotlight
          item={spotlightItem}
          onClose={() => setSpotlightId(null)}
          onCopy={() => void copyItem(spotlightItem)}
          onOpenLink={recordActivity}
          copied={copyFeedback?.itemId === spotlightItem.id && copyFeedback.status === "copied"}
        />
      )}
      {showRejoin && (
        <RejoinDialog
          sessionId={connection.sessionId}
          screenKey={connection.endpointKey}
          encryptionKey={connection.encryptionKey}
          onClose={() => setShowRejoin(false)}
          onGone={() => end("gone")}
        />
      )}
    </>
  );
}
