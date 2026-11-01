import { z } from "zod";

/** Normalized course id, e.g. "CS 146", "MATH 30P". */
export type CourseId = string;

export function normalizeCourseId(subject: string, number: string): CourseId {
  return `${subject.trim().toUpperCase()} ${number.trim().toUpperCase()}`;
}

/**
 * Prerequisite expression tree. Catalog prose ("CS 46B and (MATH 30 or MATH 30P)
 * with a grade of C- or better, or instructor consent") is parsed into this shape.
 * `other` holds non-course conditions (consent, standing); the engine treats them
 * as advisory rather than blocking.
 */
export type PrereqExpr =
  | { type: "course"; course: CourseId; minGrade?: string; concurrent?: boolean }
  | { type: "and"; of: PrereqExpr[] }
  | { type: "or"; of: PrereqExpr[] }
  | { type: "other"; text: string; kind?: OtherKind };

/**
 * What a non-course condition is. In an OR, consent / condition branches never
 * satisfy the requirement on their own (they need a human decision); placement,
 * exam, major and standing branches do, with an advisory shown to the student.
 */
export const OTHER_KINDS = ["consent", "standing", "placement", "exam", "major", "condition"] as const;
export type OtherKind = (typeof OTHER_KINDS)[number];

export const PrereqExprSchema: z.ZodType<PrereqExpr> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("course"),
      course: z.string(),
      minGrade: z.string().optional(),
      concurrent: z.boolean().optional(),
    }),
    z.object({ type: z.literal("and"), of: z.array(PrereqExprSchema) }),
    z.object({ type: z.literal("or"), of: z.array(PrereqExprSchema) }),
    z.object({ type: z.literal("other"), text: z.string(), kind: z.enum(OTHER_KINDS).optional() }),
  ]),
);

/** A course mentioned on a catalog page. `coid` is absent when the catalog shows it unlinked. */
export const CourseRefSchema = z.object({
  code: z.string(),
  coid: z.number().int().optional(),
  title: z.string().optional(),
});
export type CourseRef = z.infer<typeof CourseRefSchema>;

export const CourseSchema = z.object({
  id: z.string(),
  subject: z.string(),
  number: z.string(),
  title: z.string(),
  units: z.number(),
  /** Upper bound for variable-unit courses ("1-3 units"). */
  unitsMax: z.number().optional(),
  description: z.string().optional(),
  /** Raw prerequisite prose exactly as published, kept for display and re-parsing. */
  prereqText: z.string().optional(),
  prereq: PrereqExprSchema.nullable(),
  /** False when the deterministic parser was unsure and the LLM fallback should run. */
  prereqConfident: z.boolean().default(true),
  /** Which parser produced `prereq`. */
  prereqSource: z.enum(["parser", "llm"]).optional(),
  coreqText: z.string().optional(),
  /** Courses linked from the prerequisite/corequisite text, so an importer can follow them. */
  linkedCourses: z.array(CourseRefSchema).default([]),
  grading: z.string().optional(),
  /** Free-form text after the labeled sections, e.g. "Cross-listed with CS 42." */
  notes: z.string().optional(),
  /** Acalog ids, when the course came from the catalog. */
  catoid: z.number().int().optional(),
  coid: z.number().int().optional(),
  termsOffered: z.array(z.enum(["Fall", "Spring", "Summer", "Winter"])).optional(),
  sourceUrl: z.string().optional(),
});
export type Course = z.infer<typeof CourseSchema>;

const GroupBase = {
  id: z.string(),
  label: z.string(),
  /** Where the published roadmap places this requirement; used to order plans. */
  suggestedTerm: z.object({ year: z.number().int(), season: z.enum(["Fall", "Spring", "Summer", "Winter"]) }).optional(),
};

