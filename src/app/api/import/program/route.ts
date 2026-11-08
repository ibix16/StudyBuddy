import { services } from "@/lib/server/services";
import { HtmlBody, importErrorResponse, readJson } from "@/lib/server/http";

/** Body: { html } of a MyRoadmaps program page. Returns the program's courses and which are missing. */
export async function POST(request: Request) {
  const body = await readJson(request, HtmlBody);
  if (body instanceof Response) return body;
  try {
    return Response.json(await services().importer.importProgram(body.html));
  } catch (e) {
    return importErrorResponse(e, body.html, "program");
  }
}
