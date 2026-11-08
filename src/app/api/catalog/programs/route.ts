import { connection } from "next/server";
import { services } from "@/lib/server/services";

/** Programs imported so far, for the program picker. */
export async function GET() {
  await connection(); // imported programs change at runtime; never prerender
  const roadmaps = await services().store.listRoadmaps();
  return Response.json(
    roadmaps.map((r) => ({ catoid: r.catoid, poid: r.poid, title: r.title, name: r.name, degree: r.degree, catalogYear: r.catalogYear })),
  );
}
