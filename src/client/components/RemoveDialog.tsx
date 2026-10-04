import type { RemovalImpact } from "../../shared/types.js";
import { useId, useRef, useState } from "react";
import { useAsyncError } from "../util.js";
import { Spinner } from "./Icons.js";
import { Button, Notice } from "./ui.js";

interface Props {
  label: string;
  title: string;
  confirmLabel: string;
  disabled?: boolean;
  load: () => Promise<RemovalImpact>;
  describe: (impact: RemovalImpact) => string;
  onConfirm: () => Promise<unknown>;
}

/**
 * For removals that take other things with them: counts what goes before asking, in a modal so the
 * answer is a deliberate choice rather than a second click on the same spot.
 */
export function RemoveDialog({ label, title, confirmLabel, disabled, load, describe, onConfirm }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [impact, setImpact] = useState<RemovalImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const { error, fail, clear } = useAsyncError();

  function open() {
    clear();
    setImpact(null);
    dialogRef.current?.showModal();
    load().then(setImpact).catch(fail);
  }

  async function confirm() {
    setBusy(true);
    clear();
    try {
      await onConfirm();
      dialogRef.current?.close();
    }
    catch (err) {
      fail(err);
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="danger" disabled={disabled} onClick={open}>{label}</Button>
      <dialog ref={dialogRef} className="dialog" aria-labelledby={titleId}>
        <div className="dialog-body">
          <h2 id={titleId}>{title}</h2>
          {impact
            ? <p>{describe(impact)}</p>
            : !error && (
                <p className="row muted">
                  <Spinner className="icon spinner" />
                  Checking what goes with it…
                </p>
              )}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
        <footer className="dialog-footer">
          <Button onClick={() => dialogRef.current?.close()}>Keep it</Button>
          <Button variant="danger" className="armed" loading={busy} disabled={!impact} onClick={() => void confirm()}>{confirmLabel}</Button>
        </footer>
      </dialog>
    </>
  );
}
