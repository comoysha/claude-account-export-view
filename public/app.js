(() => {
  const projectList = document.getElementById('project-list');
  const sessionList = document.getElementById('session-list');
  const sessionsTitle = document.getElementById('sessions-title');
  const detailTitle = document.getElementById('detail-title');
  const detailMeta = document.getElementById('detail-meta');
  const detailBody = document.getElementById('detail-body');
  const searchInput = document.getElementById('search-input');
  const refreshBtn = document.getElementById('refresh-btn');

  const state = {
    projects: [],
    currentProjectId: null,
    currentSessionId: null,
    highlightQuery: '',
    mode: 'browse', // 'browse' | 'search'
  };

  // ---- Marked setup (hljs runs as a post-pass to avoid marked-highlight bugs) ----
  marked.setOptions({ gfm: true, breaks: false });

  function highlightCodeIn(rootEl) {
    if (!window.hljs) return;
    rootEl.querySelectorAll('pre code').forEach((block) => {
      if (block.dataset.highlighted) return;
      try {
        const cls = (block.className || '').match(/language-([\w-]+)/);
        const lang = cls && cls[1];
        if (lang && hljs.getLanguage(lang)) {
          block.innerHTML = hljs.highlight(block.textContent, { language: lang, ignoreIllegals: true }).value;
        } else {
          block.innerHTML = hljs.highlightAuto(block.textContent).value;
        }
        block.dataset.highlighted = '1';
      } catch {}
    });
  }

  // ---- Helpers ----
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  function debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }

  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  }

  // ---- Projects ----
  async function loadProjects() {
    state.projects = await fetchJSON('/api/projects');
    renderProjects();
  }

  function renderProjects() {
    projectList.innerHTML = '';
    let lastSource = null;
    for (const p of state.projects) {
      if (p.source !== lastSource) {
        const header = document.createElement('li');
        header.className = 'source-header';
        header.textContent = p.source;
        projectList.appendChild(header);
        lastSource = p.source;
      }
      const li = document.createElement('li');
      li.dataset.id = p.id;
      li.innerHTML = `<div>${escapeHtml(p.name)}</div>
        <span class="secondary">${p.sessionCount} sessions${p.updated ? ' · ' + escapeHtml(p.updated) : ''}</span>`;
      if (p.id === state.currentProjectId) li.classList.add('active');
      li.addEventListener('click', () => selectProject(p.id));
      projectList.appendChild(li);
    }
  }

  async function selectProject(id) {
    state.currentProjectId = id;
    state.mode = 'browse';
    renderProjects();
    sessionsTitle.textContent = state.projects.find((p) => p.id === id)?.name || 'Sessions';
    const sessions = await fetchJSON(`/api/projects/${encodeURIComponent(id)}/sessions`);
    renderSessions(sessions);
  }

  function renderSessions(sessions) {
    sessionList.innerHTML = '';
    if (!sessions.length) {
      sessionList.innerHTML = '<li style="cursor:default;color:var(--text-muted)">（无 session）</li>';
      return;
    }
    for (const s of sessions) {
      const li = document.createElement('li');
      li.dataset.id = s.id;
      li.innerHTML = `<div>${escapeHtml(s.title)}</div>
        <span class="secondary">${escapeHtml(s.date || '')} · <code>${escapeHtml(s.shortId || '')}</code></span>`;
      if (s.id === state.currentSessionId) li.classList.add('active');
      li.addEventListener('click', () => selectSession(state.currentProjectId, s.id));
      sessionList.appendChild(li);
    }
  }

  async function selectSession(projectId, sessionId, opts = {}) {
    state.currentProjectId = projectId;
    state.currentSessionId = sessionId;
    state.highlightQuery = opts.highlight || '';

    // Update active state in current sessions column
    document.querySelectorAll('#session-list li').forEach((li) => {
      li.classList.toggle('active', li.dataset.id === sessionId);
    });

    detailTitle.textContent = '加载中…';
    detailMeta.innerHTML = '';
    detailBody.innerHTML = '';

    const data = await fetchJSON(`/api/sessions/${encodeURIComponent(projectId)}/${encodeURIComponent(sessionId)}`);
    renderDetail(data);
  }

  function renderDetail(data) {
    detailTitle.textContent = data.title || data.meta?.Title || data.sessionId;
    detailMeta.innerHTML = '';
    const metaPairs = [
      ['Date', data.date],
      ['Short id', data.shortId],
      ...Object.entries(data.meta || {}).filter(([k]) => k !== 'Title'),
    ];
    for (const [k, v] of metaPairs) {
      if (!v) continue;
      const span = document.createElement('span');
      span.innerHTML = `<strong>${escapeHtml(k)}:</strong> <code>${escapeHtml(v)}</code>`;
      detailMeta.appendChild(span);
    }

    detailBody.innerHTML = '';
    if (!data.segments || !data.segments.length) {
      detailBody.innerHTML = '<div class="empty">这个 session 没有可解析的对话内容。</div>';
      return;
    }

    // Group consecutive tool-only segments into a single foldable strip.
    const groups = [];
    for (const seg of data.segments) {
      if (seg.kind === 'tool') {
        const last = groups[groups.length - 1];
        if (last && last.type === 'tool') {
          last.segments.push(seg);
        } else {
          groups.push({ type: 'tool', segments: [seg] });
        }
      } else {
        groups.push({ type: 'text', segment: seg });
      }
    }

    for (const g of groups) {
      if (g.type === 'text') {
        const seg = g.segment;
        const div = document.createElement('div');
        div.className = `bubble ${seg.role}`;
        const roleLabel =
          seg.role === 'user' ? '👤 用户' : seg.role === 'assistant' ? '🤖 Claude' : 'ℹ️ 系统';
        const html = marked.parse(seg.markdown || '');
        div.innerHTML = `<div class="role">${roleLabel}</div>${html}`;
        detailBody.appendChild(div);
      } else {
        detailBody.appendChild(renderToolGroup(g.segments));
      }
    }

    // Force-collapse all <details>
    detailBody.querySelectorAll('details').forEach((d) => (d.open = false));

    // Syntax-highlight code blocks (post-pass)
    highlightCodeIn(detailBody);

    // Highlight search query if any
    if (state.highlightQuery) {
      highlightInDetail(state.highlightQuery);
    }

    // Scroll to top
    document.querySelector('.col-detail').scrollTop = 0;
  }

  function renderToolGroup(segments) {
    const totalCalls = segments.reduce((acc, s) => acc + (s.tools?.length || 1), 0);
    const labels = [];
    for (const s of segments) {
      for (const t of s.tools || []) {
        const m = /tool_use:\s*(\S+)/.exec(t) || /tool_result/.exec(t);
        if (m) labels.push(m[1] || 'tool_result');
      }
    }
    const labelSummary = labels.length
      ? ` <span class="tool-strip-tags">${[...new Set(labels)].slice(0, 6).map((l) => `<code>${escapeHtml(l)}</code>`).join(' ')}</span>`
      : '';
    const details = document.createElement('details');
    details.className = 'tool-strip';
    const summary = document.createElement('summary');
    summary.innerHTML = `🔧 工具交互 <span class="count">×${totalCalls}</span>${labelSummary}`;
    details.appendChild(summary);
    const inner = document.createElement('div');
    inner.className = 'tool-strip-body';
    for (const seg of segments) {
      const html = marked.parse(seg.markdown || '');
      const wrapper = document.createElement('div');
      wrapper.className = `tool-row ${seg.role === 'user' ? 'tool-result' : 'tool-use'}`;
      wrapper.innerHTML = html;
      inner.appendChild(wrapper);
    }
    details.appendChild(inner);
    return details;
  }

  function highlightInDetail(q) {
    if (!q) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const walker = document.createTreeWalker(detailBody, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement.closest('script, style')) return NodeFilter.FILTER_REJECT;
        return re.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);
    let first = null;
    for (const node of targets) {
      const frag = document.createDocumentFragment();
      const text = node.nodeValue;
      let last = 0;
      text.replace(re, (m, offset) => {
        if (offset > last) frag.appendChild(document.createTextNode(text.slice(last, offset)));
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = m;
        frag.appendChild(mark);
        if (!first) first = mark;
        last = offset + m.length;
        return m;
      });
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
    if (first) {
      // Open any <details> that contain the first hit
      let p = first.parentElement;
      while (p && p !== detailBody) {
        if (p.tagName === 'DETAILS') p.open = true;
        p = p.parentElement;
      }
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // ---- Search ----
  const doSearch = debounce(async () => {
    const q = searchInput.value.trim();
    if (!q) {
      state.mode = 'browse';
      if (state.currentProjectId) selectProject(state.currentProjectId);
      else sessionList.innerHTML = '';
      sessionsTitle.textContent = state.currentProjectId
        ? state.projects.find((p) => p.id === state.currentProjectId)?.name || 'Sessions'
        : 'Sessions';
      return;
    }
    state.mode = 'search';
    sessionsTitle.textContent = `搜索: ${q}`;
    sessionList.innerHTML = '<li style="cursor:default;color:var(--text-muted)">搜索中…</li>';
    try {
      const results = await fetchJSON(`/api/search?q=${encodeURIComponent(q)}`);
      renderSearchResults(results, q);
    } catch (e) {
      sessionList.innerHTML = `<li style="cursor:default;color:#dc2626">搜索失败: ${escapeHtml(String(e))}</li>`;
    }
  }, 220);

  function renderSearchResults(results, q) {
    sessionList.innerHTML = '';
    if (!results.length) {
      sessionList.innerHTML = '<li style="cursor:default;color:var(--text-muted)">没有命中</li>';
      return;
    }
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    for (const r of results) {
      const li = document.createElement('li');
      li.className = 'search-result';
      const snippet = escapeHtml(r.snippet || '').replace(re, (m) => `<mark>${m}</mark>`);
      li.innerHTML = `<div>${escapeHtml(r.title)}</div>
        <span class="secondary"><em>${escapeHtml(r.source || '')}</em> · ${escapeHtml(r.projectName)} · ${escapeHtml(r.date || '')} · ${r.matchCount} 次命中</span>
        <div class="snippet">${snippet}</div>`;
      li.addEventListener('click', () => selectSession(r.projectId, r.sessionId, { highlight: q }));
      sessionList.appendChild(li);
    }
  }

  searchInput.addEventListener('input', doSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      doSearch();
    }
  });

  refreshBtn.addEventListener('click', async () => {
    await fetchJSON('/api/projects?refresh=1');
    loadProjects();
  });

  loadProjects().catch((e) => {
    projectList.innerHTML = `<li style="color:#dc2626">加载失败: ${escapeHtml(String(e))}</li>`;
  });
})();
