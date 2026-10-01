// Resumen del día por proyecto, redactado (no tus peticiones tal cual): para el daily, el "¿Qué hiciste
// ayer?" y el panel. Junta por proyecto el tiempo, lo que le pediste a Claude Code y tus commits.
// La redacción la hace Claude si está disponible (buildPrompt); si no, localSummary escribe uno
// sencillo con plantillas. Lógica pura.
const { classify } = require('./claudestats');

/** Marca de las peticiones de resumen: el diario de Claude las ignora (no son trabajo tuyo). */
const MARK = '[PM Pollito · resumen del día]';

const norm = (s) => String(s || '').trim().toLowerCase();
const fmtMins = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);

/**
 * Agrupa por proyecto (sin distinguir mayúsculas). prompts: { proyecto: [{ text }] } ·
 * commits: [{ repo, subject }] · secs: { proyecto: segundos }. Los de menos de 5 min sin nada más se omiten.
 */
function group({ prompts = {}, commits = [], secs = {} }) {
  const by = new Map();
  const get = (name) => {
    const k = norm(name);
    if (!k || k === 'claude') return null;
    if (!by.has(k)) by.set(k, { project: String(name).trim(), mins: 0, prompts: [], commits: [] });
    return by.get(k);
  };
  for (const [p, list] of Object.entries(prompts)) { const g = get(p); if (g) g.prompts.push(...list.map((x) => String(x.text || x).trim()).filter(Boolean)); }
  for (const c of commits) { const g = get(c.repo); if (g && c.subject) g.commits.push(String(c.subject).trim()); }
  for (const [p, s] of Object.entries(secs)) { const g = get(p); if (g) g.mins += Math.round((Number(s) || 0) / 60); }
  return [...by.values()]
    .filter((g) => g.prompts.length || g.commits.length || g.mins >= 30) // solo tiempo y nada más: si fue un rato largo
    .sort((a, b) => b.mins - a.mins || (b.prompts.length + b.commits.length) - (a.prompts.length + a.commits.length));
}

