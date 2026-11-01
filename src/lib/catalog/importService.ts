import { parseCoursePage } from "./acalog/parseCourse";
import { parseRoadmapPage } from "./acalog/parseRoadmap";
import { referencedCourses } from "../engine/prereq";
import { roadmapToProgram } from "./roadmapToProgram";
import type { PrereqResolver } from "./llm/prereqLlm";
import type { CatalogStore } from "./store";
import type { Course, CourseRef, Program, Roadmap } from "./types";

/** Upper bounds on uploaded HTML; real pages are ~350 KB (program) and ~12 KB (course). */
export const MAX_PROGRAM_HTML = 2_000_000;
export const MAX_COURSE_HTML = 500_000;

export class ImportError extends Error {
  override name = "ImportError";
}

/** Checks by name: dev servers can load this module twice, which breaks `instanceof`. */
export const isImportError = (e: unknown): e is ImportError => e instanceof Error && e.name === "ImportError";

export interface ProgramImportResult {
  catoid: number;
  poid: number;
  title: string;
  /** Every course the roadmap links to, so the importer knows what to fetch. */
  courses: CourseRef[];
  /** coids from `courses` that aren't cached yet. */
  missing: number[];
}

export interface CourseImportResult {
  catoid: number;
  coid: number;
  id: string;
  prereqConfident: boolean;
  /** Linked prerequisite / corequisite courses that aren't cached yet. */
  missing: number[];
}

export interface ProgramBundle {
  roadmap: Roadmap;
  program: Program;
  courses: Course[];
  /** Course codes the program or its prerequisites mention that aren't cached. */
  missingCodes: string[];
}

/**
 * Turns page HTML posted by the browser extension into cached catalog data.
 * The HTML comes from users' browsers, so it is size-limited and only ever
 * parsed (never rendered or executed).
 */
export class ImportService {
  constructor(
    private store: CatalogStore,
    private resolver?: PrereqResolver,
  ) {}

  async importProgram(html: string): Promise<ProgramImportResult> {
    if (html.length > MAX_PROGRAM_HTML) throw new ImportError("Program page is too large");
    let roadmap: Roadmap;
    try {
      roadmap = parseRoadmapPage(html);
    } catch (e) {
      throw new ImportError(`Not a recognizable program page: ${(e as Error).message}`);
    }
    if (roadmap.terms.length === 0) throw new ImportError("Program page has no roadmap terms");
    await this.store.putRoadmap(roadmap);

    const courses = dedupeRefs(
      roadmap.terms.flatMap((t) => t.slots.flatMap((s) => [...s.options.flat(), ...s.recommended])),
    );
    const coids = courses.flatMap((c) => (c.coid ? [c.coid] : []));
    return {
      catoid: roadmap.catoid,
      poid: roadmap.poid,
      title: roadmap.title,
      courses,
      missing: await this.store.missing(roadmap.catoid, coids),
    };
  }

  /** `ids` are the catoid/coid the page was requested with, used when the page doesn't state them. */
  async importCourse(html: string, ids?: { catoid: number; coid: number }): Promise<CourseImportResult> {
    if (html.length > MAX_COURSE_HTML) throw new ImportError("Course page is too large");
    let course: Course;
    try {
      course = parseCoursePage(html, ids);
    } catch (e) {
      throw new ImportError(`Not a recognizable course page: ${(e as Error).message}`);
    }
    if (!course.prereqConfident && course.prereqText && this.resolver) {
      try {
        const prereq = await this.resolver.resolve(course.prereqText, course.id);
        course = { ...course, prereq, prereqConfident: true, prereqSource: "llm" };
      } catch {
        // Keep the deterministic best effort; the course stays flagged for a later retry.
      }
    }
    if (course.prereqConfident && !course.prereqSource) course = { ...course, prereqSource: "parser" };
    await this.store.putCourse(course);

    const linked = course.linkedCourses.flatMap((r) => (r.coid ? [r.coid] : []));
    return {
      catoid: course.catoid!,
      coid: course.coid!,
      id: course.id,
      prereqConfident: course.prereqConfident,
      missing: await this.store.missing(course.catoid!, linked),
    };
  }

  /** Everything the app needs for one program: roadmap, requirements, and cached courses. */
  async programBundle(catoid: number, poid: number): Promise<ProgramBundle | undefined> {
    const roadmap = await this.store.getRoadmap(catoid, poid);
    if (!roadmap) return undefined;
    const program = roadmapToProgram(roadmap);

    // Walk program courses and, transitively, their prerequisites.
    const queue = program.groups.flatMap((g) =>
      g.kind === "oneOf" ? g.options.flat() : "courses" in g ? g.courses : [],
    );
    const seen = new Set<string>();
    const courses: Course[] = [];
    const missingCodes: string[] = [];
    while (queue.length) {
      const code = queue.shift()!;
      if (seen.has(code)) continue;
      seen.add(code);
      const course = await this.store.getCourseByCode(catoid, code);
      if (!course) {
        missingCodes.push(code);
        continue;
      }
      courses.push(course);
      queue.push(...referencedCourses(course.prereq));
    }
    return { roadmap, program, courses, missingCodes };
  }
}

function dedupeRefs(refs: CourseRef[]): CourseRef[] {
  const m = new Map<string, CourseRef>();
  for (const r of refs) if (!m.has(r.code) || (!m.get(r.code)!.coid && r.coid)) m.set(r.code, r);
  return [...m.values()];
}
