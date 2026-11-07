import type { CourseId, PrereqExpr } from "../catalog/types";

const GRADE_ORDER = ["F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];

export function meetsGrade(grade: string | undefined, minGrade: string | undefined): boolean {
  if (!minGrade || !grade) return true; // ungraded (in progress / CR) counts tentatively
  const g = GRADE_ORDER.indexOf(grade.toUpperCase());
  const min = GRADE_ORDER.indexOf(minGrade.toUpperCase());
  if (g < 0 || min < 0) return true;
  return g >= min;
}

/** What the evaluator knows about a course the student has (or will have) taken. */
export interface Taken {
  grade?: string;
}

export interface PrereqResult {
  met: boolean;
  /** Course ids that would need to be taken to satisfy the expression (first OR branch is suggested). */
  missing: CourseId[];
  /** Non-course conditions (consent, standing) the student should check themselves. */
  advisories: string[];
}

/** Anything that can say whether (and with what grade) a course counts as taken; a Map works. */
export interface TakenLookup {
  get(courseId: CourseId): Taken | undefined;
}

export function evaluatePrereq(expr: PrereqExpr | null, taken: TakenLookup): PrereqResult {
  if (!expr) return { met: true, missing: [], advisories: [] };
  switch (expr.type) {
    case "course": {
      const t = taken.get(expr.course);
      const met = !!t && meetsGrade(t.grade, expr.minGrade);
      return { met, missing: met ? [] : [expr.course], advisories: [] };
    }
    case "other":
      return { met: true, missing: [], advisories: [expr.text] };
    case "and": {
      const rs = expr.of.map((e) => evaluatePrereq(e, taken));
      return {
        met: rs.every((r) => r.met),
        missing: rs.flatMap((r) => r.missing),
        advisories: rs.flatMap((r) => r.advisories),
      };
    }
    case "or": {
      // Consent / unclassified branches need a human decision, so they never satisfy an OR
      // on their own; placement, exam, major and standing branches do (with an advisory).
      const rs = expr.of.map((e) => ({ e, r: evaluatePrereq(e, taken) }));
      const branches = rs.filter(({ e }) => !needsDecision(e));
      const advisories = rs.filter(({ e }) => needsDecision(e)).flatMap(({ r }) => r.advisories);
      if (branches.length === 0) return { met: true, missing: [], advisories };
      const hit = branches.find(({ r }) => r.met);
      if (hit) return { met: true, missing: [], advisories: [...hit.r.advisories] };
      const cheapest = branches.reduce((a, b) => (b.r.missing.length < a.r.missing.length ? b : a));
      return { met: false, missing: cheapest.r.missing, advisories };
    }
  }
}

function needsDecision(e: PrereqExpr): boolean {
  return e.type === "other" && (!e.kind || e.kind === "consent" || e.kind === "condition");
}

/** Every course id referenced anywhere in the expression. */
export function referencedCourses(expr: PrereqExpr | null): CourseId[] {
  if (!expr) return [];
  if (expr.type === "course") return [expr.course];
  if (expr.type === "other") return [];
  return expr.of.flatMap(referencedCourses);
}
