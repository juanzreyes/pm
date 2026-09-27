// GitHub: PRs que esperan tu revisión y el estado (CI, comentarios) de tus PRs abiertos.
// Usa un token personal de GitHub (solo lectura) que se guarda cifrado en tu PC.
const QUERY = `query {
  viewer {
    login
    pullRequests(first: 25, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number title url isDraft reviewDecision
        repository { nameWithOwner }
        comments { totalCount }
        reviews { totalCount }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
  search(query: "is:open is:pr review-requested:@me archived:false", type: ISSUE, first: 25) {
    nodes { ... on PullRequest { number title url repository { nameWithOwner } author { login } } }
  }
}`;

async function fetchPRs(token) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'pm-pollito' },
    body: JSON.stringify({ query: QUERY }),
  });
  if (res.status === 401) throw new Error('El token de GitHub no es válido o caducó.');
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) throw new Error((json.errors && json.errors[0] && json.errors[0].message) || `GitHub respondió ${res.status}`);
  const v = json.data.viewer;
  const mine = (v.pullRequests.nodes || []).map((p) => {
    const c = p.commits.nodes[0];
    return {
      id: `${p.repository.nameWithOwner}#${p.number}`,
      title: p.title,
      url: p.url,
      repo: p.repository.nameWithOwner,
      draft: p.isDraft,
      ci: (c && c.commit.statusCheckRollup && c.commit.statusCheckRollup.state) || null, // SUCCESS | FAILURE | PENDING | ERROR
      review: p.reviewDecision, // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED
      activity: p.comments.totalCount + p.reviews.totalCount,
    };
  });
  const toReview = (json.data.search.nodes || []).filter((p) => p && p.url).map((p) => ({
    id: `${p.repository.nameWithOwner}#${p.number}`,
    title: p.title,
    url: p.url,
    repo: p.repository.nameWithOwner,
    author: p.author ? p.author.login : '',
  }));
  return { login: v.login, mine, toReview };
}

/** Compara con la lectura anterior y devuelve avisos nuevos. */
function diff(prev, next) {
  const notes = [];
  if (!prev) return notes;
  const known = new Set(prev.toReview.map((p) => p.id));
  for (const p of next.toReview) if (!known.has(p.id)) notes.push({ text: `👀 ${p.author || 'Alguien'} te pidió revisar "${p.title}" (${p.repo})`, anim: 'alert', url: p.url });
  const old = Object.fromEntries(prev.mine.map((p) => [p.id, p]));
  for (const p of next.mine) {
    const o = old[p.id];
    if (!o) continue;
    if ((p.ci === 'FAILURE' || p.ci === 'ERROR') && o.ci !== p.ci) notes.push({ text: `❌ Falló el CI de tu PR "${p.title}" 😱`, anim: 'alarm', url: p.url });
    if (p.ci === 'SUCCESS' && o.ci && o.ci !== 'SUCCESS') notes.push({ text: `✅ El CI de "${p.title}" pasó en verde 🎉`, anim: 'celebrate', url: p.url });
    if (p.review === 'APPROVED' && o.review !== 'APPROVED') notes.push({ text: `🎉 ¡Aprobaron tu PR "${p.title}"!`, anim: 'celebrate', url: p.url });
    if (p.review === 'CHANGES_REQUESTED' && o.review !== 'CHANGES_REQUESTED') notes.push({ text: `✏️ Te pidieron cambios en "${p.title}"`, anim: 'sad', url: p.url });
    else if (p.activity > o.activity) notes.push({ text: `💬 Nuevo comentario en tu PR "${p.title}"`, anim: 'flap', url: p.url });
  }
  return notes;
}

module.exports = { fetchPRs, diff };
