/**
 * Helpers for the first-run flow: the student names a major and catalog year,
 * we send them to the official catalog to find and import that roadmap, then
 * spot it once the extension has imported it.
 *
 * Nothing here knows which programs exist: program ids (poid) only come from
 * the catalog itself, via search results or a pasted link.
 */

export const CATALOG_ORIGIN = "https://catalog.sjsu.edu";
/** The MyRoadmaps catalog, which holds every year's roadmaps. */
export const ROADMAPS_CATOID = 10;
/** Earliest catalog year offered in the picker. */
const FIRST_YEAR = 2018;

/** Summary of an imported program, as returned by GET /api/catalog/programs. */
export interface ProgramSummary {
  catoid: number;
  poid: number;
  title: string;
  name: string;
  degree?: string;
  catalogYear?: string;
}

/** Catalog years, newest first. A new year ("2026-2027") appears each August. */
export function catalogYears(now = new Date()): string[] {
  const latest = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const out: string[] = [];
  for (let y = latest; y >= FIRST_YEAR; y--) out.push(`${y}-${y + 1}`);
  return out;
}

/**
 * The catalog's own program search for `major`. Results list every year and
 * degree of that major; the student opens the one matching their year.
 * (search_advanced.php is off-limits to crawlers, but this is a link a person
 * clicks, the same as using the search box.)
 */
export function programSearchUrl(major: string, catoid = ROADMAPS_CATOID): string {
  const params = new URLSearchParams({
    cur_cat_oid: String(catoid),
    search_database: "Search",
    search_db: "Search",
    cpage: "1",
    ecpage: "1",
    ppage: "1",
    spage: "1",
    tpage: "1",
    location: "3", // Programs
    "filter[keyword]": major.trim(),
    "filter[exact_match]": "1",
  });
  return `${CATALOG_ORIGIN}/search_advanced.php?${params}`;
}

export const programUrl = (catoid: number, poid: number) =>
  `${CATALOG_ORIGIN}/preview_program.php?catoid=${catoid}&poid=${poid}`;

/** Reads catoid/poid from a pasted catalog program link, or returns undefined. */
export function parseProgramUrl(input: string): { catoid: number; poid: number } | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.hostname !== new URL(CATALOG_ORIGIN).hostname) return undefined;
  const catoid = Number(url.searchParams.get("catoid"));
  const poid = Number(url.searchParams.get("poid"));
  return Number.isInteger(catoid) && catoid > 0 && Number.isInteger(poid) && poid > 0 ? { catoid, poid } : undefined;
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

/** Imported programs for this major and year (every degree, e.g. both BA and BS). */
export function findPrograms(programs: ProgramSummary[], major: string, year: string): ProgramSummary[] {
  const m = norm(major);
  if (!m) return [];
  return programs.filter((p) => norm(p.name) === m && p.catalogYear === year);
}
