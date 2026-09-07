/**
 * Reads the parts of a PPD (Adobe PostScript Printer Description) that matter for driving a
 * printer without CUPS: the UI options with their PostScript snippets and order, defaults,
 * constraints, paper dimensions and the JCL (PJL) wrapper. Everything else is ignored.
 */

export interface PpdChoice {
  value: string;
  label: string;
  /** PostScript emitted when this choice is selected; may be empty. */
  code: string;
}

export interface PpdOption {
  key: string;
  label: string;
  type: "PickOne" | "PickMany" | "Boolean";
  group: string;
  groupLabel: string;
  default: string | null;
  /** From *OrderDependency; options without one sort first, as CUPS does. */
  order: number;
  section: string;
  choices: PpdChoice[];
  /** Installed-hardware options (*OpenGroup: InstallableOptions); emitted but never shown. */
  installable: boolean;
}

export interface PpdConstraint {
  key1: string;
  choice1: string | null;
  key2: string;
  choice2: string | null;
}

export interface ParsedPpd {
  modelName: string;
  nickName: string;
  languageLevel: number;
  jcl: { begin: string; toPs: string; end: string } | null;
  options: PpdOption[];
  constraints: PpdConstraint[];
  /** Points, keyed by PageSize choice. */
  paperDimensions: Record<string, { width: number; height: number }>;
  /** *JobPatchFile snippets, emitted ahead of every option as CUPS does. */
  jobPatchFiles: Array<{ name: string; code: string }>;
}

interface Entry {
  key: string;
  option: string | null;
  translation: string | null;
  value: string;
  quoted: boolean;
}

/** `*Key [option[/translation]]: value`; translations may hold spaces and slashes but not colons. */
function splitEntry(line: string): { key: string; option: string | null; translation: string | null; rest: string } | undefined {
  const colon = line.indexOf(":");
  if (colon < 0)
    return undefined;
  const head = line.slice(1, colon).trim();
  const rest = line.slice(colon + 1).trim();
  const space = head.search(/\s/);
  if (space < 0)
    return { key: head, option: null, translation: null, rest };
  const key = head.slice(0, space);
  const tail = head.slice(space).trim();
  const slash = tail.indexOf("/");
  if (slash < 0)
    return { key, option: tail, translation: null, rest };
  return { key, option: tail.slice(0, slash), translation: tail.slice(slash + 1), rest };
}

/** PPD quoted strings for JCL keys carry bytes as <hex>. */
function decodeHex(s: string): string {
  return s.replace(/<([0-9a-f\s]+)>/gi, (_, hex: string) => {
    const clean = hex.replace(/\s+/g, "");
    let out = "";
    for (let i = 0; i + 1 < clean.length; i += 2)
      out += String.fromCharCode(Number.parseInt(clean.slice(i, i + 2), 16));
    return out;
  });
}

function* entries(text: string): Generator<Entry> {
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("*") || line.startsWith("*%"))
      continue;
    const m = splitEntry(line);
    if (!m)
      continue;
    const { key, option, translation, rest } = m;
    if (!rest.startsWith("\"")) {
      yield { key, option, translation, value: rest, quoted: false };
      continue;
    }
    let body = rest.slice(1);
    const close = body.indexOf("\"");
    if (close >= 0) {
      body = body.slice(0, close);
    }
    else {
      const parts = [body];
      while (++i < lines.length) {
        const next = lines[i]!;
        const end = next.indexOf("\"");
        if (end >= 0) {
          parts.push(next.slice(0, end));
          break;
        }
        parts.push(next);
      }
      body = parts.join("\n");
    }
    if (lines[i + 1]?.trim() === "*End")
      i++;
    yield { key, option, translation, value: body, quoted: true };
  }
}

function splitNameLabel(value: string): { name: string; label: string } {
  const slash = value.indexOf("/");
  return slash < 0 ? { name: value.trim(), label: value.trim() } : { name: value.slice(0, slash).trim(), label: value.slice(slash + 1).trim() };
}

