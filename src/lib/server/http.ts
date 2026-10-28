import "server-only";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { isImportError } from "../catalog/importService";

export const HtmlBody = z.object({ html: z.string().min(1) });
export const CourseBody = HtmlBody.extend({
  catoid: z.number().int().positive().optional(),
  coid: z.number().int().positive().optional(),
});

/** Parses a JSON body against `schema`, or returns a 400 response. */
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : Response.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
}

/** Maps import failures to 422 and lets anything else surface as a 500. */
export async function importErrorResponse(e: unknown, html: string, kind: string): Promise<Response> {
  if (!isImportError(e)) throw e;
  await saveFailedPage(kind, html);
  return Response.json({ error: e.message }, { status: 422 });
}

/** In development, keep pages that failed to parse in .debug/failed-imports/ for inspection. */
async function saveFailedPage(kind: string, html: string) {
  if (process.env.NODE_ENV !== "development") return;
  try {
    const dir = path.join(process.cwd(), ".debug", "failed-imports");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${kind}.html`);
    await fs.writeFile(file, html);
    console.warn(`[import] saved unparseable ${kind} page to ${path.relative(process.cwd(), file)}`);
  } catch {
    // Debug aid only; never fail the request over it.
  }
}
