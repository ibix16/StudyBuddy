import { normalizeCourseId, type OtherKind, type PrereqExpr } from "./types";

/**
 * Deterministic parser for catalog prerequisite prose. It handles the common
 * shapes ("A and B", "A, B, or C", parentheses, "; or instructor consent",
 * subject carry-over like "MATH 30 or 30P", a trailing minimum grade).
 * Anything it can't resolve unambiguously comes back with confident=false
 * so the caller can send the text to the LLM fallback.
 */
export interface ParseResult {
  expr: PrereqExpr | null;
  confident: boolean;
}

type Token =
  | { t: "course"; id: string }
  | { t: "other"; text: string; kind: OtherKind }
  | { t: "and" | "or"; afterWords?: boolean }
  | { t: "comma" | "semi" | "lparen" | "rparen" };

const OTHER_PATTERNS: [RegExp, string, OtherKind][] = [
  [/\b(instructor|department)(al)? consent\b|\bconsent of (the )?(instructor|department)\b/i, "Instructor consent", "consent"],
  [/\bupper[- ]division standing\b/i, "Upper division standing", "standing"],
  [/\bgraduate standing\b/i, "Graduate standing", "standing"],
  [/\b(junior|senior) standing\b/i, "Class standing", "standing"],
  [/\bmath enrollment category\b(?:\s*M-[IV]+(?:\s*,?\s*(?:or\s+)?M-[IV]+)*)?/i, "Math enrollment category (placement)", "placement"],
  [/\bsatisfactory score on the [\w\s-]*?assessment\b/i, "Placement assessment", "placement"],
  [/\bAP [A-Za-z -]+score\b/, "AP exam score", "exam"],
  [/\b(?:a )?major of\b|\bmajors? only\b|\bdeclared majors?\b/i, "Major restriction", "major"],
];

const GRADE_RE = /grade of "?([A-D][+-]?)"? or better|"?([A-D][+-]?)"? or better/i;

/** Prose the token grammar can't express (conditionals, waivers); always sent to the LLM. */
const NEEDS_LLM_RE = /\bif\b|\bunless\b|\bwaive/i;

export function parsePrereqText(raw: string | undefined | null): ParseResult {
  if (!raw) return { expr: null, confident: true };
  let text = raw
    .replace(/^\s*pre-?requisites?(\(s\))?\s*:\s*/i, "")
    .split(/\bco-?requisites?(\(s\))?\s*:/i)[0];

  const gradeMatch = text.match(GRADE_RE);
  const minGrade = gradeMatch ? (gradeMatch[1] ?? gradeMatch[2]).toUpperCase() : undefined;
  if (gradeMatch) text = text.replace(GRADE_RE, " ");

  const tokens = tokenize(text);
  if (!tokens.some((t) => t.t === "course" || t.t === "other")) {
    return text.trim()
      ? { expr: { type: "other", text: raw.trim(), kind: "condition" }, confident: false }
      : { expr: null, confident: true };
  }

  const state = { pos: 0, ambiguous: false };
  const expr = parseSemis(tokens, state);
  const confident = !state.ambiguous && state.pos === tokens.length && !NEEDS_LLM_RE.test(text);
  return { expr: minGrade ? applyGrade(expr, minGrade) : expr, confident };
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let lastSubject: string | null = null;
  // Course ("CS 46B", "MATH30P"), bare number after a subject ("or 30P"), connectives, punctuation.
  // Bare numbers only count right after a connective, so "6 units" isn't read as a course.
  const re = /\b([A-Z]{2,6})\s?(\d{1,3}[A-Z]{0,2})\b|(?<=(?:\b[Aa]nd|\b[Oo]r|,)\s{1,3})(\d{1,3}[A-Z]{0,2})\b|\b([Aa]nd|[Oo]r)\b|([,;()])/g;
  const others = OTHER_PATTERNS.flatMap(([pat, label, kind]) => {
    const m = pat.exec(text);
    return m ? [{ index: m.index, end: m.index + m[0].length, label, kind }] : [];
  });

  let m: RegExpExecArray | null;
  const raw: { index: number; end: number; tok: Token }[] = others.map((o) => ({
    index: o.index,
    end: o.end,
    tok: { t: "other", text: o.label, kind: o.kind },
  }));
  while ((m = re.exec(text))) {
    if (others.some((o) => m!.index >= o.index && m!.index < o.end)) continue;
    if (m[1]) {
      lastSubject = m[1];
      raw.push({ index: m.index, end: re.lastIndex, tok: { t: "course", id: normalizeCourseId(m[1], m[2]) } });
    } else if (m[3] && lastSubject) {
      raw.push({ index: m.index, end: re.lastIndex, tok: { t: "course", id: normalizeCourseId(lastSubject, m[3]) } });
    } else if (m[4]) {
      raw.push({ index: m.index, end: re.lastIndex, tok: { t: m[4].toLowerCase() as "and" | "or" } });
    } else if (m[5]) {
      const map = { ",": "comma", ";": "semi", "(": "lparen", ")": "rparen" } as const;
      raw.push({ index: m.index, end: re.lastIndex, tok: { t: map[m[5] as keyof typeof map] } });
    }
  }
  raw.sort((a, b) => a.index - b.index);
  // Note connectives preceded by ignored prose ("; Computer Science or Software
  // Engineering majors only"): after a ";" they belong to the prose, not the clause.
  raw.forEach(({ index, tok }, i) => {
    if (tok.t === "and" || tok.t === "or") tok.afterWords = i > 0 && /\w/.test(text.slice(raw[i - 1].end, index));
    tokens.push(tok);
  });
  return dropDanglingConnectives(tokens);
}

