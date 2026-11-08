import { services } from "@/lib/server/services";
import { CourseBody, importErrorResponse, readJson } from "@/lib/server/http";

/**
 * Body: { html, catoid?, coid? } of a course page; the ids are the ones the page was
 * requested with. Returns the course id and linked courses still missing.
 */
export async function POST(request: Request) {
  const body = await readJson(request, CourseBody);
  if (body instanceof Response) return body;
  const ids = body.catoid && body.coid ? { catoid: body.catoid, coid: body.coid } : undefined;
  try {
    return Response.json(await services().importer.importCourse(body.html, ids));
  } catch (e) {
    return importErrorResponse(e, body.html, "course");
  }
}
