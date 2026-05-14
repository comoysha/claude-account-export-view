const express = require('express');
const path = require('path');
const fs = require('fs');
const { scanAll, invalidate, getProject, getSession } = require('./lib/scanner');
const { parseSession, searchInFile } = require('./lib/parser');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--dir') out.dir = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv);

let fileConfig = {};
const configPath = path.join(__dirname, 'config.json');
try {
  fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') console.warn(`[warn] failed to read config.json: ${e.message}`);
}

let SOURCES;
if (args.dir) {
  SOURCES = [{ name: path.basename(args.dir), dir: args.dir }];
} else if (process.env.COWORK_DIR) {
  SOURCES = [{ name: path.basename(process.env.COWORK_DIR), dir: process.env.COWORK_DIR }];
} else if (Array.isArray(fileConfig.sources) && fileConfig.sources.length) {
  SOURCES = fileConfig.sources;
} else if (fileConfig.coworkDir) {
  SOURCES = [{ name: 'cowork', dir: fileConfig.coworkDir }];
} else {
  console.error('[fatal] no source configured (config.json `sources`, or --dir, or $COWORK_DIR)');
  process.exit(1);
}

for (const s of SOURCES) {
  if (!s.name || !s.dir) {
    console.error(`[fatal] invalid source entry: ${JSON.stringify(s)} (need {name, dir})`);
    process.exit(1);
  }
  if (!fs.existsSync(s.dir) || !fs.statSync(s.dir).isDirectory()) {
    console.warn(`[warn] source "${s.name}" dir does not exist: ${s.dir}`);
  }
}

const PORT = args.port || Number(process.env.PORT) || fileConfig.port || 5273;

const app = express();

app.get('/api/projects', (req, res) => {
  if (req.query.refresh) invalidate();
  const projects = scanAll(SOURCES);
  res.json(projects.map(({ id, name, source, sessionCount, updated }) => ({ id, name, source, sessionCount, updated })));
});

app.get('/api/sources', (_req, res) => {
  res.json(SOURCES.map(({ name, dir }) => ({ name, dir })));
});

app.get('/api/projects/:projectId/sessions', (req, res) => {
  const project = getProject(SOURCES, req.params.projectId);
  if (!project) return res.status(404).json({ error: 'project not found' });
  res.json(
    project.sessions.map(({ id, title, date, shortId }) => ({ id, title, date, shortId }))
  );
});

app.get('/api/sessions/:projectId/:sessionId', (req, res) => {
  const found = getSession(SOURCES, req.params.projectId, req.params.sessionId);
  if (!found) return res.status(404).json({ error: 'session not found' });
  try {
    const parsed = parseSession(found.absPath);
    res.json({
      projectId: found.project.id,
      projectName: found.project.name,
      source: found.project.source,
      sessionId: found.session.id,
      title: found.session.title,
      date: found.session.date,
      shortId: found.session.shortId,
      ...parsed,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const projects = scanAll(SOURCES);
  const results = [];
  for (const project of projects) {
    for (const session of project.sessions) {
      const abs = path.join(project.dir, session.file);
      const hit = searchInFile(abs, q);
      if (hit) {
        results.push({
          projectId: project.id,
          projectName: project.name,
          source: project.source,
          sessionId: session.id,
          title: session.title,
          date: session.date,
          shortId: session.shortId,
          matchCount: hit.matchCount,
          snippet: hit.snippets[0] || '',
        });
      }
    }
  }
  results.sort((a, b) => b.matchCount - a.matchCount || (b.date || '').localeCompare(a.date || ''));
  res.json(results);
});

app.use(express.static(path.join(__dirname, 'public')));

function listen(port, retries = 10) {
  const server = app.listen(port, () => {
    const actual = server.address().port;
    const projects = scanAll(SOURCES);
    const totalSessions = projects.reduce((acc, p) => acc + p.sessionCount, 0);
    console.log(`[cowork-view] sources:`);
    for (const s of SOURCES) console.log(`  - ${s.name} -> ${s.dir}`);
    console.log(`[cowork-view] projects = ${projects.length}, sessions = ${totalSessions}`);
    console.log(`[cowork-view] listening on http://localhost:${actual}`);
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && retries > 0) {
      console.warn(`[warn] port ${port} in use, trying ${port + 1}`);
      setTimeout(() => listen(port + 1, retries - 1), 50);
    } else {
      console.error(`[fatal] listen failed: ${e.message}`);
      process.exit(1);
    }
  });
}
listen(PORT);
