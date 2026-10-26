import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Onboarding } from "@/components/Onboarding";
import type { ProgramSummary } from "@/lib/onboarding";
import { services } from "@/lib/server/services";


// static components of landing page
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">SJSU</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Academic Roadmap Assistant</h1>
      <p className="mt-3 max-w-2xl text-neutral-600 dark:text-neutral-400">
        Turn your major&apos;s official MyRoadmaps plan into your own: mark what you&apos;ve taken, see which courses
        you can take next, and plan the semesters ahead.
      </p>

      <ul className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
        {[
          ["Track progress", "See which requirements you've met and what's left."],
          ["See prerequisites", "A map of which courses unlock which."],
          ["Plan semesters", "A term-by-term plan to graduation."],
        ].map(([title, body]) => (
          <li key={title} className="rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <div className="font-medium">{title}</div>
            <div className="mt-0.5 text-neutral-500">{body}</div>
          </li>
        ))}
      </ul>

      <div className="mt-10">
        <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />}>
          <Start />
        </Suspense>
      </div>

      <p className="mt-10 text-xs text-neutral-500">
        An advising aid built from the{" "}
        <a className="underline" href="https://catalog.sjsu.edu/index.php?catoid=10" target="_blank" rel="noreferrer">
          SJSU catalog
        </a>
        , not an official degree audit. Confirm your plan with an advisor.
      </p>
    </main>
  );
}


// Start() function ---> dynamic component of landing page 
//    it's rendered on demand for each request, query's server in-memory Map for stored catalogs

// start function calls listRoadmaps() 
async function Start() {
  await connection(); // imported programs change at runtime; never prerender
  const programs: ProgramSummary[] = (await services().store.listRoadmaps()).map((r) => ({
    catoid: r.catoid,
    poid: r.poid,
    title: r.title,
    name: r.name,
    degree: r.degree,
    catalogYear: r.catalogYear,
  }));
  return (
    <>
      <Onboarding initialPrograms={programs} />
      {programs.length > 0 && (
        <details className="mt-8 text-sm">
          <summary className="cursor-pointer text-neutral-600 dark:text-neutral-400">
            Browse all imported programs ({programs.length})
          </summary>
          <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {programs.map((p) => (
              <li key={`${p.catoid}-${p.poid}`}>
                <Link
                  href={`/program/${p.catoid}/${p.poid}`}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <span className="font-medium">
                    {p.name}
                    {p.degree ? `, ${p.degree}` : ""}
                  </span>
                  <span className="text-neutral-500">{p.catalogYear}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
