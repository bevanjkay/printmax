/**
 * The single validation entry point, called on preset save, job build and before submit.
 */
import type { IppAttributes } from "./ipp/codec.js";
import { checkConstraints, describeViolation } from "./ipp/constraints.js";
import { validateOptions } from "./ipp/options.js";

export function validateJobOptions(options: Record<string, unknown>, caps: IppAttributes): string[] {
  const errors = validateOptions(options, caps);
  if (errors.length > 0)
    return errors;
  try {
    return checkConstraints(options, caps).map(describeViolation);
  }
  catch (err) {
    return [(err as Error).message];
  }
}
