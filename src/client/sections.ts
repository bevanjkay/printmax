/** Which sections of a collapsible list the reader has opened or shut, and the search they did it during. */
export interface SectionToggles {
  query: string;
  sections: Record<string, boolean>;
}

/**
 * A search opens every section it found matches in. A toggle belongs to the search that was
 * running when it was made, so changing or clearing the search starts from that default again
 * rather than leaving a group the reader shut earlier hiding its own matches.
 */
export function sectionOpen(toggles: SectionToggles, key: string, query: string): boolean {
  return (toggles.query === query ? toggles.sections[key] : undefined) ?? query !== "";
}

export function withSection(toggles: SectionToggles, query: string, key: string, open: boolean): SectionToggles {
  return { query, sections: { ...(toggles.query === query ? toggles.sections : {}), [key]: open } };
}
