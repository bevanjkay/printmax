import type { FormField } from "../../shared/types.js";

export type OptionValues = Record<string, unknown>;

interface Props {
  fields: FormField[];
  value: OptionValues;
  onChange: (next: OptionValues) => void;
  disabled?: boolean;
}

export function OptionsForm({ fields, value, onChange, disabled }: Props) {
  const set = (name: string, v: unknown) => {
    const next = { ...value };
    if (v === "" || v === undefined || (Array.isArray(v) && v.length === 0))
      delete next[name];
    else
      next[name] = v;
    onChange(next);
  };

  return (
    <div className="options">
      {fields.map((f) => {
        const current = value[f.name];
        switch (f.widget) {
          case "select":
            return (
              <label key={f.name}>
                {f.label}
                <select disabled={disabled} value={String(current ?? "")} onChange={e => set(f.name, e.target.value)}>
                  {current === undefined && <option value="">(printer default)</option>}
                  {f.choices?.map(c => <option key={String(c.value)} value={String(c.value)}>{c.label}</option>)}
                </select>
                {f.help && <small className="muted">{f.help}</small>}
              </label>
            );
          case "multiselect": {
            const selected = Array.isArray(current) ? current.map(String) : current === undefined ? [] : [String(current)];
            return (
              <fieldset key={f.name} className="multiselect">
                <legend>{f.label}</legend>
                {f.choices?.map(c => (
                  <label key={String(c.value)} className="inline">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={selected.includes(String(c.value))}
                      onChange={(e) => {
                        const v = String(c.value);
                        const next = e.target.checked ? [...selected.filter(s => s !== v), v] : selected.filter(s => s !== v);
                        set(f.name, next);
                      }}
                    />
                    {c.label}
                  </label>
                ))}
              </fieldset>
            );
          }
          case "number":
            return (
              <label key={f.name}>
                {f.label}
                <input
                  type="number"
                  disabled={disabled}
                  min={f.min}
                  max={f.max}
                  value={current === undefined ? "" : Number(current)}
                  onChange={e => set(f.name, e.target.value === "" ? "" : Number(e.target.value))}
                />
                {f.help && <small className="muted">{f.help}</small>}
              </label>
            );
          default:
            return (
              <label key={f.name}>
                {f.label}
                <input
                  type={f.widget === "password" ? "password" : "text"}
                  disabled={disabled}
                  autoComplete="off"
                  value={String(current ?? "")}
                  onChange={e => set(f.name, e.target.value)}
                />
                {f.help && <small className="muted">{f.help}</small>}
              </label>
            );
        }
      })}
    </div>
  );
}