/** Removes connectives that don't sit between two operands (e.g. from ignored prose). */
function dropDanglingConnectives(tokens: Token[]): Token[] {
  const isOperandEnd = (t?: Token) => t && (t.t === "course" || t.t === "other" || t.t === "rparen");
  const out: Token[] = [];
  for (const tok of tokens) {
    // "(with a grade of C- or better)" leaves an empty pair behind once the grade is stripped.
    if (tok.t === "rparen" && out[out.length - 1]?.t === "lparen") {
      out.pop();
      continue;
    }
    if (["and", "or", "comma"].includes(tok.t)) {
      const prev = out[out.length - 1];
      if (!isOperandEnd(prev) && !(prev && ["comma", "semi"].includes(prev.t))) continue;
      if (prev?.t === "semi" && "afterWords" in tok && tok.afterWords) continue;
      if (prev && ["comma", "semi"].includes(prev.t) && tok.t === "comma") continue;
    }
    out.push(tok);
  }
  // Connectives left hanging before ";", ")" or the end (e.g. after "a major of X, Y, or Z;").
  const dangling = (t: Token) => ["and", "or", "comma"].includes(t.t);
  for (let i = out.length - 1; i >= 0; i--) {
    const next = out[i + 1];
    if (dangling(out[i]) && (!next || next.t === "semi" || next.t === "rparen")) out.splice(i, 1);
    else if (out[i].t === "semi" && (!next || next.t === "semi")) out.splice(i, 1);
  }
  return out;
}

type State = { pos: number; ambiguous: boolean };

/** Top level: semicolon-separated clauses; "; or X" joins as OR, otherwise AND. */
function parseSemis(tokens: Token[], s: State): PrereqExpr {
  let left = parseList(tokens, s);
  while (tokens[s.pos]?.t === "semi") {
    s.pos++;
    let op: "and" | "or" = "and";
    if (tokens[s.pos]?.t === "or" || tokens[s.pos]?.t === "and") op = tokens[s.pos++].t as "and" | "or";
    left = combine(op, left, parseList(tokens, s));
  }
  return left;
}

/**
 * A run of operands separated by and/or/commas. Commas take the type of the
 * list's explicit connective ("A, B, or C"). Mixing and/or without parentheses
 * is ambiguous; we bind "or" tighter (the usual catalog reading) and flag it.
 */
function parseList(tokens: Token[], s: State): PrereqExpr {
  const operands: PrereqExpr[] = [parseAtom(tokens, s)];
  const seps: ("and" | "or" | "comma")[] = [];
  while (s.pos < tokens.length && ["and", "or", "comma"].includes(tokens[s.pos].t)) {
    let sep = tokens[s.pos++].t as "and" | "or" | "comma";
    if (sep === "comma" && (tokens[s.pos]?.t === "and" || tokens[s.pos]?.t === "or")) {
      sep = tokens[s.pos++].t as "and" | "or";
    }
    seps.push(sep);
    operands.push(parseAtom(tokens, s));
  }
  const explicit = new Set(seps.filter((x) => x !== "comma"));
  if (explicit.size > 1) s.ambiguous = true;
  const commaAs: "and" | "or" = explicit.size === 1 ? [...explicit][0] as "and" | "or" : "and";
  const resolved = seps.map((x) => (x === "comma" ? commaAs : x));

  // Group consecutive OR-joined operands, then AND the groups.
  const andParts: PrereqExpr[] = [];
  let orRun: PrereqExpr[] = [operands[0]];
  resolved.forEach((sep, i) => {
    if (sep === "or") orRun.push(operands[i + 1]);
    else {
      andParts.push(flatten("or", orRun));
      orRun = [operands[i + 1]];
    }
  });
  andParts.push(flatten("or", orRun));
  return flatten("and", andParts);
}

function parseAtom(tokens: Token[], s: State): PrereqExpr {
  const tok = tokens[s.pos++];
  if (!tok) {
    s.ambiguous = true;
    return { type: "other", text: "(unparsed)", kind: "condition" };
  }
  if (tok.t === "course") return { type: "course", course: tok.id };
  if (tok.t === "other") return { type: "other", text: tok.text, kind: tok.kind };
  if (tok.t === "lparen") {
    const inner = parseSemis(tokens, s);
    if (tokens[s.pos]?.t === "rparen") s.pos++;
    else s.ambiguous = true;
    return inner;
  }
  s.ambiguous = true;
  return parseAtom(tokens, s);
}

function combine(op: "and" | "or", a: PrereqExpr, b: PrereqExpr): PrereqExpr {
  return flatten(op, [a, b]);
}

function flatten(op: "and" | "or", parts: PrereqExpr[]): PrereqExpr {
  const out = parts.flatMap((p) => (p.type === op ? p.of : [p]));
  return out.length === 1 ? out[0] : { type: op, of: out };
}

function applyGrade(expr: PrereqExpr, minGrade: string): PrereqExpr {
  switch (expr.type) {
    case "course":
      return { ...expr, minGrade: expr.minGrade ?? minGrade };
    case "and":
    case "or":
      return { ...expr, of: expr.of.map((e) => applyGrade(e, minGrade)) };
    default:
      return expr;
  }
}
