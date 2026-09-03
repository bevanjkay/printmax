import { useEffect, useState } from "react";
import { Button } from "./ui.js";

interface Props {
  label: string;
  confirmLabel?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  onConfirm: () => void;
}

/** Two-click destructive action: the first click arms the button, the second within a few seconds fires it. */
export function ConfirmButton({ label, confirmLabel = "Confirm?", size = "md", disabled, onConfirm }: Props) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed)
      return;
    const timer = setTimeout(setArmed, 4000, false);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      variant="danger"
      size={size}
      className={armed ? "armed" : ""}
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
    </Button>
  );
}
