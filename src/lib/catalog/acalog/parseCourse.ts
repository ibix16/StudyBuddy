import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { parsePrereqText } from "../prereqParser";
import { CourseSchema, normalizeCourseId, type Course, type CourseRef } from "../types";
import { clean, courseRef, dedupe } from "./dom";

/**
 * Parses a course page (preview_course_nopop.php). The body is a flat run of
 * nodes after <h1 id="course_preview_title">:
 *
 *   <hr> <em>3</em> <em>units</em> <br> description...
 *   <strong>Prerequisite(s):</strong> ...  <strong>Corequisite(s):</strong> ...
 *   <strong>Grading:</strong> ...  <hr>  (footer links)
 *
 * so we walk siblings until the closing <hr>, starting a new section at each
 * "<strong>Label:</strong>".
 */
export function parseCoursePage(html: string, ids?: { catoid: number; coid: number }): Course {
  const $ = cheerio.load(html);

  // The page's "add to favorites" link carries its ids, but it isn't present on every
  // response, so callers that know the ids (the importer built the URL) pass them in.
  const own = html.match(/portfolio_nopop\.php\?catoid=(\d+)&(?:amp;)?add=1&(?:amp;)?coid=(\d+)/);
  const catoid = own ? Number(own[1]) : ids?.catoid;
  const coid = own ? Number(own[2]) : ids?.coid;
  if (catoid === undefined || coid === undefined) throw new Error("Not a course page: missing course id");

  const h1 = $("#course_preview_title");
  const heading = clean(h1.text()).match(/^([A-Z]{2,6})\s+(\d{1,3}[A-Z]{0,3})\s*-\s*(.+)$/);
  if (!heading) {
    const title = clean($("title").first().text());
    throw new Error(h1.length ? `Unrecognized course title: "${clean(h1.text())}"` : `No course title on page "${title}"`);
  }
  const [, subject, number, title] = heading;

  const sections = new Map<string, { text: string; refs: CourseRef[] }>([["body", { text: "", refs: [] }]]);
  let current = sections.get("body")!;
  let seenHr = false;

  const siblings = h1.parent().contents().toArray();
  for (const node of siblings.slice(siblings.indexOf(h1[0]) + 1)) {
    if (node.type === "tag") {
      const el = node as Element;
      if (el.name === "hr") {
        if (seenHr) break;
        seenHr = true;
        continue;
      }
      if (el.name === "p") break; // footer links (Class Schedule | Syllabus | Bookstore)
      if (/display:\s*none/.test(el.attribs.style ?? "")) continue;
      if (el.name === "strong") {
        const label = clean($(el).text()).match(/^(.+?):$/);
        if (label) {
          current = { text: "", refs: [] };
          sections.set(sectionKey(label[1]), current);
          continue;
        }
      }
      if (el.name === "br") {
        current.text += "\n";
        continue;
      }
      const ref = courseRef($, el);
      if (ref) current.refs.push(ref);
      // Links inside other elements (rare) are still collected.
      else $(el).find("a, span.acalog-permalink-inactive").each((_, n) => {
        const r = courseRef($, n);
        if (r) current.refs.push(r);
      });
      current.text += $(el).text();
    } else if (node.type === "text") {
      current.text += (node as unknown as { data: string }).data;
    }
  }

  // Body = "<units> units\n<description>"
  const body = sections.get("body")!.text.replace(/\u00a0/g, " ").trim();
  const units = body.match(/^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*units?/i);
  const description = clean(units ? body.slice(units[0].length) : body);

  // A labeled section ends at the first blank line; anything after it is a free-form note
  // (e.g. "Cross-listed with CS 42.").
  const notes: string[] = [];
  for (const [key, sec] of sections) {
    if (key === "body") continue;
    const [first, ...rest] = sec.text.split(/\n\s*\n/);
    sec.text = first;
    if (rest.join(" ").trim()) notes.push(clean(rest.join(" ")));
  }

  const prereq = sections.get("prerequisite");
  const coreq = sections.get("corequisite");
  const prereqText = prereq ? clean(prereq.text) : undefined;
  const parsed = parsePrereqText(prereqText);

  return CourseSchema.parse({
    id: normalizeCourseId(subject, number),
    subject,
    number,
    title: clean(title),
    units: units ? Number(units[1]) : 0,
    ...(units?.[2] ? { unitsMax: Number(units[2]) } : {}),
    ...(description ? { description } : {}),
    ...(prereqText ? { prereqText } : {}),
    prereq: parsed.expr,
    prereqConfident: parsed.confident,
    ...(coreq ? { coreqText: clean(coreq.text) } : {}),
    linkedCourses: dedupe([...(prereq?.refs ?? []), ...(coreq?.refs ?? [])]),
    ...(sections.get("grading") ? { grading: clean(sections.get("grading")!.text) } : {}),
    ...(notes.length ? { notes: notes.join(" ") } : {}),
    catoid,
    coid,
    sourceUrl: `https://catalog.sjsu.edu/preview_course_nopop.php?catoid=${catoid}&coid=${coid}`,
  });
}

/** "Prerequisite(s)" becomes "prerequisite", "Pre/Corequisite(s)" becomes "pre/corequisite". */
function sectionKey(label: string): string {
  return label.toLowerCase().replace(/\(s\)$/, "").replace(/s$/, "").trim();
}
