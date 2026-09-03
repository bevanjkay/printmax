import type { ValidationResult } from "../../shared/types.js";
import type { OptionValues } from "./OptionsForm.js";

interface Props {
  result: ValidationResult | null;
  value: OptionValues;
  onApply: (resolved: OptionValues) => void;
}

/** Shows validation problems and, when the printer published a resolver, a one-click fix. */
export function ValidationNotice({ result, value, onApply }: Props) {
  if (!result || result.errors.length === 0)
    return null;
  const canFix = JSON.stringify(result.resolved) !== JSON.stringify(value);
  return (
    <div className="notice error">
      <ul>
        {result.errors.map(e => <li key={e}>{e}</li>)}
      </ul>
      {canFix && <button type="button" className="small" onClick={() => onApply(result.resolved)}>Apply suggested fix</button>}
    </div>
  );
}
