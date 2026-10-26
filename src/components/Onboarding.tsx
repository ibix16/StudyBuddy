"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  catalogYears,
  findPrograms,
  parseProgramUrl,
  programSearchUrl,
  programUrl,
  type ProgramSummary,
} from "@/lib/onboarding";

/**
 * First-run flow: pick a major and catalog year, find that roadmap in the
 * official catalog, import it with the extension, then land on the plan.
 * The choice is remembered in localStorage so a student coming back from the
 * catalog tab picks up where they left off.
 */

interface Choice {
  major: string;
  year: string;
}

const STORAGE_KEY = "ara:v1:onboarding";
const POLL_MS = 4000;

const listeners = new Set<() => void>();
let snapshot: { raw: string | null; choice: Choice | null } = { raw: null, choice: null };

function readChoice(): Choice | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: the flow still works, it just isn't remembered.
  }
  if (raw !== snapshot.raw) {
    let choice: Choice | null = null;
    try {
      const v = raw ? JSON.parse(raw) : null;
      if (typeof v?.major === "string" && typeof v?.year === "string") choice = { major: v.major, year: v.year };
    } catch {
      choice = null;
    }
    snapshot = { raw, choice };
  }
  return snapshot.choice;
}

function writeChoice(choice: Choice | null) {
  try {
    if (choice) localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore; see readChoice.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// onboarding is divided into two steps 
// step 1 : selecting major and catalog year , The choice is saved in localStorage
// step 2 : findPrograms(programs, major, year) checks whether this major and year is already in the imported list.
export function Onboarding({ initialPrograms }: { initialPrograms: ProgramSummary[] }) {
  const choice = useSyncExternalStore(subscribe, readChoice, () => null);
  const [programs, setPrograms] = useState(initialPrograms);

  return choice ? (
    <FindRoadmap choice={choice} programs={programs} onPrograms={setPrograms} onChange={() => writeChoice(null)} />
  ) : (
    <ChooseProgram programs={programs} onSubmit={writeChoice} />
  );
}

const card = "rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-950";
const input =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-neutral-700 dark:bg-neutral-900";
const primary =
  "inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";

function ChooseProgram({ programs, onSubmit }: { programs: ProgramSummary[]; onSubmit: (c: Choice) => void }) {
  const years = useMemo(() => catalogYears(), []);
  const [major, setMajor] = useState("");
  const [year, setYear] = useState("");
  // Suggest majors others have already imported; any other major works too.
  const known = useMemo(() => [...new Set(programs.map((p) => p.name))].sort(), [programs]);

  return (
    <form
      className={card}
      onSubmit={(e) => {
        e.preventDefault();
        if (major.trim() && year) onSubmit({ major: major.trim(), year });
      }}
    >
      <StepLabel n={1} of={2} />
      <h2 className="mt-1 text-xl font-semibold">What are you studying?</h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Your catalog year is usually the year you started at SJSU. It decides which requirements apply to you.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_12rem]">
        <label className="block text-sm font-medium">
          Major
          <input
            className={input}
            list="known-majors"
            value={major}
            onChange={(e) => setMajor(e.target.value)}
            placeholder="e.g. Computer Science"
            autoComplete="off"
            required
          />
          <datalist id="known-majors">
            {known.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label className="block text-sm font-medium">
          Catalog year
          <select className={input} value={year} onChange={(e) => setYear(e.target.value)} required>
            <option value="" disabled>
              Select…
            </option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button type="submit" className={`${primary} mt-6`} disabled={!major.trim() || !year}>
        Continue
      </button>
    </form>
  );
}

function FindRoadmap({
  choice,
  programs,
  onPrograms,
  onChange,
}: {
  choice: Choice;
  programs: ProgramSummary[];
  onPrograms: (p: ProgramSummary[]) => void;
  onChange: () => void;
}) {
  const router = useRouter();
  const [pasted, setPasted] = useState("");
  const link = parseProgramUrl(pasted);
  const linkCached = link && programs.some((p) => p.catoid === link.catoid && p.poid === link.poid);

  // Programs for this choice that were already imported when the student got here.
  const [alreadyThere] = useState(() => new Set(findPrograms(programs, choice.major, choice.year).map((p) => p.poid)));
  const matches = findPrograms(programs, choice.major, choice.year);
  const waiting = matches.length === 0 && !linkCached;

  // Watch for the extension's import to land, then open the plan.
  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/catalog/programs", { cache: "no-store" });
        if (!res.ok || stopped) return;
        const next: ProgramSummary[] = await res.json();
        onPrograms(next);
        const target =
          (link && next.find((p) => p.catoid === link.catoid && p.poid === link.poid)) ??
          findPrograms(next, choice.major, choice.year).find((p) => !alreadyThere.has(p.poid));
        if (target) router.push(`/program/${target.catoid}/${target.poid}`);
      } catch {
        // Server restarting or offline; try again next tick.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [waiting, link?.catoid, link?.poid, choice.major, choice.year, alreadyThere, onPrograms, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <StepLabel n={2} of={2} />
        <h2 className="mt-1 text-xl font-semibold">
          {choice.major} <span className="font-normal text-neutral-500">· {choice.year}</span>
        </h2>
      </div>
      <button type="button" onClick={onChange} className="text-sm text-blue-700 hover:underline dark:text-blue-400">
        Change
      </button>
    </div>
  );

  if (matches.length > 0 || linkCached) {
    const ready = linkCached ? programs.filter((p) => p.catoid === link!.catoid && p.poid === link!.poid) : matches;
    return (
      <section className={card}>
        {header}
        <p className="mt-3 text-neutral-700 dark:text-neutral-300">
          This roadmap is already imported{ready.length > 1 ? ". Pick your degree:" : "."}
        </p>
        <ul className="mt-4 space-y-2">
          {ready.map((p) => (
            <li key={p.poid}>
              <Link
                href={`/program/${p.catoid}/${p.poid}`}
                className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3 hover:border-blue-600 hover:bg-blue-50 dark:border-neutral-800 dark:hover:bg-blue-950/40"
              >
                <span className="font-medium">{p.title}</span>
                <span className="text-sm text-blue-700 dark:text-blue-400">Open plan →</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-neutral-500">
          Different degree than listed? Paste its catalog link below or import it from the catalog.
        </p>
        <PasteLink value={pasted} onChange={setPasted} />
      </section>
    );
  }

  return (
    <section className={card}>
      {header}
      <p className="mt-3 text-neutral-700 dark:text-neutral-300">
        This roadmap hasn&apos;t been imported yet. Grab it from the official catalog. It takes about a minute.
      </p>

      <ol className="mt-5 space-y-5">
        <Step n={1} title="Install the importer extension">
          One-time setup. In Chrome, open <code className="font-mono text-xs">chrome://extensions</code>, turn on
          Developer mode, click <em>Load unpacked</em>, and choose this project&apos;s{" "}
          <code className="font-mono text-xs">extension/</code> folder.
        </Step>
        <Step n={2} title="Open your roadmap in the catalog">
          {link ? (
            <a href={programUrl(link.catoid, link.poid)} target="_blank" rel="noreferrer" className={`${primary} mt-2`}>
              Open this program page ↗
            </a>
          ) : (
            <>
              <a href={programSearchUrl(choice.major)} target="_blank" rel="noreferrer" className={`${primary} mt-2`}>
                Search the catalog for “{choice.major}” ↗
              </a>
              <p className="mt-2">
                In the results, open the one ending in <strong>({choice.year})</strong>, such as{" "}
                <em>
                  {choice.major}, BS ({choice.year})
                </em>
                . No match? Check the spelling or try a shorter name.
              </p>
            </>
          )}
          <PasteLink value={pasted} onChange={setPasted} />
        </Step>
        <Step n={3} title="Click “Import to Roadmap Assistant”">
          The button sits in the bottom-right corner of the catalog page. Leave that tab open while it fetches each
          course; you can come back here meanwhile.
        </Step>
      </ol>

      <div
        className="mt-6 flex items-center gap-3 rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
        role="status"
      >
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-600" aria-hidden />
        Waiting for the import. Your plan opens here automatically as soon as the program arrives.
      </div>
    </section>
  );
}

function PasteLink({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const invalid = value.trim() !== "" && !parseProgramUrl(value);
  return (
    <label className="mt-3 block text-sm">
      <span className="text-neutral-500">Already have the program&apos;s link? Paste it:</span>
      <input
        className={`${input} text-sm`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://catalog.sjsu.edu/preview_program.php?catoid=10&poid=…"
        aria-invalid={invalid}
      />
      {invalid && <span className="mt-1 block text-red-600">That isn&apos;t a catalog program link.</span>}
    </label>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-medium">{title}</h3>
        <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{children}</div>
      </div>
    </li>
  );
}

function StepLabel({ n, of }: { n: number; of: number }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">
      Step {n} of {of}
    </p>
  );
}
