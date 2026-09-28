// Gestores de tareas del equipo: GitHub Issues, Jira, Linear y Azure DevOps.
// Trae los tickets asignados a ti, los cierra cuando completas la tarea en PM y
// (Jira y Azure DevOps) carga el tiempo que mediste como horas trabajadas.
// Sin dependencias: solo fetch. `http` se inyecta en los tests.

const PROVIDERS = {
  github: { label: 'GitHub Issues', emoji: '🐙', logsTime: false },
  jira: { label: 'Jira', emoji: '🟦', logsTime: true },
  linear: { label: 'Linear', emoji: '🟪', logsTime: false },
  azure: { label: 'Azure DevOps', emoji: '🔷', logsTime: true },
};

const trimUrl = (u) => String(u || '').trim().replace(/\/+$/, '');

async function call(http, url, opts = {}) {
  const res = await http(url, { ...opts, headers: { Accept: 'application/json', 'User-Agent': 'PM-Pollito', ...(opts.headers || {}) } });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* no es JSON */ }
  if (!res.ok) {
    const msg = (json && (json.message || (json.errorMessages && json.errorMessages[0]) || (json.errors && json.errors[0] && json.errors[0].message))) || text.slice(0, 160) || '';
    throw Object.assign(new Error(res.status === 401 || res.status === 403 ? `Sin permiso (${res.status}): revisa el token` : `HTTP ${res.status}${msg ? ': ' + msg : ''}`), { status: res.status });
  }
  return json;
}

