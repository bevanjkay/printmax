import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Tone } from "../util.js";
import { useRef, useState } from "react";

/* ---------- Badge ---------- */

import { stateTone } from "../util.js";
import { IconAlert, IconCheck, IconFile, IconInfo, IconPrinter, IconUpload, Spinner } from "./Icons.js";

/* ---------- Button ---------- */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = "secondary", size = "md", loading, icon, className = "", children, disabled, type = "button", ...rest }: ButtonProps) {
  const classes = ["btn", variant !== "secondary" ? `btn-${variant}` : "", size !== "md" ? `btn-${size}` : "", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Badge({ tone = "neutral", plain, children }: { tone?: Tone; plain?: boolean; children: ReactNode }) {
  return <span className={`badge badge-${tone}${plain ? " badge-plain" : ""}`}>{children}</span>;
}

export function StateBadge({ state }: { state: string }) {
  return <Badge tone={stateTone(state)}>{state.replace(/-/g, " ")}</Badge>;
}

/* ---------- Field ---------- */

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, children, className = "" }: FieldProps) {
  return (
    <label className={`field ${className}`.trim()}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/* ---------- Panel ---------- */

interface PanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, actions, footer, children, className = "" }: PanelProps) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || actions) && (
        <header className="panel-header">
          {title && <h2>{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {children}
      {footer && <footer className="panel-footer">{footer}</footer>}
    </section>
  );
}

/* ---------- Notice ---------- */

const NOTICE_ICONS = { error: IconAlert, warning: IconAlert, success: IconCheck, info: IconInfo };

export function Notice({ tone = "info", children }: { tone?: keyof typeof NOTICE_ICONS; children: ReactNode }) {
  const Icon = NOTICE_ICONS[tone];
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon />
      <div>{children}</div>
    </div>
  );
}

/* ---------- Empty state ---------- */

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${70 - i * 12}%` }} />)}
    </div>
  );
}

/* ---------- Dropzone ---------- */

function formatBytes(n: number): string {
  if (n < 1024)
    return `${n} B`;
  if (n < 1024 * 1024)
    return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface DropzoneProps {
  file: File | null;
  onFile: (file: File | null) => void;
  accept: string;
}

export function Dropzone({ file, onFile, accept }: DropzoneProps) {
  const [active, setActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`dropzone${active ? " active" : ""}${file ? " has-file" : ""}`}
      onDragEnter={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setActive(false);
        onFile(e.dataTransfer.files?.[0] ?? null);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-label="Document to print"
        onChange={e => onFile(e.target.files?.[0] ?? null)}
      />
      {file
        ? (
            <div className="dropzone-content" key="file">
              <div className="file">
                <IconFile />
                <strong>{file.name}</strong>
                <span className="muted">{formatBytes(file.size)}</span>
              </div>
              <span className="xs muted">Drop another file to replace it</span>
            </div>
          )
        : (
            <div className="dropzone-content" key="empty">
              <IconUpload />
              <div>
                <strong>Drop a file here</strong>
                {" "}
                or click to choose
              </div>
              <span className="xs">PDF, PNG or JPEG</span>
            </div>
          )}
    </div>
  );
}

/* ---------- Brand ---------- */

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <IconPrinter />
    </span>
  );
}
