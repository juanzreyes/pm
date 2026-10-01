// El alma del pollito (2.0): lo que lo hace único y vivo.
//  · 🧬 rasgos que salen de cómo trabajas (búho, madrugador, hacker…)
//  · 🌳 linaje: un gallo veterano pone un huevo heredero que hereda rasgo, trucos y especie
//  · 💭 sueños absurdos con tus tareas de ayer · 🌱 huerta que se riega con tareas hechas
//  · 🎪 trucos que se aprenden practicando · 🏖️ vacaciones en vez de "morir" si lo descuidas
//  · 📅 fechas importantes que recuerda · 💌 carta del viernes sobre tu semana
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ---------- 🧬 rasgos ----------
const TRAITS = {
  owl: { emoji: '🦉', name: 'Búho nocturno', desc: 'Trabajas mucho de noche: ojeras y gorro de dormir.', test: (s) => s.work > 3 * 3600 && s.night / s.work > 0.2 },
  early: { emoji: '🌅', name: 'Madrugador', desc: 'Arrancas temprano: cresta brillante.', test: (s) => s.work > 3 * 3600 && s.early / s.work > 0.15 },
  hacker: { emoji: '💻', name: 'Hacker', desc: 'Muchos commits: cresta de hacker.', test: (s) => s.commits >= 30 },
  zen: { emoji: '🧘', name: 'Mente enfocada', desc: 'Casi no te distraes: aura tranquila.', test: (s) => s.work > 15 * 3600 && s.dist / (s.work + s.dist) < 0.08 },
  tomato: { emoji: '🍅', name: 'Tomatero', desc: 'Muchos pomodoros: pin de tomate.', test: (s) => s.pomos >= 25 },
  finisher: { emoji: '🏁', name: 'Rematador', desc: 'Terminas casi todo lo que planeas: banda de campeón.', test: (s) => s.planned >= 20 && s.done / s.planned >= 0.85 },
};

/** Estadísticas de los últimos `n` días para decidir los rasgos. */
function workStats(days, n = 14, now = new Date()) {
  const s = { work: 0, dist: 0, night: 0, early: 0, commits: 0, pomos: 0, planned: 0, done: 0 };
  for (let i = 0; i < n; i++) {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const v = days[keyOf(d)];
    if (!v) continue;
    for (const [h, x] of Object.entries(v.hours || {})) {
      const w = x.w || 0;
      s.work += w;
      s.dist += x.d || 0;
      const hr = Number(h);
      if (hr >= 22 || hr < 4) s.night += w;
      if (hr >= 5 && hr < 8) s.early += w;
    }
    s.commits += v.commits || 0;
    s.pomos += v.pomodoros || 0;
    const t = (v.standup && v.standup.today) || [];
    s.planned += t.length;
    s.done += t.filter((x) => x.done).length;
  }
  return s;
}
function traitsFor(stats) {
  return Object.keys(TRAITS).filter((id) => TRAITS[id].test(stats));
}

// ---------- 💭 sueños ----------
const DREAMS = [
  (t) => `soñé que "${t}" se convertía en un dragón y yo lo derrotaba con un tenedor gigante 🍴🐉`,
  (t) => `soñé que "${t}" era un pastel y todo el equipo se lo comía antes de la demo 🎂`,
  (t) => `soñé que tú y yo hacíamos "${t}" en una nave espacial y Claude era el capitán 🚀`,
  (t) => `soñé que "${t}" me perseguía por un pasillo infinito de pull requests 🏃‍♂️`,
  (t) => `soñé que "${t}" ganaba un concurso de baile y yo era el jurado 💃`,
  (t) => `soñé que "${t}" llovía del cielo en forma de maíz y no paraba de comer 🌽☔`,
  (t) => `soñé que tenía que explicarle "${t}" a una gallina muy seria con corbata 👔🐔`,
];
const NO_TASK_DREAMS = ['soñé que volaba (los pollitos no vuelan, pero en sueños sí) 🕊️', 'soñé con un campo infinito de maíz 🌽', 'soñé que me hacían jefe de proyecto de verdad 🐣💼'];