// ---------------- GitHub Issues ----------------
const gh = {
  headers: (c) => ({ Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json' }),
  async assigned(c, http) {
    const list = await call(http, 'https://api.github.com/issues?filter=assigned&state=open&per_page=50', { headers: gh.headers(c) });
    return (list || []).filter((i) => !i.pull_request).map((i) => {
      const full = i.repository ? i.repository.full_name : String(i.repository_url || '').split('/repos/')[1] || '';
      return { provider: 'github', id: String(i.id), key: `${full.split('/').pop()}#${i.number}`, title: i.title, url: i.html_url, status: 'abierto', project: full.split('/').pop(), ref: { repo: full, number: i.number } };
    });
  },
  async complete(c, issue, http) {
    await call(http, `https://api.github.com/repos/${issue.ref.repo}/issues/${issue.ref.number}`, {
      method: 'PATCH', headers: { ...gh.headers(c), 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
    });
    return 'cerrado';
  },
};

// ---------------- Jira (Cloud con email + API token; Server/DC con token personal) ----------------
const jira = {
  cloud: (c) => !!c.email,
  headers: (c) => ({ Authorization: jira.cloud(c) ? 'Basic ' + Buffer.from(`${c.email}:${c.token}`).toString('base64') : `Bearer ${c.token}` }),
  api: (c) => `${trimUrl(c.site)}/rest/api/${jira.cloud(c) ? 3 : 2}`,
  async assigned(c, http) {
    const jql = 'assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, updated DESC';
    const q = `jql=${encodeURIComponent(jql)}&fields=summary,status,project&maxResults=50`;
    const url = jira.cloud(c) ? `${jira.api(c)}/search/jql?${q}` : `${jira.api(c)}/search?${q}`;
    const r = await call(http, url, { headers: jira.headers(c) });
    return ((r && r.issues) || []).map((i) => ({
      provider: 'jira', id: String(i.id), key: i.key, title: i.fields.summary, url: `${trimUrl(c.site)}/browse/${i.key}`,
      status: (i.fields.status && i.fields.status.name) || '', project: (i.fields.project && i.fields.project.key) || '', ref: { key: i.key },
    }));
  },
  async complete(c, issue, http) {
    const url = `${jira.api(c)}/issue/${issue.ref.key}/transitions`;
    const r = await call(http, url, { headers: jira.headers(c) });
    const t = ((r && r.transitions) || []).find((x) => x.to && x.to.statusCategory && x.to.statusCategory.key === 'done');
    if (!t) throw new Error('No encontré un paso a "Hecho" en el flujo de este ticket');
    await call(http, url, { method: 'POST', headers: { ...jira.headers(c), 'Content-Type': 'application/json' }, body: JSON.stringify({ transition: { id: t.id } }) });
    return t.to.name || t.name;
  },
  async logWork(c, issue, seconds, http) {
    await call(http, `${jira.api(c)}/issue/${issue.ref.key}/worklog`, {
      method: 'POST', headers: { ...jira.headers(c), 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeSpentSeconds: Math.max(60, Math.round(seconds / 60) * 60) }),
    });
    return true;
  },
};

// ---------------- Linear ----------------
const linear = {
  async gql(c, http, query, variables) {
    const r = await call(http, 'https://api.linear.app/graphql', {
      method: 'POST', headers: { Authorization: c.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }),
    });
    if (r && r.errors && r.errors.length) throw new Error(r.errors[0].message);
    return r.data;
  },
  async assigned(c, http) {
    const d = await linear.gql(c, http, `query { viewer { assignedIssues(first: 50, filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
      nodes { id identifier title url state { name } team { key } } } } }`);
    return d.viewer.assignedIssues.nodes.map((i) => ({
      provider: 'linear', id: i.id, key: i.identifier, title: i.title, url: i.url, status: (i.state && i.state.name) || '', project: (i.team && i.team.key) || '', ref: { id: i.id },
    }));
  },
  async complete(c, issue, http) {
    const d = await linear.gql(c, http, 'query($id: String!) { issue(id: $id) { team { states { nodes { id name type position } } } } }', { id: issue.ref.id });
    const done = d.issue.team.states.nodes.filter((s) => s.type === 'completed').sort((a, b) => a.position - b.position)[0];
    if (!done) throw new Error('El equipo no tiene un estado de "completado"');
    const u = await linear.gql(c, http, 'mutation($id: String!, $s: String!) { issueUpdate(id: $id, input: { stateId: $s }) { success } }', { id: issue.ref.id, s: done.id });
    if (!u.issueUpdate.success) throw new Error('Linear no aceptó el cambio');
    return done.name;
  },
};

// ---------------- Azure DevOps (URL de la organización + token personal) ----------------
const azure = {
  headers: (c) => ({ Authorization: 'Basic ' + Buffer.from(`:${c.token}`).toString('base64') }),
  async assigned(c, http) {
    const org = trimUrl(c.org);
    const w = await call(http, `${org}/_apis/wit/wiql?$top=50&api-version=7.1`, {
      method: 'POST', headers: { ...azure.headers(c), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed', 'Done', 'Removed', 'Resolved', 'Completed') ORDER BY [System.ChangedDate] DESC" }),
    });
    const ids = ((w && w.workItems) || []).slice(0, 50).map((x) => x.id);
    if (!ids.length) return [];
    const r = await call(http, `${org}/_apis/wit/workitems?ids=${ids.join(',')}&fields=System.Title,System.State,System.TeamProject,System.WorkItemType&api-version=7.1`, { headers: azure.headers(c) });
    return ((r && r.value) || []).map((i) => {
      const proj = i.fields['System.TeamProject'] || '';
      return { provider: 'azure', id: String(i.id), key: `#${i.id}`, title: i.fields['System.Title'], url: `${org}/${encodeURIComponent(proj)}/_workitems/edit/${i.id}`, status: i.fields['System.State'] || '', project: proj, ref: { id: i.id } };
    });
  },
  patch(c, http, id, ops) {
    return call(http, `${trimUrl(c.org)}/_apis/wit/workitems/${id}?api-version=7.1`, {
      method: 'PATCH', headers: { ...azure.headers(c), 'Content-Type': 'application/json-patch+json' }, body: JSON.stringify(ops),
    });
  },
  async complete(c, issue, http) {
    // Cada proceso (Agile, Scrum, Basic, CMMI) llama distinto al estado final: se prueban en orden.
    let last;
    for (const state of ['Done', 'Closed', 'Completed']) {
      try { await azure.patch(c, http, issue.ref.id, [{ op: 'add', path: '/fields/System.State', value: state }]); return state; } catch (e) { last = e; if (e.status && e.status !== 400) throw e; }
    }
    throw last;
  },
  async logWork(c, issue, seconds, http) {
    const cur = await call(http, `${trimUrl(c.org)}/_apis/wit/workitems/${issue.ref.id}?fields=Microsoft.VSTS.Scheduling.CompletedWork&api-version=7.1`, { headers: azure.headers(c) });
    const prev = Number(cur && cur.fields && cur.fields['Microsoft.VSTS.Scheduling.CompletedWork']) || 0;
    const hours = Math.round((prev + seconds / 3600) * 100) / 100;
    await azure.patch(c, http, issue.ref.id, [{ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.CompletedWork', value: hours }]);
    return true;
  },
};

// ---------------- descripción y "en curso" de cada gestor ----------------
/** Texto plano de un documento de Jira Cloud (Atlassian Document Format). */
function adfText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content || []).map(adfText).join('');
  if (node.type === 'listItem') return '- ' + inner.trim() + '\n';
  return /^(paragraph|heading|codeBlock|blockquote|bulletList|orderedList|rule|table|tableRow)$/.test(node.type) ? inner.replace(/\n*$/, '') + '\n' : inner;
}
const htmlText = (h) => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

gh.details = async (c, issue, http) => {
  const i = await call(http, `https://api.github.com/repos/${issue.ref.repo}/issues/${issue.ref.number}`, { headers: gh.headers(c) });
  return i.body || '';
};
jira.details = async (c, issue, http) => {
  const i = await call(http, `${jira.api(c)}/issue/${issue.ref.key}?fields=description`, { headers: jira.headers(c) });
  return adfText(i.fields && i.fields.description);
};
jira.start = async (c, issue, http) => {
  const url = `${jira.api(c)}/issue/${issue.ref.key}/transitions`;
  const r = await call(http, url, { headers: jira.headers(c) });
  const t = ((r && r.transitions) || []).find((x) => x.to && x.to.statusCategory && x.to.statusCategory.key === 'indeterminate');
  if (!t) return null; // ya está en curso o el flujo no lo permite desde aquí
  await call(http, url, { method: 'POST', headers: { ...jira.headers(c), 'Content-Type': 'application/json' }, body: JSON.stringify({ transition: { id: t.id } }) });
  return t.to.name || t.name;
};
linear.details = async (c, issue, http) => {
  const d = await linear.gql(c, http, 'query($id: String!) { issue(id: $id) { description } }', { id: issue.ref.id });
  return (d.issue && d.issue.description) || '';
};
linear.start = async (c, issue, http) => {
  const d = await linear.gql(c, http, 'query($id: String!) { issue(id: $id) { state { type } team { states { nodes { id name type position } } } } }', { id: issue.ref.id });
  if (d.issue.state && d.issue.state.type === 'started') return null;
  const st = d.issue.team.states.nodes.filter((s) => s.type === 'started').sort((a, b) => a.position - b.position)[0];
  if (!st) return null;
  await linear.gql(c, http, 'mutation($id: String!, $s: String!) { issueUpdate(id: $id, input: { stateId: $s }) { success } }', { id: issue.ref.id, s: st.id });
  return st.name;
};
azure.details = async (c, issue, http) => {
  const i = await call(http, `${trimUrl(c.org)}/_apis/wit/workitems/${issue.ref.id}?fields=System.Description&api-version=7.1`, { headers: azure.headers(c) });
  return htmlText(i.fields && i.fields['System.Description']).trim();
};
azure.start = async (c, issue, http) => {
  // Agile: Active · Scrum: Committed · Basic: Doing · algunos procesos propios: In Progress.
  for (const state of ['Active', 'In Progress', 'Doing', 'Committed']) {
    try { await azure.patch(c, http, issue.ref.id, [{ op: 'add', path: '/fields/System.State', value: state }]); return state; } catch (e) { if (e.status && e.status !== 400) throw e; }
  }
  return null;
};

const IMPL = { github: gh, jira, linear, azure };

/** ¿Tiene lo mínimo para conectarse? */
function ready(provider, c) {
  if (!c || !c.token) return false;
  if (provider === 'jira') return /^https?:\/\//.test(c.site || '');
  if (provider === 'azure') return /^https?:\/\//.test(c.org || '');
  return true;
}

/** Tickets asignados a ti en todos los gestores configurados. cfg: { github: {token}, jira: {site, email, token}, … } */
async function fetchAll(cfg, http = fetch) {
  const issues = [];
  const errors = [];
  for (const p of Object.keys(IMPL)) {
    if (!ready(p, cfg[p])) continue;
    try { issues.push(...(await IMPL[p].assigned(cfg[p], http))); } catch (e) { errors.push({ provider: p, label: PROVIDERS[p].label, error: e.message }); }
  }
  return { issues, errors };
}

/** Marca el ticket como hecho en su gestor. Devuelve el nombre del estado final. */
function complete(issue, cfg, http = fetch) {
  const impl = IMPL[issue.provider];
  if (!impl || !ready(issue.provider, cfg[issue.provider])) return Promise.reject(new Error('Gestor no configurado'));
  return impl.complete(cfg[issue.provider], issue, http);
}

/** Carga el tiempo medido como horas trabajadas (Jira y Azure DevOps). */
async function logWork(issue, seconds, cfg, http = fetch) {
  const impl = IMPL[issue.provider];
  if (!impl || !impl.logWork || seconds < 60 || !ready(issue.provider, cfg[issue.provider])) return false;
  return impl.logWork(cfg[issue.provider], issue, seconds, http);
}

/** Descripción del ticket en texto plano (para pasársela a Claude). */
async function details(issue, cfg, http = fetch) {
  const impl = IMPL[issue.provider];
  if (!impl || !impl.details || !ready(issue.provider, cfg[issue.provider])) return '';
  return String(await impl.details(cfg[issue.provider], issue, http) || '').trim().slice(0, 8000);
}

/** Pasa el ticket a "en curso". Devuelve el estado nuevo o null si no hacía falta / no se puede (GitHub no tiene estados). */
async function startProgress(issue, cfg, http = fetch) {
  const impl = IMPL[issue.provider];
  if (!impl || !impl.start || !ready(issue.provider, cfg[issue.provider])) return null;
  return impl.start(cfg[issue.provider], issue, http);
}

/** Nombre de rama para trabajar un ticket: "pm-12-informe-de-ventas", "issue-7-login-safari". */
function branchName(issue) {
  const clean = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const key = issue.provider === 'github' ? `issue-${issue.ref && issue.ref.number}` : clean(issue.key);
  const words = clean(issue.title).split('-').filter(Boolean);
  let out = key;
  for (const w of words) { if ((out + '-' + w).length > 48) break; out += '-' + w; }
  return out;
}

/** Texto de la tarea en PM para un ticket. */
const taskText = (i) => `[${i.key}] ${i.title}`.slice(0, 200);
/** La parte del ticket que se guarda dentro de la tarea (lo justo para cerrarlo luego). */
const link = (i) => ({ provider: i.provider, id: i.id, key: i.key, title: i.title, project: i.project, url: i.url, ref: i.ref });
const sameIssue = (a, b) => !!(a && b && a.provider === b.provider && a.id === b.id);

module.exports = { PROVIDERS, ready, fetchAll, complete, logWork, details, startProgress, branchName, taskText, link, sameIssue, adfText };
