const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  middot: '·',
  times: '×',
  deg: '°',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body] ?? m;
  });
}

// Elements whose entire subtree is wiki chrome, not article content.
const SKIP_CLASS =
  /\b(mw-editsection|reference|navbox|toc|noprint|catlinks|printfooter|mw-jump-link|metadata|page-quality|mw-references|thumbcaption|magnify|NavFrame|version-table|version-links|version-link)\b/;
const SKIP_ID = /^(page-quality-rating|toc|catlinks|References)$/;
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'wbr', 'source']);

/**
 * Converts rendered MediaWiki HTML into plain text, dropping wiki chrome
 * (edit links, navboxes, references, TOC — even when nested) and normalizing
 * entities and whitespace.
 * @param html Rendered MediaWiki HTML.
 * @returns Cleaned plain text.
 */
export function cleanHtml(html: string): string {
  if (!html) return '';
  const s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const out: string[] = [];
  // Stack of open elements; skip=true if this element or an ancestor is chrome.
  const stack: { tag: string; skip: boolean }[] = [];
  const skipping = () => stack.length > 0 && stack[stack.length - 1].skip;

  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(s)) !== null) {
    const text = s.slice(last, m.index);
    if (text && !skipping()) out.push(decodeEntities(text));
    last = tagRe.lastIndex;

    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const selfClose = m[4] === '/' || VOID.has(tag);

    if (closing) {
      // Pop back to the matching open tag (tolerate minor imbalance).
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      if (!skipping()) emitClose(tag, out);
      continue;
    }

    if (selfClose) {
      if (!skipping() && tag === 'br') out.push('\n');
      continue;
    }

    const classMatch = /class\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const idMatch = /id\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const isChrome =
      (classMatch && SKIP_CLASS.test(classMatch[1])) || (idMatch && SKIP_ID.test(idMatch[1]));
    const skip = skipping() || !!isChrome;
    stack.push({ tag, skip });
    if (!skip) emitOpen(tag, out);
  }
  const tail = s.slice(last);
  if (tail && !skipping()) out.push(decodeEntities(tail));

  return normalizeText(out.join(''));
}

function emitOpen(tag: string, out: string[]): void {
  if (/^h[1-6]$/.test(tag)) out.push('\n\n## ');
  else if (tag === 'li') out.push('\n- ');
  else if (tag === 'tr') out.push('\n');
  else if (tag === 'dt' || tag === 'dd') out.push('\n');
  else if (tag === 'p' || tag === 'div' || tag === 'blockquote') out.push('\n');
}

function emitClose(tag: string, out: string[]): void {
  if (/^h[1-6]$/.test(tag)) out.push('\n');
  else if (tag === 'td' || tag === 'th') out.push(' | ');
  else if (tag === 'p' || tag === 'blockquote') out.push('\n');
  else if (tag === 'ul' || tag === 'ol') out.push('\n');
}

function normalizeText(s: string): string {
  return s
    .replace(/\[edit\]/gi, '')
    .replace(/This article is about an older version of DF\.?/gi, '') // version notice
    .replace(/[ \t\f\v]+/g, ' ') // collapse horizontal whitespace
    .replace(/(?: *\| *){2,}/g, ' | ') // collapse runs of empty table cells
    .replace(/ *\| *\n/g, '\n') // trailing table separators at line end
    .replace(/\n *\| */g, '\n') // leading table separators at line start
    .replace(/\n +/g, '\n') // leading spaces on lines
    .replace(/ +\n/g, '\n') // trailing spaces on lines
    .replace(/\n{3,}/g, '\n\n') // collapse blank runs
    .replace(/^(?:\s*##\s*)$/gm, '') // empty headings
    .trim();
}
