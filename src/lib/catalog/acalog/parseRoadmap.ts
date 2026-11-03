import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { RoadmapSchema, type CourseRef, type Roadmap, type RoadmapSlot, type RoadmapTerm } from "../types";
import { clean, courseRef, dedupe } from "./dom";

/**
 * Parses a MyRoadmaps program page (preview_program.php, catoid=10) into a
 * Roadmap: Year N headings, term headings, and one slot per list item.
 *
 * Course references are read by `courseRef` (./dom), which handles every link form.
 */
export function parseRoadmapPage(html: string): Roadmap {
  const $ = cheerio.load(html);

  const own = html.match(/portfolio\.php\?catoid=(\d+)&(?:amp;)?add=1&(?:amp;)?poid=(\d+)/);
  if (!own) throw new Error("Not a program page: missing program id");
  const catoid = Number(own[1]);
  const poid = Number(own[2]);

  const title = clean($("#acalog-page-title").text());
  const titleMatch = title.match(/^(.*?),\s*([A-Z][A-Za-z.]*)\s*(?:\((\d{4}-\d{4})\))?$/);

  const terms: RoadmapTerm[] = [];
  let year = 0;
  let notes = "";
  let notesCourses: CourseRef[] = [];

  $(".acalog-core").each((_, el) => {
    const block = $(el);
    const heading = clean(block.children("h2, h3, h4").first().text());
    const yearMatch = heading.match(/^Year\s+(\d+)/i);
    if (yearMatch) {
      year = Number(yearMatch[1]);
      return;
    }
    const termMatch = heading.match(/\b(Fall|Spring|Summer|Winter)\b.*?(?:\((\d+(?:\.\d+)?)\s*units?\))?$/i);
    if (termMatch && year > 0) {
      const season = cap(termMatch[1]) as RoadmapTerm["season"];
      const slots = block
        .children("ul")
        .children("li")
        .toArray()
        .map((li, i) => parseSlot($, li, `y${year}-${season.toLowerCase()}-${i + 1}`));
      terms.push({ year, season, units: termMatch[2] ? Number(termMatch[2]) : undefined, slots });
      return;
    }
    if (/notes/i.test(heading)) {
      const body = block.clone();
      body.children("h2, h3, h4").remove();
      notes = clean(body.text());
      notesCourses = dedupe(body.find("a, span.acalog-permalink-inactive").toArray().flatMap((n) => courseRef($, n) ?? []));
    }
  });

  return RoadmapSchema.parse({
    catoid,
    poid,
    title,
    name: titleMatch?.[1] ?? title,
    degree: titleMatch?.[2],
    catalogYear: titleMatch?.[3],
    terms,
    notes,
    notesCourses,
    sourceUrl: `https://catalog.sjsu.edu/preview_program.php?catoid=${catoid}&poid=${poid}`,
  });
}

type Piece = { type: "text"; text: string } | { type: "course"; ref: CourseRef } | { type: "sup"; text: string };

/** Flattens a list item into text / course / footnote pieces in document order. */
function pieces($: cheerio.CheerioAPI, node: AnyNode, out: Piece[] = []): Piece[] {
  for (const child of $(node).contents().toArray()) {
    if (child.type === "text") {
      out.push({ type: "text", text: (child as unknown as { data: string }).data });
      continue;
    }
    if (child.type !== "tag") continue;
    const el = child as Element;
    if (/display:\s*none/.test(el.attribs.style ?? "")) continue;
    if (el.name === "sup") {
      out.push({ type: "sup", text: clean($(el).text()) });
      continue;
    }
    const ref = courseRef($, el);
    if (ref) out.push({ type: "course", ref });
    else pieces($, el, out);
  }
  return out;
}

/**
 * Walks the pieces with a small mode machine:
 *   main       courses become separate options (OR / "," / "/" all mean "any one of")
 *   bundle     "(or X and Y)": courses inside become one combined option
 *   recommend  "[Recommended ...]" / "(recommend ...)": suggestions, not options
 *   note       everything after "Note:"
 */