/** Huella de los datos: si no cambian, se reutiliza el resumen guardado. */
function hashOf(groups) {
  let h = 2166136261;
  for (const c of JSON.stringify(groups.map((g) => [g.project, g.prompts, g.commits, Math.round(g.mins / 15)]))) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Lo que se le pide a Claude: un bloque por proyecto, en primera persona y con sus palabras. */
function buildPrompt(groups, lang = 'es') {
  const data = groups.map((g) => [
    `## ${g.project}${g.mins ? ` (${fmtMins(g.mins)})` : ''}`,
    ...g.prompts.slice(0, 40).map((t) => `- pedido: ${t.slice(0, 300)}`),
    ...g.commits.slice(0, 30).map((t) => `- commit: ${t.slice(0, 200)}`),
  ].join('\n')).join('\n\n');
  if (lang === 'en') {
    return `${MARK}\nBelow is what I worked on, grouped by project: my requests to an AI assistant and my git commits. Write my daily stand-up summary.\nRules:\n- One block per project, same order, EXACT format:\n📁 <project> · <time if given>\n<1-2 short sentences, first person, past tense, describing WHAT I worked on and achieved, in your own words. Do NOT copy or quote the requests. Group related things. No minor technical details.>\n- Max 40 words per project. No intro, no closing, no markdown besides that.\n\n${data}`;
  }
  return `${MARK}\nAbajo está en qué trabajé, agrupado por proyecto: lo que le pedí a un asistente de IA y mis commits. Escribe el resumen para mi daily.\nReglas:\n- Un bloque por proyecto, en el mismo orden, con este formato EXACTO:\n📁 <proyecto> · <tiempo si viene>\n<1 o 2 frases cortas, en primera persona y en pasado, que cuenten EN QUÉ TRABAJÉ y qué logré, con tus palabras. NO copies ni cites los pedidos. Agrupa lo relacionado. Sin detalles técnicos menores.>\n- Máximo 40 palabras por proyecto. Sin introducción ni despedida, sin otro formato.\n\n${data}`;
}

/** Limpia la respuesta de Claude: solo los bloques "📁 proyecto". */
function cleanAi(text) {
  const t = String(text || '').replace(/\r/g, '').replace(/\*\*/g, '').trim();
  const i = t.indexOf('📁');
  return i >= 0 ? t.slice(i).replace(/\n{3,}/g, '\n\n').trim() : '';
}

// ---------- redacción local (sin IA) ----------
const POLITE = /^(?:por\s+favor|porfa|oye|hola|bueno|ok|okay|vale|ahora|también|tambien|y|entonces|luego|después|despues|ya|puedes|podrías|podrias|quiero\s+que|necesito\s+que|me\s+gustaría\s+que|me\s+gustaria\s+que|ayúdame\s+a|ayudame\s+a|vamos\s+a|hay\s+que|tienes\s+que|intenta|trata\s+de)\b[\s,:]*/i;
const VERB = /^(?:revisa|revisar|analiza|analizar|haz|hacer|agrega|agregar|añade|añadir|crea|crear|implementa|implementar|arregla|arreglar|corrige|corregir|cambia|cambiar|mejora|mejorar|aplica|aplicar|actualiza|actualizar|quita|quitar|elimina|eliminar|borra|borrar|pon|poner|genera|generar|genérame|generame|hazme|dame|muestra|mostrar|explica|explicar|documenta|documentar|refactoriza|refactorizar|prueba|probar|verifica|verificar|configura|configurar|integra|integrar|sube|subir|publica|publicar|compila|compilar|diseña|diseñar|ajusta|ajustar|optimiza|optimizar|migra|migrar|investiga|investigar|busca|buscar|lee|leer|escribe|escribir|termina|terminar|continúa|continua|sigue|seguir)(?:me|le|lo|la|los|las|nos)?\b\s*/i;
const ARTICLE = /^(?:el|la|los|las|un|una|unos|unas|que|lo|al|del|de|en|mi|mis|tu|tus|este|esta|estos|estas)\s+/i;
const VAGUE = /^(?:todo|eso|esto|esto?s|lo\s+que|lo\s+mismo|otra\s+vez|de\s+nuevo|sí|si|no|listo|gracias|continúa|continua|sigue|es|son|está|esta|están|hay|tengo|tiene|tenemos|ya|más|mas|qué|que)\b/i;

/** Tema de una petición o commit en pocas palabras ("botón de donación"), o '' si no se entiende. */
function topicOf(text) {
  let t = String(text || '').replace(/^(?:feat|fix|chore|docs|refactor|test|tests|perf|style|build|ci)(?:\([^)]*\))?!?:\s*/i, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i++) { const before = t; t = t.replace(POLITE, '').replace(VERB, '').replace(ARTICLE, ''); if (t === before) break; }
  t = t.split(/[.,;:!?¿¡()\n]|\s(?:y|e|para|porque|pero|que|no|como|cuando|si|con|a\s+ver)\s/i)[0].trim().replace(ARTICLE, '');
  const words = t.split(' ').filter(Boolean);
  if (words.length < 1 || VAGUE.test(t) || /[<>{}=`\\/]|https?:/.test(t)) return '';
  return words.slice(0, 6).join(' ').toLowerCase();
}

/** @type {Array<[string, RegExp]>} */
const EXTRA_KINDS = [
  ['ui', /\b(diseñ\w*|interfaz|ui|ux|css|estilos?|bot[oó]n|pantalla|visual|colores?|animaci\w+|apariencia|layout)\b/i],
  ['build', /\b(compil\w*|ejecutable|instalador|dist|release|publica\w*|deploy\w*|despliega\w*|empaquet\w*|exe)\b/i],
  ['review', /^(?:\W*)(?:revisa|analiza|explica|investiga|qu[eé]|c[oó]mo|por\s+qu[eé]|cu[aá]l|d[oó]nde)\b/i],
];
const QUESTION = /^\W*(?:qu[eé]|c[oó]mo|por\s+qu[eé]|cu[aá]l|d[oó]nde|cu[aá]nto)\b|\?\s*$/i;
const PHRASE = {
  bug: 'corregí errores', feature: 'añadí funcionalidades nuevas', tests: 'trabajé en los tests', refactor: 'reorganicé el código',
  docs: 'actualicé la documentación', deps: 'actualicé dependencias', ui: 'mejoré la interfaz', build: 'preparé el ejecutable',
  review: 'revisé el proyecto', otro: 'avancé en el desarrollo',
};
const kindOf = (t) => { for (const [k, re] of EXTRA_KINDS) if (re.test(t)) return k; return classify(t); };
const joinEs = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} y ${a[a.length - 1]}`);

/** Resumen sencillo con plantillas, por si no hay Claude disponible. */
function localSummary(groups) {
  return groups.map((g) => {
    const items = [...g.prompts, ...g.commits];
    const counts = {};
    for (const t of items) { const k = kindOf(t); counts[k] = (counts[k] || 0) + 1; }
    const kinds = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k]) => k).filter((k, i, a) => k !== 'otro' || a.length === 1).slice(0, 2);
    // Las preguntas no dan tema, y un tema que repite el nombre del proyecto no aporta.
    const topics = [...new Set(items.filter((t) => !QUESTION.test(t)).map(topicOf).filter((t) => t && !t.includes(norm(g.project)) && t.split(' ').length >= 2))].slice(0, 3);
    let body;
    if (!items.length) body = 'Estuve trabajando en el proyecto (sin commits ni peticiones a Claude).';
    else {
      const what = joinEs(kinds.map((k) => PHRASE[k]));
      body = what.charAt(0).toUpperCase() + what.slice(1) + (topics.length ? `, sobre todo en ${joinEs(topics)}` : '') + '.';
      if (g.commits.length) body += ` Dejé ${g.commits.length} commit${g.commits.length === 1 ? '' : 's'}.`;
    }
    return `📁 ${g.project}${g.mins ? ` · ${fmtMins(g.mins)}` : ''}\n${body}`;
  }).join('\n\n');
}

module.exports = { MARK, group, hashOf, buildPrompt, cleanAi, topicOf, localSummary, fmtMins };
