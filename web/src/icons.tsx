import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

export type IconProps = { size?: number };

function Icon({ size = 18, children }: IconProps & { children: ComponentChildren }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </Icon>
);

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Icon>
);

export const ClipboardIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M12 5v14" />
  </Icon>
);

export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

export const UndoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);

export const QrIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <path d="M14 14h3v3M21 14v.01M17 21h4v-4M14 18v3" />
  </Icon>
);

/** A phone handing a link to a screen: the empty list's picture of what LinkDrop does. */
export const HandoffIllustration = () => (
  <svg
    className="handoff"
    width="168"
    height="96"
    viewBox="0 0 168 96"
    fill="none"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <rect className="handoff-device" x="8" y="18" width="40" height="70" rx="9" />
    <path className="handoff-detail" d="M23 25h10" />
    <rect className="handoff-chip" x="15" y="46" width="26" height="12" rx="4" />
    <rect className="handoff-device" x="92" y="12" width="68" height="50" rx="7" />
    <path className="handoff-detail" d="M118 74h16M126 62v12" />
    <rect className="handoff-chip handoff-chip-landed" x="105" y="31" width="42" height="12" rx="4" />
    <path className="handoff-path" d="M50 44C64 22 78 20 90 30" />
    <path className="handoff-path-head" d="m84 25 6 5-7 3" />
  </svg>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Icon>
);

export const ExternalLinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Icon>
);

export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Icon>
);

export const NoteIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
  </Icon>
);

export const PowerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.77.04" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4M12 16h.01" />
  </Icon>
);

export const SendIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m22 2-7 20-4-9-9-4ZM22 2 11 13" />
  </Icon>
);

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  </Icon>
);

/** The brand mark: a D with a slanted cut on a dark tile. Same artwork as docs/images/logo.svg. */
export function BrandIcon({ size = 36 }: IconProps) {
  // Gradient ids must be unique in the document.
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#121c0e" />
          <stop offset="1" stop-color="#080d0a" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="7" y1="5" x2="25" y2="28" gradientUnits="userSpaceOnUse">
          <stop stop-color="#d2ff79" />
          <stop offset="0.38" stop-color="#b8f34a" />
          <stop offset="0.72" stop-color="#55d977" />
          <stop offset="1" stop-color="#1a6a46" />
        </linearGradient>
      </defs>
      <rect
        x="0.25"
        y="0.25"
        width="31.5"
        height="31.5"
        rx="7"
        fill={`url(#${id}t)`}
        stroke="#253720"
        stroke-width="0.5"
      />
      <path
        transform="translate(2 2) scale(0.875)"
        fill={`url(#${id}s)`}
        fill-rule="evenodd"
        d="M9 6h7c7 0 11 3.8 11 10s-4 10-11 10H9a2 2 0 0 1-2-2v-4l6-1.5v2.4h3c3.3 0 5.2-1.4 5.2-4.9s-1.9-4.9-5.2-4.9h-3v2.4L7 15V8a2 2 0 0 1 2-2Z"
      />
    </svg>
  );
}

export const ExpandIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </Icon>
);
