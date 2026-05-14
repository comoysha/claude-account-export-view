const fs = require('fs');
const path = require('path');

const SESSION_FILE_RE = /^(\d{4}-\d{2}-\d{2})\s+([0-9a-f]{8})\s+(.+)\.md$/;
const SKIP_FILES = new Set(['PROJECT.md', 'README.md']);
const SOURCE_SEP = '__';

let cache = null;
let cacheKey = null;

function makeKey(sources) {
  return sources.map((s) => `${s.name}=${s.dir}`).join('|');
}

function scanAll(sources, { force = false } = {}) {
  const key = makeKey(sources);
  if (!force && cache && cacheKey === key) return cache;

  const out = [];
  for (const src of sources) {
    let entries;
    try {
      entries = fs.readdirSync(src.dir, { withFileTypes: true });
    } catch (e) {
      console.warn(`[warn] source "${src.name}" dir not readable: ${src.dir} (${e.code})`);
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      const projectDir = path.join(src.dir, ent.name);
      const sessions = [];
      let files = [];
      try {
        files = fs.readdirSync(projectDir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (file.startsWith('.') || SKIP_FILES.has(file) || !file.endsWith('.md')) continue;
        const abs = path.join(projectDir, file);
        let stat;
        try { stat = fs.statSync(abs); } catch { continue; }
        const m = SESSION_FILE_RE.exec(file);
        const id = file.replace(/\.md$/, '');
        const session = m
          ? { id, date: m[1], shortId: m[2], title: m[3], file, mtime: stat.mtimeMs }
          : { id, date: '', shortId: '', title: id, file, mtime: stat.mtimeMs };
        sessions.push(session);
      }
      sessions.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.mtime - a.mtime);
      out.push({
        id: `${src.name}${SOURCE_SEP}${ent.name}`,
        source: src.name,
        name: ent.name,
        dir: projectDir,
        sessionCount: sessions.length,
        updated: sessions[0]?.date || '',
        sessions,
      });
    }
  }

  // sort: by source (keep config order), then by updated desc within source
  const sourceOrder = new Map(sources.map((s, i) => [s.name, i]));
  out.sort((a, b) => {
    const so = (sourceOrder.get(a.source) ?? 0) - (sourceOrder.get(b.source) ?? 0);
    if (so !== 0) return so;
    return (b.updated || '').localeCompare(a.updated || '') || a.name.localeCompare(b.name);
  });

  cache = out;
  cacheKey = key;
  return out;
}

function invalidate() {
  cache = null;
  cacheKey = null;
}

function parseProjectId(projectId) {
  const idx = projectId.indexOf(SOURCE_SEP);
  if (idx < 0) return null;
  return { source: projectId.slice(0, idx), dirName: projectId.slice(idx + SOURCE_SEP.length) };
}

function getProject(sources, projectId) {
  return scanAll(sources).find((p) => p.id === projectId);
}

function getSession(sources, projectId, sessionId) {
  const project = getProject(sources, projectId);
  if (!project) return null;
  const session = project.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  return { project, session, absPath: path.join(project.dir, session.file) };
}

module.exports = { scanAll, invalidate, getProject, getSession, parseProjectId, SOURCE_SEP };
