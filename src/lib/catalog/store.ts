import type { KeyValueStore } from "../cache";
import { CourseSchema, RoadmapSchema, type Course, type CourseId, type Roadmap } from "./types";

/**
 * Shared catalog cache, keyed the way Acalog identifies things:
 *
 *   roadmap:<catoid>:<poid>        Roadmap
 *   course:<catoid>:<coid>         Course
 *   code:<catoid>:<CODE>           coid, so plain-text course codes (no link) can be resolved
 *
 * Course data differs by catalog, so everything is scoped by catoid.
 */
export class CatalogStore {
  constructor(private kv: KeyValueStore) {}

  async putRoadmap(r: Roadmap): Promise<void> {
    await this.kv.set(`roadmap:${r.catoid}:${r.poid}`, JSON.stringify(r));
    // Programs and notes link most of their courses; remember their coids.
    const refs = r.terms.flatMap((t) => t.slots.flatMap((s) => [...s.options.flat(), ...s.recommended]));
    for (const ref of [...refs, ...r.notesCourses]) {
      if (ref.coid) await this.kv.set(codeKey(r.catoid, ref.code), String(ref.coid));
    }
  }

  async getRoadmap(catoid: number, poid: number): Promise<Roadmap | undefined> {
    const raw = await this.kv.get(`roadmap:${catoid}:${poid}`);
    return raw ? RoadmapSchema.parse(JSON.parse(raw)) : undefined;
  }

  async listRoadmaps(): Promise<Roadmap[]> {
    const keys = await this.kv.keys("roadmap:");
    const out: Roadmap[] = [];
    for (const k of keys) {
      const raw = await this.kv.get(k);
      if (raw) out.push(RoadmapSchema.parse(JSON.parse(raw)));
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  async putCourse(c: Course): Promise<void> {
    if (c.catoid === undefined || c.coid === undefined) throw new Error(`Course ${c.id} has no catalog ids`);
    await this.kv.set(`course:${c.catoid}:${c.coid}`, JSON.stringify(c));
    await this.kv.set(codeKey(c.catoid, c.id), String(c.coid));
    for (const ref of c.linkedCourses) {
      if (ref.coid) await this.kv.set(codeKey(c.catoid, ref.code), String(ref.coid));
    }
  }

  async getCourse(catoid: number, coid: number): Promise<Course | undefined> {
    const raw = await this.kv.get(`course:${catoid}:${coid}`);
    return raw ? CourseSchema.parse(JSON.parse(raw)) : undefined;
  }

  async coidFor(catoid: number, code: CourseId): Promise<number | undefined> {
    const raw = await this.kv.get(codeKey(catoid, code));
    return raw ? Number(raw) : undefined;
  }

  async getCourseByCode(catoid: number, code: CourseId): Promise<Course | undefined> {
    const coid = await this.coidFor(catoid, code);
    return coid === undefined ? undefined : this.getCourse(catoid, coid);
  }

  /** The coids from `coids` that aren't cached yet. */
  async missing(catoid: number, coids: number[]): Promise<number[]> {
    const out: number[] = [];
    for (const coid of new Set(coids)) if (!(await this.kv.get(`course:${catoid}:${coid}`))) out.push(coid);
    return out;
  }
}

const codeKey = (catoid: number, code: string) => `code:${catoid}:${code.toUpperCase()}`;
