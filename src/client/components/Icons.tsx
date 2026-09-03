import type { ReactNode, SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;

/** 16px stroke icons drawn on one grid, 1.5px round strokes, currentColor. */
function Svg({ children, className = "icon", ...props }: Props & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconPrinter(p: Props) {
  return (
    <Svg {...p}>
      <path d="M4.5 6V2.75h7V6" />
      <rect x="2" y="6" width="12" height="5.5" rx="1.25" />
      <path d="M4.5 9.5h7v3.75h-7z" />
    </Svg>
  );
}

export function IconJobs(p: Props) {
  return (
    <Svg {...p}>
      <path d="M3 4.5h10M3 8h10M3 11.5h6" />
    </Svg>
  );
}

export function IconPresets(p: Props) {
  return (
    <Svg {...p}>
      <path d="M4 2.75h8v10.5L8 10.5l-4 2.75z" />
    </Svg>
  );
}

export function IconSliders(p: Props) {
  return (
    <Svg {...p}>
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </Svg>
  );
}

export function IconUsers(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="5.5" r="2.25" />
      <path d="M2.5 13c0-2 1.6-3.5 3.5-3.5s3.5 1.5 3.5 3.5" />
      <path d="M10.5 3.5a2.25 2.25 0 010 4M11 9.7c1.5.4 2.5 1.7 2.5 3.3" />
    </Svg>
  );
}

export function IconUser(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3.5 13.5c0-2.4 2-4 4.5-4s4.5 1.6 4.5 4" />
    </Svg>
  );
}

export function IconLogout(p: Props) {
  return (
    <Svg {...p}>
      <path d="M6.5 2.75H4A1.25 1.25 0 002.75 4v8A1.25 1.25 0 004 13.25h2.5" />
      <path d="M10 5l3 3-3 3M13 8H6.5" />
    </Svg>
  );
}

export function IconUpload(p: Props) {
  return (
    <Svg {...p}>
      <path d="M8 10.5V3M5 6l3-3 3 3" />
      <path d="M2.75 10.5v1.75A1.25 1.25 0 004 13.5h8a1.25 1.25 0 001.25-1.25V10.5" />
    </Svg>
  );
}

export function IconFile(p: Props) {
  return (
    <Svg {...p}>
      <path d="M9 2.75H4.75A1 1 0 003.75 3.75v8.5a1 1 0 001 1h6.5a1 1 0 001-1V6z" />
      <path d="M9 2.75V6h3.25" />
    </Svg>
  );
}

export function IconChevron(p: Props) {
  return (
    <Svg {...p}>
      <path d="M6 4l4 4-4 4" />
    </Svg>
  );
}

export function IconCheck(p: Props) {
  return (
    <Svg {...p}>
      <path d="M3 8.5l3 3 7-7" />
    </Svg>
  );
}

export function IconRefresh(p: Props) {
  return (
    <Svg {...p}>
      <path d="M13.25 8A5.25 5.25 0 014 11.6M2.75 8A5.25 5.25 0 0112 4.4" />
      <path d="M12 2.5v2.25H9.75M4 13.5v-2.25h2.25" />
    </Svg>
  );
}

export function IconAlert(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 5v3.5M8 11h.01" />
    </Svg>
  );
}

export function IconInfo(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 7.5V11M8 5h.01" />
    </Svg>
  );
}

export function IconPlus(p: Props) {
  return (
    <Svg {...p}>
      <path d="M8 3v10M3 8h10" />
    </Svg>
  );
}

export function IconSearch(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </Svg>
  );
}

export function IconInbox(p: Props) {
  return (
    <Svg {...p}>
      <path d="M2.75 9.5h3l1 1.75h2.5l1-1.75h3" />
      <path d="M4.2 3.5h7.6l1.45 6v3a1 1 0 01-1 1H3.75a1 1 0 01-1-1v-3z" />
    </Svg>
  );
}

export function Spinner(p: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="spinner" aria-hidden="true" {...p}>
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
      <path d="M13.5 8A5.5 5.5 0 008 2.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
