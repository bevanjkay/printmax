import type { ValidationResult } from "../../shared/types.js";
import type { OptionValues } from "./OptionsForm.js";
import { Button, Notice } from "./ui.js";

interface Props {
  result: ValidationResult | null;
  value: OptionValues;
  onApply: (resolved: OptionValues) => void;
}

/** Validation problems from the printer's capabilities, with the printer's own resolver as a one-click fix. */
export function ValidationNotice({ result, value, onApply }: Props) {
  if (!result || result.errors.length === 0)
    return null;
  const canFix = JSON.stringify(result.resolved) !== JSON.stringify(value);
  return (
    <Notice tone="error">
      <strong>The printer can't do this combination.</strong>
      <ul>
        {result.errors.map(e => <li key={e}>{e}</li>)}
      </ul>
      {canFix && <Button size="sm" onClick={() => onApply(result.resolved)}>Apply the printer's suggested fix</Button>}
    </Notice>
  );
}
