import type * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { CourseRef } from "../types";

/** Collapses whitespace (incl. nbsp / zero-width space) and tidies space before punctuation. */
export function clean(s: string): string {
  return s.replace(/[\u00a0\u200b]/g, " ").replace(/\s+/g, " ").replace(/\s+([,.)\]])/g, "$1").trim();
}

const CODE_RE = /^([A-Z]{2,6})\s+(\d{1,3}[A-Z]{0,3})\b\s*(?:-\s*(.+))?$/;

/**
 * Reads a course reference from a link or an inactive-permalink span, in any
 * of the forms Acalog renders:
 *   <a href="preview_course_nopop.php?...&coid=N">CS 46A - Title</a>
 *   <a href="#tt841" onclick="...coid=N...">PHYS 50</a>                 (tooltip link)
 *   <a href="#..." onclick="showCatalogData('10', '3', 'N', ...)">      (expanded inline when saved)
 *   <span class="acalog-permalink-inactive">CS 42X</span>              (no coid)
 */
export function courseRef($: cheerio.CheerioAPI, node: AnyNode): CourseRef | null {
  if (node.type !== "tag") return null;
  const el = node as Element;
  const isLink = el.name === "a";
  const isInactive = el.name === "span" && /acalog-permalink-inactive/.test(el.attribs.class ?? "");
  if (!isLink && !isInactive) return null;
  const m = clean($(el).text()).match(CODE_RE);
  if (!m) return null;
  const attrs = isLink ? `${el.attribs.href ?? ""} ${el.attribs.onclick ?? ""} ${el.attribs.rel ?? ""}` : "";
  const coid = attrs.match(/coid=(\d+)/) ?? attrs.match(/showCatalogData\('\d+',\s*'\d+',\s*'(\d+)'/);
  return {
    code: `${m[1]} ${m[2]}`,
    ...(coid ? { coid: Number(coid[1]) } : {}),
    ...(m[3] ? { title: m[3].trim() } : {}),
  };
}

export function dedupe(refs: CourseRef[]): CourseRef[] {
  const seen = new Map<string, CourseRef>();
  for (const r of refs) if (!seen.has(r.code)) seen.set(r.code, r);
  return [...seen.values()];
}
