import { normalizeSpaces } from '../domain';

export interface ParsedDescription {
  raw: string;
  /** Klartext-Zeilen ohne HTML (Original-Schreibweise, nur Leerraum normalisiert). */
  lines: string[];
  imageUrls: string[];
  code: number | null;
  /** Originaler Code-Ausdruck, z. B. «Gewässercode: 151» oder «Code:151». */
  codeRaw: string | null;
  /** true, wenn der Code im Standardformat «Gewässercode: NNN» steht. */
  codeStandard: boolean | null;
  /** Regeltext (alle Zeilen ohne den Code-Ausdruck). */
  ruleText: string | null;
  /** Beschreibung enthält das Wort «gesperrt». */
  mentionsClosed: boolean;
  /** Freitext mit Datumsangabe (z. B. «ist bis 30.04. gesperrt») – NICHT strukturiert auswerten. */
  temporalText: string | null;
  /** Beschreibung enthielt Leerraum, der beim Normalisieren entfernt würde (z. B. viele geschützte Leerzeichen). */
  hadIrregularWhitespace: boolean;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const CODE_RE = /(Gew(?:ä|ae)ssercode|Code)\s*:?\s*(\d{1,4})/i;
const STANDARD_CODE_RE = /^Gewässercode: \d+$/;
const TEMPORAL_RE = /\b(bis|ab|vom|von)\s+\d{1,2}\.\s?\d{1,2}\.(?:\s?\d{2,4})?/i;

export function parseDescription(raw: string | null | undefined): ParsedDescription {
  const src = raw ?? '';
  const imageUrls: string[] = [];
  src.replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, (_m, u: string) => {
    imageUrls.push(u);
    return '';
  });
  let t = src.replace(/<img[^>]*>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '');
  t = decodeHtmlEntities(t);
  const rawLines = t.split('\n');
  const lines = rawLines.map((l) => normalizeSpaces(l)).filter((l) => l.length > 0);
  const hadIrregularWhitespace = rawLines.some((l) => l.trim().length > 0 && normalizeSpaces(l) !== l.trim()) || /[ ]{2,}/.test(t);

  let code: number | null = null;
  let codeRaw: string | null = null;
  const ruleParts: string[] = [];
  for (const l of lines) {
    const m = CODE_RE.exec(l);
    if (m && code === null) {
      code = Number(m[2]);
      codeRaw = m[0];
      const rest = normalizeSpaces(l.replace(m[0], ''));
      if (rest) ruleParts.push(rest);
    } else {
      ruleParts.push(l);
    }
  }
  const ruleText = ruleParts.length ? ruleParts.join('\n') : null;
  const temporal = lines.find((l) => TEMPORAL_RE.test(l)) ?? null;
  return {
    raw: src,
    lines,
    imageUrls,
    code,
    codeRaw,
    codeStandard: codeRaw === null ? null : STANDARD_CODE_RE.test(codeRaw),
    ruleText,
    mentionsClosed: /gesperrt/i.test(t),
    temporalText: temporal ? normalizeSpaces(temporal.replace(CODE_RE, '')) : null,
    hadIrregularWhitespace,
  };
}

/** Findet Tippfehler mit verdoppeltem Grossbuchstaben am Wortanfang (z. B. «NNatur-»). */
export function findDoubledCapitals(s: string): { found: string; suggestion: string }[] {
  const out: { found: string; suggestion: string }[] = [];
  const re = /(^|[\s(])([A-ZÄÖÜ])\2([a-zäöüß]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push({ found: `${m[2]}${m[2]}${m[3]}`, suggestion: `${m[2]}${m[3]}` });
  return out;
}