// ---------- 🌱 huerta ----------
const PLANTS = {
  corn: { name: 'Maíz', stages: ['🌱', '🌿', '🌾', '🌽'], reward: 15 },
  tomato: { name: 'Tomate', stages: ['🌱', '🌿', '🪴', '🍅'], reward: 12 },
  sunflower: { name: 'Girasol', stages: ['🌱', '🌿', '🪴', '🌻'], reward: 10, joy: 10 },
  tulip: { name: 'Tulipán', stages: ['🌱', '🌿', '🪴', '🌷'], reward: 8, joy: 15 },
};
const RIPE = 3;
const POT_PRICE = 40;
const MAX_POTS = 6;

// ---------- 🎪 trucos ----------
const TRICKS = {
  spin: { name: 'Giro', emoji: '🌀', need: 4 },
  salute: { name: 'Saludo militar', emoji: '🫡', need: 4 },
  flip: { name: 'Voltereta', emoji: '🤸', need: 6 },
  moonwalk: { name: 'Moonwalk', emoji: '🕺', need: 7 },
  juggle: { name: 'Malabares', emoji: '🤹', need: 6 },
};
const PRACTICE_PER_DAY = 3;

// ---------- 🏖️ vacaciones ----------
const PLACES = [
  { place: 'la playa', emoji: '🏖️', card: 'El mar es enorme y la arena se mete en las plumas. Te extrañé (un poco) 🌊' },
  { place: 'la montaña', emoji: '🏔️', card: 'Subí hasta arriba con mis patitas. Hace frío y no hay wifi. ¡Qué paz! ⛰️' },
  { place: 'Tokio', emoji: '🗼', card: 'Comí ramen con palillos (bueno, con el pico). Las luces son como tu monitor a las 3 a.m. 🍜' },
  { place: 'la granja de mi primo', emoji: '🚜', card: 'Mi primo tiene 40 gallinas y ninguna sabe usar Jira. Te mandan saludos 🐔' },
  { place: 'el espacio', emoji: '🚀', card: 'Desde aquí arriba tus tareas se ven chiquititas. No te agobies tanto 🌍' },
];
const VACATION_DAYS = 2;
const CALL_BACK_PRICE = 30;

