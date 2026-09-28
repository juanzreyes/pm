// Vigila los PR que abrió Claude desde la cola: estado (abierto, mezclado, cerrado), CI de su
// último commit (con el log de lo que falló) y revisiones que piden cambios.
// Solo lectura contra la API de GitHub. `http` (fetch) se inyecta en los tests.

async function gh(http, token, url, accept = 'application/vnd.github+json') {
  const res = await http(url, { headers: { Authorization: `Bearer ${token}`, Accept: accept, 'User-Agent': 'PM-Pollito' } });
  if (!res.ok) throw Object.assign(new Error(`GitHub respondió ${res.status}`), { status: res.status });
  return accept.includes('json') ? res.json() : res.text();
}

/** owner/repo/número desde la URL del PR. */
function parsePrUrl(url) {
  const m = String(url || '').match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

const FAILED = new Set(['failure', 'timed_out', 'action_required', 'startup_failure']);

/**
 * Estado del PR: { state: 'open'|'merged'|'closed', sha, checks: { total, pending, passed, failed: [...] }, changesRequested: [...] }.
 * changesRequested: revisiones con "Request changes", cada una con sus comentarios en el código.
 */
async function status({ owner, repo, number, token }, http = fetch) {
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const pr = await gh(http, token, `${base}/pulls/${number}`);
  const state = pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open';
  const sha = pr.head && pr.head.sha;
  const out = { state, sha, title: pr.title, checks: { total: 0, pending: 0, passed: 0, failed: [] }, changesRequested: [] };
  if (state !== 'open') return out;
  const cr = await gh(http, token, `${base}/commits/${sha}/check-runs?per_page=100`);
  for (const c of cr.check_runs || []) {
    out.checks.total++;
    if (c.status !== 'completed') out.checks.pending++;
    else if (FAILED.has(c.conclusion)) out.checks.failed.push({ id: c.id, name: c.name, app: c.app && c.app.slug, summary: [c.output && c.output.title, c.output && c.output.summary].filter(Boolean).join(' — ').slice(0, 1500), url: c.html_url || c.details_url });
    else out.checks.passed++;
  }
  const reviews = await gh(http, token, `${base}/pulls/${number}/reviews?per_page=100`);
  const changes = (reviews || []).filter((r) => r.state === 'CHANGES_REQUESTED');
  if (changes.length) {
    const comments = await gh(http, token, `${base}/pulls/${number}/comments?per_page=100`);
    for (const r of changes) {
      out.changesRequested.push({
        id: r.id, user: (r.user && r.user.login) || '', body: String(r.body || '').trim(),
        comments: (comments || []).filter((c) => c.pull_request_review_id === r.id).map((c) => ({ path: c.path, line: c.line || c.original_line || null, body: String(c.body || '').trim() })),
      });
    }
  }
  return out;
}

/** Final del log de un check fallido (GitHub Actions); si no hay log, su resumen. */
async function failureLog({ owner, repo, token }, check, http = fetch, lines = 120) {
  if (check.app === 'github-actions') {
    try {
      const text = await gh(http, token, `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${check.id}/logs`, 'application/vnd.github.v3.raw');
      // Sin la marca de tiempo de cada línea de Actions.
      return text.split('\n').map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, '')).filter((l) => l.trim()).slice(-lines).join('\n');
    } catch { /* sin permiso para los logs: usamos el resumen */ }
  }
  return check.summary || '(sin detalles)';
}

/** Petición para Claude: arreglar el CI del PR. */
function ciPrompt(pr, logs) {
  return [
    `El CI falló en el pull request "${pr.title}" de esta rama.`,
    ...logs.map((l) => `\n### ${l.name}\n\`\`\`\n${l.log}\n\`\`\``),
    '\nArregla la causa en el código (no desactives ni saltes tests). Si el fallo no tiene que ver con estos cambios, explícalo y no toques nada.',
  ].join('\n').slice(0, 12000);
}

/** Petición para Claude: aplicar los cambios pedidos en la revisión. */
function reviewPrompt(pr, reviews) {
  const L = [`En la revisión del pull request "${pr.title}" pidieron cambios:`];
  for (const r of reviews) {
    L.push(`\n### ${r.user || 'Revisor'}`);
    if (r.body) L.push(r.body);
    for (const c of r.comments) L.push(`- ${c.path}${c.line ? `:${c.line}` : ''}: ${c.body}`);
  }
  L.push('\nAplica lo que piden en esta rama. Si algo no está claro o no estás de acuerdo, haz lo razonable y explícalo al final.');
  return L.join('\n').slice(0, 12000);
}

module.exports = { parsePrUrl, status, failureLog, ciPrompt, reviewPrompt };
