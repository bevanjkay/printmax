import type { FormField } from "../shared/types.js";
/**
 * Generates the option editor for a printer from its own capabilities:
 * `job-creation-attributes-supported` is the field list, `<attr>-supported` the choices,
 * `<attr>-default` the initial value. Only labels and widget types are static.
 */
import type { IppAttributes, IppLangString, IppRange, IppResolution, IppValue } from "./ipp/codec.js";
import { ATTRIBUTE_UI, HIDDEN_ATTRIBUTES, keywordLabel } from "../shared/attributes.js";
import { enumName } from "../shared/enums.js";
import { attrValue, attrValues, isOutOfBand } from "./ipp/codec.js";

const ORDER = Object.keys(ATTRIBUTE_UI);

function displayValue(name: string, type: string, v: IppValue): string | number {
  if (typeof v === "number")
    return type === "enum" ? enumName(name, v) : v;
  if (typeof v === "object" && v !== null) {
    if ("x" in v && "units" in v) {
      const r = v as IppResolution;
      const unit = r.units === 4 ? "dpcm" : "dpi";
      return r.x === r.y ? `${r.x}${unit}` : `${r.x}x${r.y}${unit}`;
    }
    if ("min" in v) {
      const r = v as IppRange;
      return `${r.min}-${r.max}`;
    }
    if ("language" in v && "text" in v)
      return (v as IppLangString).text;
    return JSON.stringify(v);
  }
  if (v === null)
    return "";
  return typeof v === "boolean" ? String(v) : v;
}

export function buildForm(caps: IppAttributes): FormField[] {
  const creatable = attrValues<string>(caps, "job-creation-attributes-supported");
  const candidates = creatable.length > 0
    ? creatable
    : Object.keys(caps).filter(k => k.endsWith("-supported")).map(k => k.slice(0, -"-supported".length));

  const fields: FormField[] = [];
  for (const name of candidates) {
    if (HIDDEN_ATTRIBUTES.has(name))
      continue;
    const ui = ATTRIBUTE_UI[name];
    const supported = caps[`${name}-supported`];
    const supportedValues = supported && !isOutOfBand(supported.type) ? supported.values : [];
    const def = attrValue<IppValue>(caps, `${name}-default`);
    const widget = ui?.widget ?? (supported?.type === "rangeOfInteger" ? "number" : "select");

    const field: FormField = {
      name,
      label: ui?.label ?? keywordLabel(name),
      widget,
      ...(ui?.help ? { help: ui.help } : {}),
    };

    if (supported?.type === "boolean") {
      if (supportedValues[0] !== true)
        continue;
      // e.g. page-ranges-supported = true: free text, no enumerated choices
      field.widget = ui?.widget ?? "text";
    }
    else if (name === "job-priority") {
      field.widget = "number";
      field.min = 1;
      field.max = 100;
    }
    else if (supported?.type === "rangeOfInteger") {
      const range = supportedValues[0] as { min: number; max: number } | undefined;
      if (range) {
        field.min = range.min;
        field.max = range.max;
      }
      if (field.widget !== "number")
        field.widget = "number";
    }
    else if (widget === "select" || widget === "multiselect") {
      if (supportedValues.length === 0)
        continue;
      field.choices = supportedValues.map(v => ({ value: displayValue(name, supported!.type, v), label: keywordLabel(displayValue(name, supported!.type, v)) }));
      if (field.choices.length === 1 && (field.widget === "multiselect" || !ui))
        continue; // nothing to choose
    }
    else if (!ui) {
      continue; // unknown free-form attribute; not worth a widget without a label
    }

    const defAttr = caps[`${name}-default`];
    if (def !== undefined && def !== null && defAttr) {
      field.default = widget === "multiselect"
        ? attrValues<IppValue>(caps, `${name}-default`).map(v => displayValue(name, defAttr.type, v))
        : displayValue(name, defAttr.type, def);
    }
    fields.push(field);
  }

  fields.sort((a, b) => {
    const ia = ORDER.indexOf(a.name);
    const ib = ORDER.indexOf(b.name);
    return (ia === -1 ? ORDER.length : ia) - (ib === -1 ? ORDER.length : ib) || a.name.localeCompare(b.name);
  });
  return fields;
}

/** Initial option map for a printer: every field's default, in option-map form. */
export function defaultOptions(fields: FormField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.default !== undefined)
      out[f.name] = f.default;
  }
  return out;
}