function create(ctx) {
  const S = () => ctx.store.data;
  const P = () => S().pet;
  const todayKey = () => keyOf(new Date());
  const name = () => P().name || 'PM';
  const alerts = () => (S().alerts = S().alerts || {});
  const persona = () => S().settings.personality || 'motivador';
  const save = () => { ctx.store.save(); ctx.broadcast(); };

  // ================= 🧬 RASGOS =================
  function currentTraits() {
    const p = P();
    const ids = new Set(p.traits || []);
    if (p.inherited) ids.add(p.inherited);
    return [...ids].filter((id) => TRAITS[id]);
  }
  function traitTick(force = false) {
    const p = P();
    const k = todayKey();
    if (!force && p.traitsCheckedAt === k) return;
    p.traitsCheckedAt = k;
    const before = new Set(p.traits || []);
    const now = traitsFor(workStats(S().days || {}));
    p.traits = now;
    const fresh = now.filter((id) => !before.has(id) && id !== p.inherited);
    save();
    if (fresh.length && p.name) {
      const t = TRAITS[fresh[0]];
      ctx.say(`${t.emoji} ¡Me salió un rasgo nuevo: ${t.name}! ${t.desc} Me parezco cada vez más a ti 🐣`, 'celebrate', 12000, { cat: 'pet', target: { cmd: 'panel', arg: 'pet#soul-traits' } });
    }
  }

  // ================= 🌳 LINAJE =================
  function legacyState() {
    const p = P();
    const level = ctx.levelInfo(p.xp || 0).level;
    const ageDays = p.born ? (Date.now() - p.born) / 864e5 : 0;
    return {
      generation: p.generation || 1, level, ageDays: Math.floor(ageDays),
      canLay: level >= 10 && ageDays >= 30 && !p.heirEgg && !p.vacation,
      needLevel: 10, needDays: 30, heirEgg: p.heirEgg ? { at: p.heirEgg.at, traits: p.heirEgg.traits } : null,
      lineage: (S().lineage || []).slice().reverse(),
    };
  }
  function layHeirEgg() {
    const p = P();
    if (!legacyState().canLay) return { ok: false, error: 'Aún no: necesita ser gallo (nivel 10) y tener 30 días de vida.' };
    p.heirEgg = { at: Date.now(), traits: currentTraits(), species: p.species || 'chick', skin: (p.equipped || {}).skin || null, tricks: learnedTricks() };
    save();
    ctx.say(`🥚✨ ¡Puse un huevo heredero! Lleva lo mejor de mí: ${p.heirEgg.traits.map((id) => TRAITS[id].emoji).join(' ') || 'mucho cariño'}. Cuando quieras, lo abrimos y me jubilo 🧓🐓`, 'celebrate', 15000, { cat: 'pet', target: { cmd: 'panel', arg: 'pet#soul-family' } });
    return { ok: true };
  }
  /** El heredero sale del huevo: el pollito actual se jubila al árbol genealógico. */
  function hatchHeir(newName) {
    const p = P();
    const egg = p.heirEgg;
    if (!egg) return { ok: false, error: 'No hay huevo heredero.' };
    newName = String(newName || '').trim().slice(0, 24);
    if (!newName) return { ok: false, error: '¿Cómo se va a llamar?' };
    const lineage = S().lineage || (S().lineage = []);
    const id = Date.now().toString(36);
    lineage.push({
      id, name: p.name, generation: p.generation || 1, born: p.born, retiredAt: Date.now(), level: ctx.levelInfo(p.xp || 0).level,
      species: p.species || 'chick', traits: currentTraits(), tricks: learnedTricks(), skin: (p.equipped || {}).skin || null,
    });
    const inherited = egg.traits.length ? pick(egg.traits) : null;
    const tricks = {};
    for (const t of egg.tricks || []) tricks[t] = { progress: TRICKS[t].need, learned: true };
    Object.assign(p, {
      name: newName, born: Date.now(), xp: (p.generation || 1) * 20, happiness: 95, fullness: 90, clean: 100, energy: 100, sick: false,
      generation: (p.generation || 1) + 1, inherited, traits: [], tricks, species: egg.species, heirEgg: null, parent: lineage[lineage.length - 1].name,
    });
    if (egg.skin) p.equipped = { ...(p.equipped || {}), skin: egg.skin };
    save();
    ctx.send('pet:hatch', { emoji: '🐣', rarity: 'epic' });
    ctx.say(`🐣 ¡Hola! Soy ${newName}, generación ${p.generation}. Mi papá ${p.parent} me dejó ${inherited ? `su rasgo ${TRAITS[inherited].emoji} ${TRAITS[inherited].name}` : 'su cariño'}${egg.tricks.length ? ` y sé ${egg.tricks.length} truco${egg.tricks.length === 1 ? '' : 's'}` : ''} 💛`, 'hatch', 15000, { cat: 'pet' });
    return { ok: true };
  }

  // ================= 💭 SUEÑOS =================
  async function dream(force = false) {
    const k = todayKey();
    const dreams = S().petDreams || (S().petDreams = {});
    if (dreams[k] && !force) return dreams[k];
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yd = (S().days || {})[keyOf(y)];
    const tasks = ((yd && yd.standup && yd.standup.today) || []).map((t) => t.text.replace(/^\[[^\]]+\]\s*/, '')).filter(Boolean);
    let text = tasks.length ? `Anoche ${pick(DREAMS)(pick(tasks).slice(0, 50))}` : `Anoche ${pick(NO_TASK_DREAMS)}`;
    if (tasks.length && ctx.aiAvailable()) {
      try {
        text = await ctx.ai().polish(tasks.slice(0, 6).join('\n'), `Eres ${name()}, un pollito tamagotchi. Cuenta en 1 o 2 frases (máx. 45 palabras), en primera persona y empezando por "Anoche soñé", un sueño absurdo, tierno y gracioso que mezcle una o dos de estas tareas reales de tu humano. Sin comillas.`);
      } catch { /* plantilla */ }
    }
    dreams[k] = { text: String(text).slice(0, 400), at: Date.now() };
    for (const old of Object.keys(dreams).sort().slice(0, -30)) delete dreams[old];
    save();
    return dreams[k];
  }
  function dreamTick() {
    const h = new Date().getHours();
    if (h < 7 || h >= 12 || !P().name || P().vacation) return;
    if ((S().petDreams || {})[todayKey()]) return;
    // Solo si durmió (PM llevaba abierto desde anoche o lo abriste hoy por la mañana).
    dream().then((d) => {
      if (d && !ctx.isMuted()) ctx.say(`💭 ${d.text}`, 'yawn', 14000, { cat: 'pet', target: { cmd: 'panel', arg: 'pet#soul-dreams' } });
    });
  }

  // ================= 🌱 HUERTA =================
  function garden() {
    const p = P();
    if (!p.garden) p.garden = { pots: [{ plant: 'corn', growth: 0 }, { plant: 'sunflower', growth: 0 }, { plant: 'tomato', growth: 0 }], lastWater: Date.now() };
    return p.garden;
  }
  function water() {
    const g = garden();
    const pots = g.pots.filter((x) => x.growth < RIPE || x.wilted);
    if (!pots.length) return null;
    const pot = pots.find((x) => x.wilted) || pots.reduce((a, b) => (b.growth < a.growth ? b : a));
    if (pot.wilted) pot.wilted = false; // revive antes de crecer
    else pot.growth += 1;
    g.lastWater = Date.now();
    return pot;
  }
  function harvest(i) {
    const g = garden();
    const pot = g.pots[i];
    if (!pot || pot.growth < RIPE || pot.wilted) return { ok: false, error: 'Aún no está lista' };
    const pl = PLANTS[pot.plant];
    const p = P();
    p.coins = (p.coins || 0) + pl.reward;
    if (pl.joy) p.happiness = clamp((p.happiness || 0) + pl.joy);
    pot.growth = 0;
    p.harvests = (p.harvests || 0) + 1;
    save();
    ctx.say(`🧺 ¡Cosechamos ${pl.stages[RIPE]} ${pl.name}! +${pl.reward} 🌽${pl.joy ? ' y estoy más feliz 💛' : ''}`, 'celebrate', 7000, { log: false });
    return { ok: true };
  }
  function plant(i, kind) {
    const pot = garden().pots[i];
    if (!pot || !PLANTS[kind]) return { ok: false };
    if (pot.growth > 0 && pot.plant !== kind) return { ok: false, error: 'Cosecha antes de cambiar la semilla' };
    pot.plant = kind;
    save();
    return { ok: true };
  }
  function buyPot() {
    const g = garden();
    const p = P();
    if (g.pots.length >= MAX_POTS) return { ok: false, error: 'La huerta está llena' };
    if ((p.coins || 0) < POT_PRICE) return { ok: false, error: `Te faltan ${POT_PRICE - Math.floor(p.coins || 0)} 🌽` };
    p.coins -= POT_PRICE;
    g.pots.push({ plant: 'corn', growth: 0 });
    save();
    return { ok: true };
  }
  /** Las plantas se marchitan tras 2 días laborables sin tareas hechas. */
  function wiltTick() {
    const g = garden();
    let workdays = 0;
    const d = new Date(g.lastWater || Date.now());
    const now = new Date();
    while (d < now) { d.setDate(d.getDate() + 1); if (d <= now && d.getDay() !== 0 && d.getDay() !== 6) workdays++; }
    if (workdays < 2) return;
    let changed = false;
    for (const pot of g.pots) if (pot.growth > 0 && !pot.wilted) { pot.wilted = true; changed = true; }
    if (changed) {
      save();
      if (P().name && !ctx.isMuted()) ctx.say('🥀 Mi huerta se está marchitando… completa una tarea para regarla 💧', 'sad', 9000, { cat: 'pet', target: { cmd: 'panel', arg: 'pet#soul-garden' } });
    }
  }

  // ================= 🎪 TRUCOS =================
  const tricksOf = () => (P().tricks = P().tricks || {});
  const learnedTricks = () => Object.keys(TRICKS).filter((id) => (tricksOf()[id] || {}).learned);
  function practicesToday() {
    const p = P();
    return p.practiceDay === todayKey() ? p.practiceCount || 0 : 0;
  }
  function practice(id) {
    const t = TRICKS[id];
    if (!t) return { ok: false };
    const p = P();
    if (p.vacation) return { ok: false, error: 'Estoy de vacaciones 🏖️' };
    if (practicesToday() >= PRACTICE_PER_DAY) return { ok: false, error: `Ya practicamos ${PRACTICE_PER_DAY} veces hoy. Mañana más 😪` };
    if ((p.energy ?? 100) < 15) return { ok: false, error: 'Estoy muy cansado para practicar 😴' };
    const st = tricksOf()[id] || (tricksOf()[id] = { progress: 0, learned: false });
    if (st.learned) { perform(id); return { ok: true, learned: true }; }
    p.practiceDay = todayKey();
    p.practiceCount = practicesToday() + 1;
    p.energy = clamp((p.energy ?? 100) - 5);
    st.progress = Math.min(t.need, st.progress + 1);
    ctx.send('pet:anim', 'trick-' + id); // lo intenta (aunque aún le sale regular)
    if (st.progress >= t.need) {
      st.learned = true;
      ctx.addXp(5);
      ctx.say(`${t.emoji} ¡Aprendí ${t.name}! Lo haré cuando termines algo grande 🎉`, 'celebrate', 8000, { cat: 'pet' });
    }
    save();
    return { ok: true, learned: st.learned };
  }
  function perform(id) {
    const list = learnedTricks();
    const t = id && list.includes(id) ? id : pick(list);
    if (!t) return false;
    ctx.send('pet:anim', 'trick-' + t);
    return true;
  }

  // ================= 🏖️ VACACIONES =================
  function vacationTick() {
    const p = P();
    if (!p.name) return;
    if (p.vacation) {
      if (Date.now() >= p.vacation.until) comeBack(false);
      return;
    }
    const neglected = (p.fullness ?? 100) <= 5 && (p.happiness ?? 100) <= 10;
    if (!neglected) { if (p.neglectedSince) { delete p.neglectedSince; save(); } return; }
    if (!p.neglectedSince) { p.neglectedSince = Date.now(); save(); return; }
    if (Date.now() - p.neglectedSince < 24 * 3600e3) return;
    const v = pick(PLACES);
    p.vacation = { ...v, since: Date.now(), until: Date.now() + VACATION_DAYS * 864e5 };
    delete p.neglectedSince;
    save();
    const back = new Date(p.vacation.until).toLocaleDateString('es', { weekday: 'long' });
    ctx.say(`✈️ Me sentía solito y con hambre… así que me fui de vacaciones a ${v.place} ${v.emoji}. Vuelvo el ${back}. ¡No me olvides! 💛`, 'sad', 20000, { cat: 'pet', actions: [{ label: `📞 Pedirle que vuelva (${CALL_BACK_PRICE} 🌽)`, cmd: 'soul.callback' }] });
  }
  function comeBack(paid) {
    const p = P();
    const v = p.vacation;
    if (!v) return { ok: false };
    if (paid) {
      if ((p.coins || 0) < CALL_BACK_PRICE) return { ok: false, error: `Te faltan ${CALL_BACK_PRICE - Math.floor(p.coins || 0)} 🌽` };
      p.coins -= CALL_BACK_PRICE;
    }
    Object.assign(p, { vacation: null, fullness: 75, happiness: 80, clean: 100, energy: 100, sick: false, lastTick: Date.now() });
    const postcards = p.postcards || (p.postcards = []);
    postcards.push({ place: v.place, emoji: v.emoji, text: v.card, at: Date.now() });
    if (postcards.length > 20) postcards.shift();
    save();
    ctx.say(`📮 ¡Volví de ${v.place}! ${v.emoji} Te traje una postal: "${v.card}"`, 'celebrate', 15000, { cat: 'pet', target: { cmd: 'panel', arg: 'pet#soul-postcards' } });
    return { ok: true };
  }

  // ================= 📅 FECHAS IMPORTANTES =================
  const dates = () => (S().petDates = S().petDates || []);
  function addDate({ label, date, kind }) {
    label = String(label || '').trim().slice(0, 80);
    const m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!label || !m) return { ok: false, error: 'Pon qué es y la fecha' };
    const k = ['birthday', 'deadline', 'other'].includes(kind) ? kind : 'other';
    dates().push({ id: Date.now().toString(36), label, kind: k, month: Number(m[2]), day: Number(m[3]), year: k === 'deadline' ? Number(m[1]) : null });
    save();
    ctx.say(k === 'birthday' ? `🎂 Apuntado: el ${Number(m[3])} de ${MONTHS[Number(m[2]) - 1]} es el cumpleaños de ${label}. ¡No se me olvida!` : `📅 Apuntado: ${label}, el ${Number(m[3])} de ${MONTHS[Number(m[2]) - 1]}.`, 'peck', 7000, { log: false });
    return { ok: true };
  }
  function removeDate(id) {
    S().petDates = dates().filter((d) => d.id !== id);
    (S().tombstones = S().tombstones || {})[id] = Date.now();
    save();
    return { ok: true };
  }
  /** Días que faltan para la próxima vez (los cumpleaños se repiten cada año). */
  function daysUntil(d, now = new Date()) {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    let t = new Date(d.year || today.getFullYear(), d.month - 1, d.day);
    if (!d.year && t < today) t = new Date(today.getFullYear() + 1, d.month - 1, d.day);
    return Math.round((t.getTime() - today.getTime()) / 864e5);
  }
  function datesTick() {
    if (new Date().getHours() < 8 || !P().name) return;
    const y = new Date().getFullYear();
    for (const d of dates()) {
      const n = daysUntil(d);
      const warn = d.kind === 'deadline' ? [3, 1, 0] : [1, 0];
      if (!warn.includes(n)) continue;
      const k = `date|${d.id}|${y}|${n}`;
      if (alerts()[k]) continue;
      alerts()[k] = [1];
      ctx.store.save();
      const msg = d.kind === 'birthday'
        ? (n === 0 ? `🎂 ¡Hoy es el cumpleaños de ${d.label}! ¿Le escribes? 🎉` : `🎁 Mañana es el cumpleaños de ${d.label}. ¿Ya tienes algo pensado?`)
        : d.kind === 'deadline'
          ? (n === 0 ? `🏁 Hoy es el día: ${d.label}. ¡Tú puedes! 💪` : `⏳ Faltan ${n} día${n === 1 ? '' : 's'} para: ${d.label}`)
          : (n === 0 ? `📅 Hoy: ${d.label}` : `📅 Mañana: ${d.label}`);
      ctx.say(msg, n === 0 ? 'celebrate' : 'alert', 15000, { cat: 'reminder' });
    }
  }

  // ================= 💌 CARTA DEL VIERNES =================
  function weekKey(d = new Date()) {
    const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return keyOf(x);
  }
  function weekFacts() {
    const s = workStats(S().days || {}, 7);
    const projects = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      for (const [pr, sec] of Object.entries(((S().days || {})[keyOf(d)] || {}).projects || {})) projects[pr] = (projects[pr] || 0) + sec;
    }
    const top = Object.entries(projects).sort((a, b) => b[1] - a[1])[0];
    return { hours: Math.round(s.work / 360) / 10, done: s.done, planned: s.planned, pomos: s.pomos, commits: s.commits, top: top ? top[0] : null, distPct: s.work + s.dist ? Math.round((s.dist / (s.work + s.dist)) * 100) : 0 };
  }
  function letterTemplate(f) {
    const n = name();
    const open = { motivador: 'Querido humano:', sarcastico: 'Estimado humano (sí, tú):', zen: 'Querido amigo:', sargento: '¡ATENCIÓN, RECLUTA!' }[persona()] || 'Querido humano:';
    const L = [open];
    if (!f.hours && !f.done) L.push('Esta semana casi no te vi. Espero que estés descansando de verdad. Yo cuidé el escritorio 🐣.');
    else {
      L.push(`Esta semana trabajamos ${f.hours} horas${f.top ? `, sobre todo en ${f.top}` : ''}, y terminaste ${f.done} de ${f.planned} tareas.`);
      if (f.pomos) L.push(`Hicimos ${f.pomos} pomodoros juntos 🍅.`);
      if (f.commits) L.push(`Guardaste ${f.commits} commits: tu código y yo te lo agradecemos 📦.`);
      if (f.distPct > 25) L.push(`Te distrajiste bastante (${f.distPct}%). No pasa nada: la semana que viene, un poquito menos 😉.`);
      else L.push('Te concentraste muy bien. Estoy orgulloso 🥹.');
    }
    L.push({ motivador: 'Descansa este finde, te lo ganaste 💛', sarcastico: 'Ahora descansa, que el lunes vuelve. Siempre vuelve 🙃', zen: 'Que el descanso te encuentre en paz 🍃', sargento: '¡DESCANSO AUTORIZADO HASTA EL LUNES 0800! 🫡' }[persona()] || 'Descansa este finde 💛');
    L.push(`— ${n} 🐣`);
    return L.join('\n');
  }
  async function writeLetter(force = false) {
    const k = weekKey();
    const letters = S().petLetters || (S().petLetters = {});
    if (letters[k] && !force) return letters[k];
    const f = weekFacts();
    let text = letterTemplate(f);
    if (ctx.aiAvailable()) {
      try {
        text = await ctx.ai().polish(JSON.stringify(f), `Eres ${name()}, un pollito tamagotchi que hace de PM. ${ctx.aiTone ? ctx.aiTone() : ''} Escribe una carta corta (70-120 palabras) a tu humano sobre su semana con estos datos reales: empieza con un saludo, reconoce algo concreto, da un consejo amable para la semana que viene y firma "— ${name()} 🐣".`);
      } catch { /* plantilla */ }
    }
    letters[k] = { text: String(text).slice(0, 1500), at: Date.now() };
    for (const old of Object.keys(letters).sort().slice(0, -26)) delete letters[old];
    save();
    return letters[k];
  }
  function letterTick() {
    const now = new Date();
    if (now.getDay() !== 5 || !P().name) return;
    const [eh, em] = String(S().settings.eveningTime || '16:30').split(':').map(Number);
    if (now.getHours() * 60 + now.getMinutes() < eh * 60 + (em || 0)) return;
    if ((S().petLetters || {})[weekKey()]) return;
    writeLetter().then(() => {
      if (!ctx.isMuted()) ctx.say('💌 Te escribí una carta sobre tu semana. ¿La lees?', 'love', 15000, { cat: 'pet', target: { cmd: 'panel', arg: 'pet#soul-letters' }, actions: [{ label: '💌 Leer', cmd: 'panel', arg: 'pet#soul-letters' }] });
    });
  }

  // ================= EVENTOS =================
  /** Una tarea completada: riega la huerta y, si es la última del día, un truco. */
  function onTaskDone(t, allDone) {
    if (P().vacation) return;
    const pot = water();
    if (pot && pot.growth === RIPE && !pot.wilted) {
      const pl = PLANTS[pot.plant];
      ctx.say(`${pl.stages[RIPE]} ¡Tu ${pl.name.toLowerCase()} está lista para cosechar!`, 'celebrate', 7000, { log: false, target: { cmd: 'panel', arg: 'pet#soul-garden' } });
    }
    if (allDone || (t && (t.est >= 60 || t.issue))) setTimeout(() => perform(), 2500);
    save();
  }

  function snapshot() {
    const p = P();
    const g = garden();
    return {
      soul: {
        traits: currentTraits().map((id) => ({ id, emoji: TRAITS[id].emoji, name: TRAITS[id].name, desc: TRAITS[id].desc, inherited: id === p.inherited })),
        allTraits: Object.entries(TRAITS).map(([id, t]) => ({ id, emoji: t.emoji, name: t.name, desc: t.desc })),
        legacy: legacyState(),
        dreams: Object.entries(S().petDreams || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 7).map(([day, v]) => ({ day, ...v })),
        garden: { pots: g.pots.map((x) => ({ ...x, emoji: x.wilted ? '🥀' : PLANTS[x.plant].stages[Math.min(RIPE, x.growth)], name: PLANTS[x.plant].name, ripe: x.growth >= RIPE && !x.wilted })), canBuy: g.pots.length < MAX_POTS, potPrice: POT_PRICE, plants: Object.entries(PLANTS).map(([id, v]) => ({ id, name: v.name, emoji: v.stages[RIPE] })), harvests: p.harvests || 0 },
        tricks: Object.entries(TRICKS).map(([id, t]) => ({ id, name: t.name, emoji: t.emoji, need: t.need, progress: (tricksOf()[id] || {}).progress || 0, learned: !!(tricksOf()[id] || {}).learned })),
        practiceLeft: PRACTICE_PER_DAY - practicesToday(),
        vacation: p.vacation ? { place: p.vacation.place, emoji: p.vacation.emoji, until: p.vacation.until, price: CALL_BACK_PRICE } : null,
        postcards: (p.postcards || []).slice().reverse(),
        dates: dates().map((d) => ({ ...d, inDays: daysUntil(d) })).sort((a, b) => a.inDays - b.inDays),
        letters: Object.entries(S().petLetters || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 8).map(([week, v]) => ({ week, ...v })),
      },
    };
  }

  /** Acciones desde el panel (lista cerrada). */
  function act(action, arg) {
    switch (action) {
      case 'practice': return practice(String(arg));
      case 'perform': return { ok: perform(String(arg)) };
      case 'plant': return plant(Number(arg.i), String(arg.kind));
      case 'harvest': return harvest(Number(arg));
      case 'buyPot': return buyPot();
      case 'layEgg': return layHeirEgg();
      case 'hatchHeir': return hatchHeir(arg);
      case 'addDate': return addDate(arg || {});
      case 'removeDate': return removeDate(String(arg));
      case 'callBack': return comeBack(true);
      case 'letter': return writeLetter(true).then(() => ({ ok: true }));
      case 'dream': return dream(true).then(() => ({ ok: true }));
      case 'traits': traitTick(true); return { ok: true };
      default: return { ok: false, error: 'Acción desconocida' };
    }
  }

  function tick() {
    try { traitTick(); vacationTick(); dreamTick(); datesTick(); letterTick(); wiltTick(); } catch (e) { if (ctx.log) ctx.log(e); }
  }
  function start() {
    setTimeout(tick, 20000);
    setInterval(tick, 10 * 60e3);
  }

  return { start, tick, snapshot, act, onTaskDone, perform, traitTick, vacationTick, comeBack, dream, writeLetter, daysUntil, isAway: () => !!P().vacation };
}

module.exports = { create, TRAITS, PLANTS, TRICKS, PLACES, workStats, traitsFor };
