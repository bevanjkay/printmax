/**
 * Keyword names for the IPP enum attributes a print UI actually exposes.
 * Source: IANA IPP registrations. Both directions are derived from one table.
 */
const ENUM_TABLES: Record<string, Record<number, string>> = {
  "finishings": {
    3: "none",
    4: "staple",
    5: "punch",
    6: "cover",
    7: "bind",
    8: "saddle-stitch",
    9: "edge-stitch",
    10: "fold",
    11: "trim",
    12: "bale",
    13: "booklet-maker",
    14: "jog-offset",
    15: "coat",
    16: "laminate",
    20: "staple-top-left",
    21: "staple-bottom-left",
    22: "staple-top-right",
    23: "staple-bottom-right",
    24: "edge-stitch-left",
    25: "edge-stitch-top",
    26: "edge-stitch-right",
    27: "edge-stitch-bottom",
    28: "staple-dual-left",
    29: "staple-dual-top",
    30: "staple-dual-right",
    31: "staple-dual-bottom",
    32: "staple-triple-left",
    33: "staple-triple-top",
    34: "staple-triple-right",
    35: "staple-triple-bottom",
    50: "bind-left",
    51: "bind-top",
    52: "bind-right",
    53: "bind-bottom",
    60: "trim-after-pages",
    61: "trim-after-documents",
    62: "trim-after-copies",
    63: "trim-after-job",
    70: "punch-top-left",
    71: "punch-bottom-left",
    72: "punch-top-right",
    73: "punch-bottom-right",
    74: "punch-dual-left",
    75: "punch-dual-top",
    76: "punch-dual-right",
    77: "punch-dual-bottom",
    78: "punch-triple-left",
    79: "punch-triple-top",
    80: "punch-triple-right",
    81: "punch-triple-bottom",
    82: "punch-quad-left",
    83: "punch-quad-top",
    84: "punch-quad-right",
    85: "punch-quad-bottom",
    86: "punch-multiple-left",
    87: "punch-multiple-top",
    88: "punch-multiple-right",
    89: "punch-multiple-bottom",
    90: "fold-accordion",
    91: "fold-double-gate",
    92: "fold-gate",
    93: "fold-half",
    94: "fold-half-z",
    95: "fold-left-gate",
    96: "fold-letter",
    97: "fold-parallel",
    98: "fold-poster",
    99: "fold-right-gate",
    100: "fold-z",
    101: "fold-engineering-z",
  },
  "print-quality": { 3: "draft", 4: "normal", 5: "high" },
  "orientation-requested": { 3: "portrait", 4: "landscape", 5: "reverse-landscape", 6: "reverse-portrait", 7: "none" },
  "job-state": {
    3: "pending",
    4: "pending-held",
    5: "processing",
    6: "processing-stopped",
    7: "canceled",
    8: "aborted",
    9: "completed",
  },
  "printer-state": { 3: "idle", 4: "processing", 5: "stopped" },
};

/** Enum attributes are named `foo`, `foo-default`, `foo-supported`, ...; map all of them to one table. */
function tableFor(attrName: string): Record<number, string> | undefined {
  const base = attrName.replace(/-(default|supported|actual|ready)$/, "");
  return ENUM_TABLES[base];
}

/** Every registered keyword for an enum attribute, in numeric order. */
export function enumKeywords(attrName: string): string[] {
  return Object.values(tableFor(attrName) ?? {});
}

export function enumName(attrName: string, value: number): string {
  return tableFor(attrName)?.[value] ?? String(value);
}

export function enumValue(attrName: string, name: string | number): number | undefined {
  if (typeof name === "number")
    return name;
  if (/^\d+$/.test(name))
    return Number(name);
  const table = tableFor(attrName);
  if (!table)
    return undefined;
  for (const [num, keyword] of Object.entries(table)) {
    if (keyword === name)
      return Number(num);
  }
  return undefined;
}
