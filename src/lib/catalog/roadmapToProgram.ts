import { ProgramSchema, type Program, type RequirementGroup, type Roadmap } from "./types";

/**
 * Turns a published roadmap into the requirement groups the engine works on.
 *
 *   course slot, one course         : allOf   ("CS 146")
 *   course slot, several options    : oneOf   ("CS 46A OR CS 46AX", "MATH 30 | MATH 30X + MATH 30W")
 *   ge / elective slot              : placeholder (student assigns a course; reserves units meanwhile)
 *   milestone ("Apply to Graduate") : not a requirement; stays on the Roadmap for display
 *
 * Every group keeps the term the roadmap suggests, which the planner uses as a
 * tie-breaker (see `suggestedOrder`) so plans stay close to the official sequence.
 */
export function roadmapToProgram(roadmap: Roadmap, fetchedAt = new Date().toISOString()): Program {
  const groups: RequirementGroup[] = [];

  for (const term of roadmap.terms) {
    const suggestedTerm = { year: term.year, season: term.season };
    for (const slot of term.slots) {
      const base = { id: slot.id, label: slot.label, suggestedTerm };
      switch (slot.kind) {
        case "course": {
          const options = slot.options.map((opt) => opt.map((c) => c.code));
          groups.push(
            options.length === 1 && options[0].length === 1
              ? { ...base, kind: "allOf", courses: options[0] }
              : { ...base, kind: "oneOf", options },
          );
          break;
        }
        case "ge":
        case "elective":
          groups.push({
            ...base,
            kind: "placeholder",
            category: slot.kind,
            units: slot.units ?? 0,
            geAreas: slot.geAreas,
            recommended: slot.recommended.map((c) => c.code),
          });
          break;
        case "milestone":
          break;
      }
    }
  }

  const totalUnits = roadmap.terms.reduce((sum, t) => sum + (t.units ?? 0), 0);
  return ProgramSchema.parse({
    id: `roadmap-${roadmap.catoid}-${roadmap.poid}`,
    name: roadmap.degree ? `${roadmap.name}, ${roadmap.degree}` : roadmap.name,
    catalogYear: roadmap.catalogYear ?? "",
    catoid: roadmap.catoid,
    poid: roadmap.poid,
    ...(totalUnits ? { totalUnits } : {}),
    groups,
    sourceUrl: roadmap.sourceUrl,
    fetchedAt,
  });
}
