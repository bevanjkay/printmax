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
  if (!result)
    return null;
  // What is wrong with the layout is said beside the layout, in its own words, not as the printer's objection.
  const errors = result.errors.filter(e => !result.layout.errors.includes(e));
  const warnings = result.warnings.filter(w => !result.layout.warnings.includes(w));
  if (errors.length === 0 && warnings.length === 0)
    return null;
  if (errors.length === 0) {
    return (
      <Notice tone="warning">
        <strong>Check this before you print.</strong>
        <ul>
          {warnings.map(w => <li key={w}>{w}</li>)}
        </ul>
      </Notice>
    );
  }
  const canFix = JSON.stringify(result.resolved) !== JSON.stringify(value);
  return (
    <Notice tone="error">
      <strong>The printer can't do this combination.</strong>
      <ul>
        {errors.map(e => <li key={e}>{e}</li>)}
      </ul>
      {canFix && <Button size="sm" onClick={() => onApply(result.resolved)}>Apply the printer's suggested fix</Button>}
    </Notice>
  );
}