export const RequirementGroupSchema = z.discriminatedUnion("kind", [
  z.object({ ...GroupBase, kind: z.literal("allOf"), courses: z.array(z.string()) }),
  /** Satisfied by completing every course of any one option ("CS 46A OR CS 46AX", "MATH 30X and MATH 30W"). */
  z.object({ ...GroupBase, kind: z.literal("oneOf"), options: z.array(z.array(z.string())).min(1) }),
  z.object({ ...GroupBase, kind: z.literal("chooseN"), n: z.number().int().positive(), courses: z.array(z.string()) }),
  z.object({ ...GroupBase, kind: z.literal("units"), units: z.number().positive(), courses: z.array(z.string()) }),
  /**
   * A GE area or elective with no fixed course list. The student assigns a
   * course to it (StudentCourse.appliesTo); until then it only reserves units.
   */
  z.object({
    ...GroupBase,
    kind: z.literal("placeholder"),
    category: z.enum(["ge", "elective"]),
    units: z.number().nonnegative(),
    geAreas: z.array(z.string()).default([]),
    recommended: z.array(z.string()).default([]),
  }),
  /** Requirement text the scraper could not structure; shown verbatim to the student. */
  z.object({ ...GroupBase, kind: z.literal("unparsed"), text: z.string() }),
]);
export type RequirementGroup = z.infer<typeof RequirementGroupSchema>;

export const ProgramSchema = z.object({
  id: z.string(),
  name: z.string(),
  catalogYear: z.string(),
  /** Acalog identifiers: catoid = catalog (10 = MyRoadmaps, all years), poid = program; the year comes from the program title. */
  catoid: z.number().int(),
  poid: z.number().int(),
  totalUnits: z.number().optional(),
  groups: z.array(RequirementGroupSchema),
  sourceUrl: z.string(),
  fetchedAt: z.string(),
});
export type Program = z.infer<typeof ProgramSchema>;


/**
 * One line of a MyRoadmaps semester. A `course` slot is satisfied by any one
 * of its options; an option lists courses that must all be taken (usually one,
 * occasionally a bundle like "MATH 30X and MATH 30W").
 */
export const RoadmapSlotSchema = z.object({
  id: z.string(),
  kind: z.enum(["course", "ge", "elective", "milestone"]),
  /** Cleaned text of the whole line, for display. */
  label: z.string(),
  units: z.number().optional(),
  options: z.array(z.array(CourseRefSchema)),
  /** GE / SJSU Studies areas for `ge` slots, e.g. ["C1", "C2"]. */
  geAreas: z.array(z.string()),
  /** Courses suggested but not required ("[Recommended PHYS 50, ...]"). */
  recommended: z.array(CourseRefSchema),
  /** Designations in parentheses, e.g. "B4", "WID", "B1+B3". */
  tags: z.array(z.string()),
  footnotes: z.array(z.string()),
  note: z.string().optional(),
});
export type RoadmapSlot = z.infer<typeof RoadmapSlotSchema>;

export const RoadmapTermSchema = z.object({
  year: z.number().int(),
  season: z.enum(["Fall", "Spring", "Summer", "Winter"]),
  units: z.number().optional(),
  slots: z.array(RoadmapSlotSchema),
});
export type RoadmapTerm = z.infer<typeof RoadmapTermSchema>;

/** A program's sample plan as published in the MyRoadmaps catalog. */
export const RoadmapSchema = z.object({
  catoid: z.number().int(),
  poid: z.number().int(),
  /** Full title as published, e.g. "Computer Science, BS (2023-2024)". */
  title: z.string(),
  name: z.string(),
  degree: z.string().optional(),
  catalogYear: z.string().optional(),
  terms: z.array(RoadmapTermSchema),
  notes: z.string(),
  /** Courses linked from the notes (often elective lists). */
  notesCourses: z.array(CourseRefSchema),
  sourceUrl: z.string(),
});
export type Roadmap = z.infer<typeof RoadmapSchema>;

export const StudentCourseSchema = z.object({
  courseId: z.string(),
  status: z.enum(["completed", "inProgress", "planned"]),
  term: z.string().optional(),
  grade: z.string().optional(),
  /** Requirement group this course is assigned to (needed for GE / elective placeholders). */
  appliesTo: z.string().optional(),
});
export type StudentCourse = z.infer<typeof StudentCourseSchema>;

export const PreferencesSchema = z.object({
  maxUnits: z.number().positive().default(15),
  majorFirst: z.boolean().default(true),
  priorities: z.array(z.string()).default([]),
  avoidDays: z.array(z.enum(["M", "T", "W", "R", "F", "S"])).default([]),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export type Catalog = Map<CourseId, Course>;
