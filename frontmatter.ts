// Front matter parser for entity memories: a YAML subset, `key: scalar`,
// `key: [a, b]`, `key: { k: v }`, one line each, values optionally single- or
// double-quoted; a flow map may hold flow lists (`match: { k: [a, b] }`).
// No Node imports: the page bundles this module too.

export type FrontMatterValue =
  | string
  | FrontMatterValue[]
  | { [key: string]: FrontMatterValue };

const KEY_LINE = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/;
const PAIR = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/;

function stripComment(s: string): string {
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (quote === '"' && c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s,[{:]/.test(s[i - 1]!)) quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]!))) {
      return s.slice(0, i);
    }
  }
  return s;
}

/** Splits the inside of a flow collection on top-level commas. */
function splitFlow(inner: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let depth = 0;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (quote) {
      cur += c;
      if (quote === '"' && c === "\\") cur += inner[++i] ?? "";
      else if (c === quote) quote = null;
    } else if ((c === '"' || c === "'") && /^\s*$|[:[,]\s*$/.test(cur)) {
      quote = c;
      cur += c;
    } else if (c === "[" || c === "{") {
      depth++;
      cur += c;
    } else if (c === "]" || c === "}") {
      depth--;
      if (depth < 0) throw new Error(`frontmatter: unbalanced "${inner}"`);
      cur += c;
    } else if (c === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (quote) throw new Error(`frontmatter: unterminated quote in "${inner}"`);
  if (depth !== 0) throw new Error(`frontmatter: unbalanced "${inner}"`);
  parts.push(cur.trim());
  if (parts.length === 1 && parts[0] === "") return [];
  if (parts.some((p) => p === "")) {
    throw new Error(`frontmatter: empty item in "${inner}"`);
  }
  return parts;
}

function parseScalar(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("[") || s.startsWith("{")) {
    throw new Error(`frontmatter: nested value not supported: ${s}`);
  }
  if (s.startsWith('"')) {
    if (s.length < 2 || !s.endsWith('"')) {
      throw new Error(`frontmatter: bad quoted string: ${s}`);
    }
    return JSON.parse(s) as string;
  }
  if (s.startsWith("'")) {
    if (s.length < 2 || !s.endsWith("'")) {
      throw new Error(`frontmatter: bad quoted string: ${s}`);
    }
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function parseList(s: string): string[] {
  if (!s.endsWith("]")) throw new Error(`frontmatter: unterminated list: ${s}`);
  return splitFlow(s.slice(1, -1)).map(parseScalar);
}

function parseValue(raw: string): FrontMatterValue {
  const s = stripComment(raw).trim();
  if (s.startsWith("[")) return parseList(s);
  if (s.startsWith("{")) {
    if (!s.endsWith("}")) throw new Error(`frontmatter: unterminated map: ${s}`);
    const out: { [key: string]: FrontMatterValue } = {};
    for (const pair of splitFlow(s.slice(1, -1))) {
      const m = PAIR.exec(pair);
      if (!m) throw new Error(`frontmatter: bad map entry: ${pair}`);
      const value = m[2]!.trim();
      // One nested level: a map value may be a flow list.
      out[m[1]!] = value.startsWith("[") ? parseList(value) : parseScalar(value);
    }
    return out;
  }
  return parseScalar(s);
}

/** Parses the front matter block; throws on anything outside the subset. */
export function parseFrontMatter(
  text: string,
): Record<string, FrontMatterValue> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") throw new Error("frontmatter: missing opening ---");
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error("frontmatter: missing closing ---");
  const data: Record<string, FrontMatterValue> = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i]!;
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    if (/^\s/.test(line)) {
      throw new Error(
        `frontmatter: unsupported indented value at line ${i + 1}: ${line}`,
      );
    }
    const m = KEY_LINE.exec(line);
    if (!m) throw new Error(`frontmatter: cannot parse line ${i + 1}: ${line}`);
    data[m[1]!] = m[2] === undefined ? "" : parseValue(m[2]);
  }
  return data;
}
