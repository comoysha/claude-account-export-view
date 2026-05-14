const fs = require('fs');

const ROLE_HEADING_RE = /^### (👤 用户|🤖 Claude)\s*$/m;
const META_LINE_RE = /^- \*\*([^*]+)\*\*:\s*(.*)$/;

function parseSession(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');

  // First top-level `---` line separates header block from body.
  const sepIdx = raw.search(/(^|\n)---\s*(\n|$)/);
  let headerBlock = '';
  let body = raw;
  if (sepIdx >= 0) {
    headerBlock = raw.slice(0, sepIdx);
    body = raw.slice(sepIdx).replace(/^(\n)?---\s*\n?/, '');
  }

  const meta = parseHeader(headerBlock);
  const segments = splitSegments(body);

  return { meta, segments };
}

function parseHeader(block) {
  const lines = block.split('\n');
  const meta = {};
  let title = '';
  for (const line of lines) {
    if (!title) {
      const tm = /^#\s+(.+)$/.exec(line);
      if (tm) { title = tm[1].trim(); continue; }
    }
    const m = META_LINE_RE.exec(line);
    if (m) {
      const key = m[1].trim();
      const value = m[2].replace(/^`|`$/g, '').trim();
      meta[key] = value;
    }
  }
  if (title) meta.Title = title;
  return meta;
}

function splitSegments(body) {
  const re = /^### (👤 用户|🤖 Claude)\s*$/gm;
  const segments = [];
  const matches = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    matches.push({ role: m[1].startsWith('👤') ? 'user' : 'assistant', start: m.index, headerEnd: m.index + m[0].length });
  }
  if (matches.length === 0) {
    const md = body.trim();
    if (md) segments.push({ role: 'assistant', markdown: md });
    return segments;
  }
  // Optional preamble before first heading: attach as a "system" segment if present.
  if (matches[0].start > 0) {
    const pre = body.slice(0, matches[0].start).trim();
    if (pre) segments.push({ role: 'system', markdown: pre });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const start = cur.headerEnd;
    const end = next ? next.start : body.length;
    const markdown = body.slice(start, end).replace(/^\n+/, '').replace(/\n+$/, '');
    segments.push({ role: cur.role, markdown, ...classifySegment(markdown) });
  }
  return segments;
}

// Strip top-level <details>...</details> blocks. If remainder is whitespace-only,
// this segment is purely tool I/O (tool_use for assistant, tool_result for user).
function classifySegment(markdown) {
  const stripped = markdown.replace(/<details\b[\s\S]*?<\/details>/gi, '').trim();
  if (stripped.length === 0) {
    // Inspect summaries to label the tool type & name.
    const tools = [];
    const re = /<summary>([^<]*?)(?:<code>([^<]+)<\/code>)?([^<]*)<\/summary>/gi;
    let m;
    while ((m = re.exec(markdown)) !== null) {
      const text = `${m[1] || ''}${m[2] || ''}${m[3] || ''}`.trim();
      tools.push(text);
    }
    return { kind: 'tool', tools };
  }
  return { kind: 'text' };
}

function searchInFile(absPath, query, { maxMatches = 5, context = 80 } = {}) {
  const raw = fs.readFileSync(absPath, 'utf8');
  const lower = raw.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return null;
  const matches = [];
  let idx = 0;
  let count = 0;
  while ((idx = lower.indexOf(q, idx)) !== -1) {
    count++;
    if (matches.length < maxMatches) {
      const s = Math.max(0, idx - context);
      const e = Math.min(raw.length, idx + q.length + context);
      let snippet = raw.slice(s, e).replace(/\s+/g, ' ').trim();
      if (s > 0) snippet = '…' + snippet;
      if (e < raw.length) snippet = snippet + '…';
      matches.push(snippet);
    }
    idx += q.length;
  }
  if (count === 0) return null;
  return { matchCount: count, snippets: matches };
}

module.exports = { parseSession, searchInFile };