export function parsePpd(text: string): ParsedPpd {
  const ppd: ParsedPpd = { modelName: "", nickName: "", languageLevel: 2, jcl: null, options: [], constraints: [], paperDimensions: {}, jobPatchFiles: [] };
  const jcl = { begin: "", toPs: "", end: "" };
  let sawJcl = false;
  let group = { name: "", label: "" };
  let current: PpdOption | null = null;
  const byKey = new Map<string, PpdOption>();
  const defaults = new Map<string, string>();
  const orders = new Map<string, { order: number; section: string }>();

  for (const e of entries(text)) {
    switch (e.key) {
      case "ModelName":
        ppd.modelName = e.value;
        break;
      case "NickName":
        ppd.nickName = e.value;
        break;
      case "LanguageLevel":
        ppd.languageLevel = Number(e.value) || 2;
        break;
      case "JCLBegin":
      case "JCLToPSInterpreter":
      case "JCLEnd":
        jcl[e.key === "JCLBegin" ? "begin" : e.key === "JCLEnd" ? "end" : "toPs"] = decodeHex(e.value);
        sawJcl = true;
        break;
      case "OpenGroup":
        group = splitNameLabel(e.value);
        break;
      case "CloseGroup":
        group = { name: "", label: "" };
        break;
      case "OpenUI": {
        const key = (e.option ?? "").replace(/^\*/, "");
        const type = e.value.trim() as PpdOption["type"];
        current = {
          key,
          label: e.translation?.trim() || key,
          type: type === "Boolean" || type === "PickMany" ? type : "PickOne",
          group: group.name,
          groupLabel: group.label,
          default: null,
          order: 0,
          section: "AnySetup",
          choices: [],
          installable: group.name === "InstallableOptions",
        };
        byKey.set(key, current);
        ppd.options.push(current);
        break;
      }
      case "CloseUI":
        current = null;
        break;
      case "OrderDependency":
      case "NonUIOrderDependency": {
        const m = /^(\d+(?:\.\d+)?)\s+(\S+)\s+\*(\S+)/.exec(e.value);
        if (m)
          orders.set(m[3]!, { order: Number(m[1]), section: m[2]! });
        break;
      }
      case "UIConstraints": {
        const m = /^\*(\S+)(?:\s+([^*\s]+))?\s+\*(\S+)(?:\s+(\S+))?/.exec(e.value);
        if (m)
          ppd.constraints.push({ key1: m[1]!, choice1: m[2] ?? null, key2: m[3]!, choice2: m[4] ?? null });
        break;
      }
      case "JobPatchFile":
        if (e.quoted && e.value.trim())
          ppd.jobPatchFiles.push({ name: e.option ?? String(ppd.jobPatchFiles.length + 1), code: e.value.trim() });
        break;
      case "PaperDimension": {
        const m = /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/.exec(e.value);
        if (e.option && m)
          ppd.paperDimensions[e.option] = { width: Number(m[1]), height: Number(m[2]) };
        break;
      }
      default:
        if (e.key.startsWith("Default") && e.option === null) {
          defaults.set(e.key.slice("Default".length), e.value.trim());
        }
        else if (current && e.key === current.key && e.option !== null && e.quoted) {
          current.choices.push({ value: e.option, label: e.translation?.trim() || e.option, code: e.value.trim() });
        }
    }
  }

  for (const option of ppd.options) {
    const def = defaults.get(option.key);
    option.default = def !== undefined && option.choices.some(c => c.value === def) ? def : null;
    const order = orders.get(option.key);
    if (order) {
      option.order = order.order;
      option.section = order.section;
    }
  }
  ppd.options = ppd.options.filter(o => o.choices.length > 0);
  if (sawJcl && (jcl.begin || jcl.toPs))
    ppd.jcl = jcl;
  return ppd;
}
