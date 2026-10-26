import { useEffect, useState } from "preact/hooks";
import QRCode from "qrcode";
import type { Item } from "./api";
import { t } from "./i18n";
import { CheckIcon, CloseIcon, CopyIcon, ExternalLinkIcon } from "./icons";
import { useModal } from "./modal";
import { hostOf, readableUrl } from "./time";

export type SpotlightProps = {
  item: Item;
  onClose: () => void;
  onCopy: () => void;
  onOpenLink?: () => void;
  copied?: boolean;
};

export function Spotlight({ item, onClose, onCopy, onOpenLink, copied }: SpotlightProps) {
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [qrTooLong, setQrTooLong] = useState(false);
  const { dialog, initialFocus, backdropProps } = useModal(onClose);

  useEffect(() => {
    if (item.type !== "link") return;
    let active = true;
    QRCode.toString(item.content, { type: "svg", margin: 1 })
      .then((svg) => {
        if (active) {
          setQrUri(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        }
      })
      .catch(() => {
        if (active) {
          setQrTooLong(true);
        }
      });
    return () => {
      active = false;
    };
  }, [item.content, item.type]);

  const isLink = item.type === "link";
  const heading = isLink ? item.title || hostOf(item.content) : item.title;
  const noteTier =
    item.content.length <= 40
      ? "spotlight-note-short"
      : item.content.length <= 280
        ? "spotlight-note-medium"
        : "spotlight-note-long";

  return (
    <div className="spotlight-backdrop" {...backdropProps}>
      <div
        ref={dialog}
        className="spotlight-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={heading ? "spotlight-title" : undefined}
        aria-label={heading ? undefined : isLink ? t("spotlight.showQr") : t("spotlight.enlarge")}
      >
        <div className="spotlight-header">
          {heading ? (
            <h2 id="spotlight-title" className="spotlight-heading">
              {heading}
            </h2>
          ) : (
            <span />
          )}
          <button
            ref={initialFocus}
            className="icon-button spotlight-close"
            type="button"
            aria-label={t("spotlight.close")}
            title={t("spotlight.close")}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="spotlight-body">
          {isLink ? (
            <div className="spotlight-link-content">
              {qrTooLong ? (
                <div className="spotlight-qr-fallback">
                  <p>{t("spotlight.qrTooLong")}</p>
                </div>
              ) : qrUri ? (
                <div className="spotlight-qr-frame">
                  <img className="spotlight-qr-img" src={qrUri} alt={t("spotlight.qrAlt", { url: item.content })} />
                </div>
              ) : null}
              <p className="spotlight-url">{readableUrl(item.content)}</p>
            </div>
          ) : (
            <div className="spotlight-note-content">
              <pre className={`spotlight-note-text ${noteTier}`}>{item.content}</pre>
            </div>
          )}
        </div>

        <div className="spotlight-actions">
          <button className="button button-secondary" type="button" onClick={onCopy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? t("item.copied") : t("item.copy")}
          </button>
          {isLink && (
            <a
              className="button button-primary"
              href={item.content}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onOpenLink}
            >
              <ExternalLinkIcon />
              {t("item.open")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
