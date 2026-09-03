import type { FormChoice, FormField } from "../../shared/types.js";
import { IconPlus } from "./Icons.js";
import { Field } from "./ui.js";

export type OptionValues = Record<string, unknown>;

interface Props {
  fields: FormField[];
  value: OptionValues;
  onChange: (next: OptionValues) => void;
  disabled?: boolean;
  /** Render two- or three-way choices as toggles and copies as a stepper; for the quick-options row. */
  friendly?: boolean;
}

function Segmented({ choices, value, disabled, onChange }: { choices: FormChoice[]; value: string; disabled?: boolean; onChange: (v: string) => void }) {
  return (
    <div className="segmented full" role="group">
      {choices.map(c => (
        <button key={String(c.value)} type="button" className={String(c.value) === value ? "active" : ""} disabled={disabled} aria-pressed={String(c.value) === value} onClick={() => onChange(String(c.value))}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({ value, min, max, disabled, onChange }: { value: number; min: number; max: number; disabled?: boolean; onChange: (v: number) => void }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
  return (
    <div className="stepper">
      <button type="button" disabled={disabled || value <= min} aria-label="Fewer copies" onClick={() => onChange(clamp(value - 1))}>−</button>
      <input className="control" type="number" inputMode="numeric" min={min} max={max} disabled={disabled} value={value} onChange={e => onChange(clamp(Number(e.target.value)))} aria-label="Copies" />
      <button type="button" disabled={disabled || value >= max} aria-label="More copies" onClick={() => onChange(clamp(value + 1))}><IconPlus /></button>
    </div>
  );
}

/** The generated option editor: one control per printer-reported job attribute. */
export function OptionsForm({ fields, value, onChange, disabled, friendly }: Props) {
  const set = (name: string, v: unknown) => {
    const next = { ...value };
    if (v === "" || v === undefined || (Array.isArray(v) && v.length === 0))
      delete next[name];
    else
      next[name] = v;
    onChange(next);
  };

  return (
    <div className="form-grid">
      {fields.map((f) => {
        const current = value[f.name];
        if (friendly && f.widget === "select" && (f.choices?.length ?? 0) < 2)
          return null; // nothing to decide
        switch (f.widget) {
          case "select":
            if (friendly && f.choices && f.choices.length >= 2 && f.choices.length <= 3) {
              return (
                <div key={f.name} className="field">
                  <span className="field-label">{f.label}</span>
                  <Segmented choices={f.choices} value={String(current ?? f.default ?? "")} disabled={disabled} onChange={v => set(f.name, v)} />
                </div>
              );
            }
            return (
              <Field key={f.name} label={f.label} hint={f.help}>
                <select className="control" disabled={disabled} value={String(current ?? "")} onChange={e => set(f.name, e.target.value)}>
                  {current === undefined && <option value="">Printer default</option>}
                  {f.choices?.map(c => <option key={String(c.value)} value={String(c.value)}>{c.label}</option>)}
                </select>
              </Field>
            );
          case "multiselect": {
            const selected = Array.isArray(current) ? current.map(String) : current === undefined ? [] : [String(current)];
            return (
              <div key={f.name} className="field">
                <span className="field-label">{f.label}</span>
                <div className="check-group">
                  {f.choices?.map(c => (
                    <label key={String(c.value)} className="check">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={selected.includes(String(c.value))}
                        onChange={(e) => {
                          const v = String(c.value);
                          set(f.name, e.target.checked ? [...selected.filter(s => s !== v), v] : selected.filter(s => s !== v));
                        }}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
                {f.help && <span className="field-hint">{f.help}</span>}
              </div>
            );
          }
          case "number":
            if (friendly && f.name === "copies") {
              return (
                <div key={f.name} className="field">
                  <span className="field-label">{f.label}</span>
                  <Stepper value={Number(current ?? f.default ?? 1)} min={f.min ?? 1} max={f.max ?? 999} disabled={disabled} onChange={v => set(f.name, v)} />
                </div>
              );
            }
            return (
              <Field key={f.name} label={f.label} hint={f.help}>
                <input
                  className="control"
                  type="number"
                  inputMode="numeric"
                  disabled={disabled}
                  min={f.min}
                  max={f.max}
                  value={current === undefined ? "" : Number(current)}
                  onChange={e => set(f.name, e.target.value === "" ? "" : Number(e.target.value))}
                />
              </Field>
            );
          default:
            return (
              <Field key={f.name} label={f.label} hint={f.help}>
                <input
                  className="control"
                  type={f.widget === "password" ? "password" : "text"}
                  disabled={disabled}
                  autoComplete="off"
                  value={String(current ?? "")}
                  onChange={e => set(f.name, e.target.value)}
                />
              </Field>
            );
        }
      })}
    </div>
  );
}
