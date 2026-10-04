import { useEffect, useState } from "react";
import { Button } from "./ui.js";

interface Props {
  label: string;
  confirmLabel?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  onConfirm: () => void;
}

/**
 * Two-click destructive action: the first click arms the button, the second fires it. It disarms a
 * few seconds after focus leaves, so someone reading the new label with a screen reader isn't timed out.
 */
export function ConfirmButton({ label, confirmLabel = "Confirm?", size = "md", disabled, onConfirm }: Props) {
  const [armed, setArmed] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!armed || focused)
      return;
    const timer = setTimeout(setArmed, 4000, false);
    return () => clearTimeout(timer);
  }, [armed, focused]);

  return (
    <>
      <Button
        variant="danger"
        size={size}
        className={armed ? "armed" : ""}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape")
            setArmed(false);
        }}
        onClick={() => {
          if (armed) {
            setArmed(false);
            onConfirm();
          }
          else {
            setArmed(true);
          }
        }}
      >
        <span className="swap">
          <span className={armed ? "off" : undefined}>{label}</span>
          <span className={armed ? undefined : "off"}>{confirmLabel}</span>
        </span>
      </Button>
      <span className="sr-only" aria-live="polite">{armed ? `${confirmLabel} Press again to confirm.` : ""}</span>
    </>
  );
}