type Mode = "main" | "bundle" | "recommend" | "note";

function parseSlot($: cheerio.CheerioAPI, li: Element, id: string): RoadmapSlot {
  const ps = pieces($, li);
  const options: CourseRef[][] = [];
  const recommended: CourseRef[] = [];
  const footnotes: string[] = [];
  let bundle: CourseRef[] | null = null;
  let mode: Mode = "main";
  let mainText = "";
  let noteText = "";

  for (const p of ps) {
    if (p.type === "sup") {
      if (p.text) footnotes.push(p.text);
      continue;
    }
    if (p.type === "course") {
      if (mode === "note") noteText += ` ${p.ref.code}`;
      else {
        mainText += ` ${p.ref.code}${p.ref.title ? ` - ${p.ref.title}` : ""}`;
        if (mode === "recommend") recommended.push(p.ref);
        else if (mode === "bundle") bundle!.push(p.ref);
        else options.push([p.ref]);
      }
      continue;
    }
    // Text: scan for mode switches in order.
    let text = p.text.replace(/\u00a0/g, " ");
    while (text) {
      if (mode === "note") {
        noteText += text;
        break;
      }
      const current: Mode = mode;
      const switches: { to: Mode; m: RegExpMatchArray | null }[] = [
        { re: /note:/i, to: "note" as const },
        { re: /\[\s*recommended|\(\s*recommend(?:ed)?/i, to: "recommend" as const },
        { re: /\(\s*or\b/i, to: "bundle" as const },
        { re: current === "recommend" ? /[\])]/ : current === "bundle" ? /\)/ : /$^/, to: "main" as const },
      ]
        .map((sw) => ({ to: sw.to, m: text.match(sw.re) }))
        .filter((sw) => sw.m && sw.to !== current)
        .sort((x, y) => x.m!.index! - y.m!.index!);
      const next = switches[0];
      if (!next) {
        mainText += text;
        break;
      }
      const at = next.m!.index!;
      const cut = at + next.m![0].length;
      mainText += text.slice(0, next.to === "note" ? at : cut);
      if (current === "bundle" && bundle?.length) options.push(bundle);
      if (next.to === "bundle") bundle = [];
      mode = next.to;
      text = text.slice(cut);
    }
  }
  if (mode === "bundle" && bundle?.length) options.push(bundle);

  const label = clean(mainText);
  const unitsMatch = label.match(/(\d+(?:\.\d+)?)\s*unit\(s\)/i);
  const tags = [...new Set([...label.matchAll(/\(([A-Z][A-Z0-9+]{0,9})\)/g)].map((m) => m[1]))];
  const geAreas = parseGeAreas(label);

  let kind: RoadmapSlot["kind"];
  if (options.length) kind = "course";
  else if (!unitsMatch) kind = "milestone";
  else if (geAreas.length) kind = "ge";
  else kind = "elective";

  return {
    id,
    kind,
    label,
    units: unitsMatch ? Number(unitsMatch[1]) : undefined,
    options,
    geAreas,
    recommended: dedupe(recommended),
    tags,
    footnotes,
    ...(noteText.trim() ? { note: clean(noteText) } : {}),
  };
}

/** "GE Area D + US123" gives [D, US123]; "GE Area C1 or C2" gives [C1, C2]; "SJSU Studies Area R" gives [R]. */
function parseGeAreas(label: string): string[] {
  const m = label.match(/^(?:GE|SJSU Studies)\s+Area\s+(.*?)(?:\s*\(|\s+\d+(?:\.\d+)?\s*unit|$)/i);
  if (!m) return [];
  return m[1].split(/\s*(?:\+|\bor\b|,|\/)\s*/i).map((s) => s.trim()).filter(Boolean);
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}
