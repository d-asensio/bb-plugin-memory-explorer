// A memory's text as display blocks: `## ` headings, bullets and text lines,
// with URLs turned into links (knowledge.ts adds the `[[links]]`).
//
// No Node imports: the page bundles this module too.

/** A run of text in a body line; `href` makes it a link. */
export interface Segment {
  text: string;
  href?: string;
  /** Name of the memory a `[[link]]` points at; set by `detailsToBlocks`. */
  memory?: string;
}

export type Block =
  | { type: "heading"; text: string }
  | { type: "bullet"; segments: Segment[] }
  | { type: "text"; segments: Segment[] };

// `(https://…)` with its parentheses, or a bare `https://…` up to whitespace.
const URL_PATTERN = /\((https?:\/\/[^\s()]+)\)|(https?:\/\/[^\s<>()]+)/g;
/** Trailing punctuation that ends a sentence rather than a bare URL. */
const TRAILING = /[.,;:!?'"]+$/;

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * Splits a line into text and links. A parenthesised URL becomes a link
 * labelled with its host, kept inside the parentheses; a bare URL becomes a
 * link labelled with itself.
 */
export function linkify(line: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  const push = (text: string) => {
    if (text === "") return;
    const previous = segments[segments.length - 1];
    if (previous !== undefined && previous.href === undefined) {
      previous.text += text;
    } else {
      segments.push({ text });
    }
  };
  for (const match of line.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    push(line.slice(last, start));
    if (match[1] !== undefined) {
      push("(");
      segments.push({ text: hostOf(match[1]), href: match[1] });
      push(")");
      last = start + match[0].length;
    } else {
      const url = match[2]!.replace(TRAILING, "");
      segments.push({ text: url, href: url });
      last = start + url.length;
    }
  }
  push(line.slice(last));
  return segments;
}

/**
 * A body as display blocks: `## ` headings, `- ` (or `* `)
 * bullets, and every other non-blank line as text, URLs linked (or whatever
 * `segmentize` makes of a line).
 */
export function bodyToBlocks(
  body: string,
  segmentize: (line: string) => Segment[] = linkify,
): Block[] {
  const blocks: Block[] = [];
  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", text: heading[1]!.trim() });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push({ type: "bullet", segments: segmentize(bullet[1]!) });
      continue;
    }
    blocks.push({ type: "text", segments: segmentize(line) });
  }
  return blocks;
}
