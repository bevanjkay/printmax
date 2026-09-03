import { useEffect, useState } from "react";

interface Props {
  label: string;
  confirmLabel?: string;
  className?: string;
  disabled?: boolean;
  onConfirm: () => void;
}

/** Two-click destructive action: the first click arms the button, the second within a few seconds fires it. */
export function ConfirmButton({ label, confirmLabel = "Confirm?", className = "", disabled, onConfirm }: Props) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed)
      return;
    const timer = setTimeout(setArmed, 4000, false);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={`${className} ${armed ? "armed" : ""}`.trim()}
      disabled={disabled}
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
      {armed ? confirmLabel : label}
    </button>
  );
}
