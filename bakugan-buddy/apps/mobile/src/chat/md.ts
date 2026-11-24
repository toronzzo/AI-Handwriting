/**
 * The small Markdown the chat actually needs.
 *
 * Local replies come back with **bold**, `code`, lists, headings, fenced blocks
 * and the odd [link](https://…). Rendering them literally looks broken, so this
 * turns a reply into blocks + inline runs. No dependency, no HTML, no images.
 */

export type MdInline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type MdBlock =
  | { kind: "p"; inlines: MdInline[] }
  | { kind: "h"; level: 1 | 2 | 3; inlines: MdInline[] }
  | { kind: "ul"; items: MdInline[][] }
  | { kind: "ol"; items: MdInline[][] }
  | { kind: "code"; lang: string; text: string };

function pushText(out: MdInline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === "text") last.text += text;
  else out.push({ kind: "text", text });
}

/** One line of prose into runs. Unknown or unclosed markers stay literal. */
export function parseInline(source: string): MdInline[] {
  const out: MdInline[] = [];
  const text = String(source ?? "");
  let buffer = "";
  const flush = () => {
    pushText(out, buffer);
    buffer = "";
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\`") {
      const end = text.indexOf("\`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && text[i + 1] === ch) {
      const end = text.indexOf(ch + ch, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ kind: "bold", text: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const end = text.indexOf(ch, i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: "italic", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const close = text.indexOf("](", i);
      const end = close > -1 ? text.indexOf(")", close + 2) : -1;
      if (close > -1 && end > close + 2) {
        flush();
        out.push({ kind: "link", text: text.slice(i + 1, close), href: text.slice(close + 2, end) });
        i = end + 1;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return out;
}

const FENCE = /^\s*```(\w*)\s*$/;
const HEADING = /^\s*(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

/** A reply into blocks. Blank lines separate; anything unrecognised is prose. */
export function parseMarkdown(source: string): MdBlock[] {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = line.match(FENCE);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ kind: "code", lang: fence[1] || "", text: body.join("\n") });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ kind: "h", level, inlines: parseInline(heading[2].trim()) });
      i += 1;
      continue;
    }
    if (BULLET.test(line)) {
      const items: MdInline[][] = [];
      while (i < lines.length) {
        const match = lines[i].match(BULLET);
        if (!match) break;
        items.push(parseInline(match[1].trim()));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (NUMBER.test(line)) {
      const items: MdInline[][] = [];
      while (i < lines.length) {
        const match = lines[i].match(NUMBER);
        if (!match) break;
        items.push(parseInline(match[1].trim()));
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    const prose: string[] = [];
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBER.test(lines[i])) {
      prose.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ kind: "p", inlines: parseInline(prose.join(" ")) });
  }
  return blocks;
}
