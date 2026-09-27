// Vida del pollito:
//  · 🏡 casita decorable · 🥚 huevos coleccionables · 📜 diario del pollito
//  · 🎭 personalidades · 🎵 modo música
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---------- 🏡 muebles de la casita (x, y en % dentro de la habitación) ----------
const HOME = [
  { id: 'rug', emoji: '🟫', name: 'Alfombra', price: 60, x: 50, y: 88, z: 0, cls: 'rug' },
  { id: 'window', emoji: '🪟', name: 'Ventana', price: 90, x: 22, y: 26, z: 1 },
  { id: 'frame', emoji: '🖼️', name: 'Cuadro', price: 70, x: 52, y: 22, z: 1 },
  { id: 'clock', emoji: '🕰️', name: 'Reloj de pared', price: 60, x: 78, y: 20, z: 1 },
  { id: 'plant', emoji: '🪴', name: 'Planta', price: 60, x: 8, y: 70, z: 2 },
  { id: 'lamp', emoji: '💡', name: 'Lámpara', price: 80, x: 92, y: 50, z: 2 },
  { id: 'bed', emoji: '🛏️', name: 'Camita', price: 150, x: 80, y: 74, z: 2 },
  { id: 'desk', emoji: '🖥️', name: 'Escritorio de PM', price: 160, x: 22, y: 70, z: 2 },
  { id: 'shelf', emoji: '📚', name: 'Estantería', price: 120, x: 38, y: 48, z: 1 },
  { id: 'sofa', emoji: '🛋️', name: 'Sofá', price: 170, x: 60, y: 76, z: 2 },
  { id: 'radio', emoji: '📻', name: 'Radio', price: 90, x: 92, y: 80, z: 3 },
  { id: 'teddy', emoji: '🧸', name: 'Peluche', price: 50, x: 70, y: 86, z: 3 },
  { id: 'trophy', emoji: '🏆', name: 'Vitrina de trofeos', price: 0, x: 64, y: 46, z: 1, needAchievements: 5 },
];

// ---------- 🥚 coleccionables ----------
const POOL = {
  common: ['🐸', '🐢', '🐌', '🐝', '🐞', '🦋', '🐠', '🐹', '🐰', '🦔'],
  rare: ['🦊', '🐼', '🐨', '🦉', '🦜', '🐙', '🦥', '🦩'],
  epic: ['🦄', '🐉', '🦖', '🦕', '🐳'],
};
const RARITY = { common: 'común', rare: 'rara', epic: 'épica' };
const EGG_EVERY = 4; // pomodoros para conseguir un huevo
const EGG_NEED = 3; // pomodoros para que eclosione

// ---------- 🎭 personalidades ----------
const PERSONAS = {
  motivador: {
    name: 'Motivador', emoji: '🥳',
    ai: 'Tu personalidad: motivador y cariñoso, celebras cada avance.',
    scold: null, // usa los regaños de siempre
    back: null,
    praise: ['¡Bien hecho! 🎉', '¡Eres una máquina! 💪', '¡Una menos! ✨'],
    chatter: ['¡Tú puedes con todo hoy! ✨', 'Estoy orgulloso de ti 🥹', 'Paso a paso se llega lejos 🐾'],
  },
  sarcastico: {
    name: 'Sarcástico', emoji: '😏',
    ai: 'Tu personalidad: sarcástico y con humor seco (nunca cruel), ironía ligera sobre la procrastinación.',
    scold: (label, min, level) => pick(level <= 1
      ? [`Ah, sí, ${label}. Justo lo que pedía tu jefe. ${min} min 🙃`, `${min} min en ${label}. Seguro que es "investigación" 😏`]
      : [`${min} min en ${label}. Impresionante. Si fuera un trabajo, ya estarías ascendido 🙄`, `Voy a pedir que ${label} te pague el sueldo. ${min} minutos 😒`]),
    back: ['Mira quién volvió a trabajar. Milagro 🙃', 'Oh, código. Qué novedad 😏'],
    praise: ['Vaya, una tarea hecha. Llamaré a la prensa 📰', 'No está mal… para un humano 😏', 'Increíble. De verdad. Casi 🙃'],
    chatter: ['¿Otra vez con eso? Qué emoción 😐', 'Estoy aquí. Mirando. Como siempre 👀', 'Tus tareas no se hacen solas. Lo comprobé 😏'],
  },
  zen: {
    name: 'Zen', emoji: '🧘',
    ai: 'Tu personalidad: zen y calmado, hablas con serenidad, recuerdas respirar y no juzgas.',
    scold: (label, min) => pick([`🍃 Llevas ${min} min en ${label}. Respira… y vuelve con suavidad a lo importante.`, `🌊 La mente se fue a ${label} ${min} min. Obsérvalo sin juzgar, y regresa.`]),
    back: ['🍃 Bienvenido de vuelta al presente.', '🌸 Un paso, una tarea. Así.'],
    praise: ['🌸 Una tarea menos, un poco más de calma.', '🍃 Bien hecho. Respira y celebra.', '☯️ Hecho está.'],
    chatter: ['🍃 Inhala 4, exhala 6.', '🌊 No hay prisa que valga tu calma.', '🌸 Hoy basta con hacerlo lo mejor posible.'],
  },
  sargento: {
    name: 'Sargento', emoji: '🪖',
    ai: 'Tu personalidad: sargento militar exigente y teatral (divertido, nunca ofensivo), frases cortas en mayúsculas de vez en cuando.',
    scold: (label, min, level) => pick(level <= 1
      ? [`¡SOLDADO! ¡${min} MINUTOS EN ${label.toUpperCase()}! ¡A SU PUESTO! 🪖`, `¿${label}? ¡NEGATIVO! ¡Vuelva a la misión! 🫡`]
      : [`¡${min} MINUTOS! ¡${label.toUpperCase()} NO ES UNA MISIÓN! ¡20 FLEXIONES Y A TRABAJAR! 💢🪖`, `¡INACEPTABLE, RECLUTA! ¡${min} min de ${label}! 📢`]),
    back: ['¡ASÍ SE HACE, SOLDADO! 🫡', '¡De vuelta a la trinchera! 🪖'],
    praise: ['¡MISIÓN CUMPLIDA! 🫡', '¡OBJETIVO ABATIDO! 🎯', '¡Excelente, recluta! Siguiente. 🪖'],
    chatter: ['¡Nada de descansos no autorizados! 🪖', '¡Hidratación, soldado! 💧', '¡El enemigo es la procrastinación! 📢'],
  },
};

function create(ctx) {
  const S = () => ctx.store.data;
  const P = () => S().pet;
  const persona = () => PERSONAS[S().settings.personality] || PERSONAS.motivador;

  // ================= 🎭 PERSONALIDAD =================
  function scold(label, minutes, level) {
    const p = persona();
    return p.scold ? p.scold(label, minutes, level) : null;
  }
  const backToWork = () => (persona().back ? pick(persona().back) : null);
  const praise = () => pick(persona().praise);
  const chatter = () => pick(persona().chatter);
  const aiTone = () => persona().ai;

  // ================= 🏡 CASITA =================
  function homeView() {
    const owned = new Set(P().home || []);
    const ach = (P().achievements || []).length;
    return HOME.map((h) => ({
      ...h,
      owned: owned.has(h.id) || (h.needAchievements && ach >= h.needAchievements),
      locked: !!(h.needAchievements && ach < h.needAchievements),
      need: h.needAchievements || 0,
    }));
  }
  function buyHome(id) {
    const item = HOME.find((h) => h.id === id);
    const p = P();
    if (!item) return { ok: false, error: 'Ese mueble no existe.' };
    p.home = p.home || [];
    if (p.home.includes(id)) return { ok: true };
    if (item.needAchievements) return { ok: false, error: `Se desbloquea con ${item.needAchievements} logros 🏅` };
    if ((p.coins || 0) < item.price) return { ok: false, error: `Te faltan ${item.price - Math.floor(p.coins || 0)} 🌽` };
    p.coins -= item.price;
    p.home.push(id);
    p.happiness = Math.min(100, (p.happiness || 0) + 8);
    ctx.store.save();
    ctx.say(`🏡 ¡${item.name} nuevo${/a$/.test(item.name) ? 'a' : ''} para mi casita! ${item.emoji} Gracias 💛`, 'celebrate', 7000, { log: false });
    ctx.broadcast();
    return { ok: true };
  }

  // ================= 🥚 HUEVOS Y COLECCIÓN =================
  function onPomodoroDone() {
    const p = P();
    p.eggs = p.eggs || [];
    p.pomoForEgg = (p.pomoForEgg || 0) + 1;
    // Cada pomodoro calienta el huevo más antiguo.
    const warming = p.eggs[0];
    if (warming) {
      warming.progress = (warming.progress || 0) + 1;
      if (warming.progress >= (warming.need || EGG_NEED)) hatch();
    }
    if (p.pomoForEgg >= EGG_EVERY && p.eggs.length < 3) {
      p.pomoForEgg = 0;
      p.eggs.push({ id: Date.now().toString(36), progress: 0, need: EGG_NEED, at: Date.now() });
      ctx.say(`🥚 ¡Encontré un huevo! Se abrirá tras ${EGG_NEED} pomodoros más 🍅`, 'celebrate', 8000, { cat: 'achievement', target: { cmd: 'panel', arg: 'pet#collection' } });
    }
    ctx.store.save();
    ctx.broadcast();
  }
  function hatch() {
    const p = P();
    p.eggs.shift();
    const r = Math.random();
    const rarity = r < 0.08 ? 'epic' : r < 0.35 ? 'rare' : 'common';
    const emoji = pick(POOL[rarity]);
    p.collection = p.collection || {};
    const isNew = !p.collection[emoji];
    p.collection[emoji] = (p.collection[emoji] || 0) + 1;
    const bonus = rarity === 'epic' ? 50 : rarity === 'rare' ? 20 : 5;
    p.coins = (p.coins || 0) + bonus;
    ctx.send('pet:hatch', { emoji, rarity });
    ctx.say(`🐣 ¡El huevo se abrió! Salió ${emoji} (${RARITY[rarity]})${isNew ? ' ¡NUEVO en tu colección!' : ''} +${bonus} 🌽`, 'celebrate', 10000, { cat: 'achievement', target: { cmd: 'panel', arg: 'pet#collection' } });
  }
  function collectionView() {
    const p = P();
    const all = [...POOL.common.map((e) => [e, 'common']), ...POOL.rare.map((e) => [e, 'rare']), ...POOL.epic.map((e) => [e, 'epic'])];
    return {
      eggs: (p.eggs || []).map((e) => ({ ...e })),
      nextEggIn: EGG_EVERY - (p.pomoForEgg || 0),
      items: all.map(([e, r]) => ({ emoji: e, rarity: r, count: (p.collection || {})[e] || 0 })),
      got: Object.keys(p.collection || {}).length,
      total: all.length,
    };
  }

  // ================= 📜 DIARIO DEL POLLITO =================
  function dayFacts(day) {
    const f = day.focus || {};
    const tasks = (day.standup && day.standup.today) || [];
    return {
      tasks: tasks.length, done: tasks.filter((t) => t.done).length,
      work: Math.round((f.work || 0) / 60), dist: Math.round((f.distraction || 0) / 60),
      pomos: day.pomodoros || 0, commits: day.commits || 0, claude: day.claudeTasks || 0,
      top: Object.entries(day.projects || {}).sort((a, b) => b[1] - a[1])[0],
      mood: day.mood, habits: Object.values(day.habits || {}).reduce((a, b) => a + b, 0),
      builds: day.builds || null,
    };
  }
  function templateEntry(name, f) {
    const L = [];
    const tone = S().settings.personality || 'motivador';
    L.push(pick(['Querido diario:', 'Diario de un pollito PM:', 'Hoy en la oficina del escritorio…']));
    if (!f.tasks && !f.work) L.push('Hoy mi humano casi no apareció. Me dediqué a picotear píxeles y a mirar el cursor 🐣.');
    else {
      L.push(`Mi humano tenía ${f.tasks} tarea${f.tasks === 1 ? '' : 's'} y terminó ${f.done}.${f.done === f.tasks && f.tasks ? ' ¡TODAS! Bailé un poquito 💃.' : ''}`);
      if (f.work) L.push(`Trabajó ${f.work} minutos${f.top ? `, sobre todo en ${f.top[0]}` : ''}.${f.dist > 30 ? ` Se escapó ${f.dist} minutos a distraerse… lo vi todo 👀.` : ''}`);
      if (f.pomos) L.push(`Hicimos ${f.pomos} pomodoro${f.pomos === 1 ? '' : 's'} 🍅.`);
      if (f.commits) L.push(`Guardó ${f.commits} commit${f.commits === 1 ? '' : 's'} 📦.`);
      if (f.claude) L.push(`Claude le ayudó ${f.claude} ${f.claude === 1 ? 'vez' : 'veces'} 🤖.`);
      if (f.builds && f.builds.fail) L.push(`Hubo ${f.builds.fail} build${f.builds.fail === 1 ? '' : 's'} rojo${f.builds.fail === 1 ? '' : 's'}; sobrevivimos 😅.`);
    }
    const close = { motivador: 'Mañana lo haremos aún mejor 💛', sarcastico: 'Mañana, más de lo mismo. Qué ilusión 🙃', zen: 'Mañana es otro amanecer 🌅', sargento: '¡MAÑANA, A LAS 0800, DE VUELTA AL FRENTE! 🪖' };
    L.push(close[tone] || close.motivador);
    L.push(`— ${name} 🐣`);
    return L.join(' ');
  }
  async function writeDiary(dateKey = keyOf(new Date()), force = false) {
    const d = S().petDiary || (S().petDiary = {});
    if (d[dateKey] && !force) return d[dateKey];
    const day = S().days[dateKey];
    if (!day) return null;
    const f = dayFacts(day);
    const name = P().name || 'PM';
    let text = templateEntry(name, f);
    if (ctx.aiAvailable()) {
      try {
        text = await ctx.ai().polish(JSON.stringify({ ...f, top: f.top ? f.top[0] : null, notas: (day.notes || '').slice(0, 300) }),
          `Eres ${name}, un pollito tamagotchi que hace de PM. ${aiTone()} Escribe la entrada de tu diario de hoy (60-110 palabras, en primera persona, gracioso y tierno) contando el día de tu humano con estos datos reales. Firma con "— ${name} 🐣".`);
      } catch { /* plantilla */ }
    }
    d[dateKey] = { text: text.slice(0, 1500), at: Date.now(), persona: S().settings.personality || 'motivador' };
    // Solo las 60 últimas.
    for (const k of Object.keys(d).sort().slice(0, -60)) delete d[k];
    ctx.store.save();
    ctx.broadcast();
    return d[dateKey];
  }
  function diaryTick() {
    const now = new Date();
    if (now.getHours() < 20) return;
    const k = keyOf(now);
    const day = S().days[k];
    if (!day || (S().petDiary || {})[k]) return;
    writeDiary(k).then((e) => {
      if (e && !ctx.isMuted()) ctx.say('📜 Escribí en mi diario lo que hicimos hoy. ¿Quieres leerlo?', 'read', 12000, { cat: 'pet', target: { cmd: 'panel', arg: 'pet#diary' }, actions: [{ label: '📜 Leer', cmd: 'panel', arg: 'pet#diary' }] });
    });
  }

  // ================= 🎵 MODO MÚSICA =================
  // El vigilante lee los controles multimedia de Windows (cualquier app: Spotify, navegador,
  // Apple Music…) y manda "mu" (artista - canción) y "ms" (la app). Si suena algo, el pollito baila.
  let music = null;
  let musicPausedAt = 0;
  let lastMusicTalk = 0;
  const MUSIC_TITLE = /(youtube music|soundcloud|deezer|apple music|tidal|amazon music)/i;
  /** @type {Array<[RegExp, string]>} */
  const APP_NAMES = [
    [/spotify/i, 'Spotify'], [/opera/i, 'Opera'], [/chrome/i, 'Chrome'], [/msedge|edge/i, 'Edge'], [/firefox/i, 'Firefox'],
    [/brave/i, 'Brave'], [/applemusic|itunes/i, 'Apple Music'], [/zune|groove|media\s*player/i, 'Reproductor multimedia'],
    [/vlc/i, 'VLC'], [/deezer/i, 'Deezer'], [/tidal/i, 'TIDAL'], [/amazon/i, 'Amazon Music'], [/youtube/i, 'YouTube Music'],
  ];
  const appName = (id) => { const hit = APP_NAMES.find(([re]) => re.test(id || '')); return hit ? hit[1] : ''; };
  const MUSIC_LINES = [
    (t) => `🎵 ¡Temazo! Me pongo a bailar${t ? `: «${t}»` : ''} 💃`,
    (t) => `🎶 ¡Esa me la sé!${t ? ` «${t}»` : ''}`,
    () => '🎧 ¡Música! No puedo parar de mover las alas 🐥',
    () => '🎵 Buen ritmo para trabajar 👌 ¡Vamos!',
  ];
  // Si no se puede escuchar el audio: apps de música → sí; navegador → solo si el título lo parece.
  const MUSIC_APPS = /spotify|applemusic|itunes|deezer|tidal|amazonmusic|zune|groove|soundcloud|youtubemusic/i;
  const MUSIC_WORDS = /(official (music )?video|official audio|videoclip|lyrics?|letra|\bft\.|\bfeat\.?|remix|\bcover\b|ac[uú]stico|en vivo|live session|álbum|album|playlist|mix\b|canci[oó]n|song|music)/i;
  function looksLikeMusic(now, source) {
    return MUSIC_APPS.test(source || now.app || '') || MUSIC_WORDS.test(now.title || '');
  }
  function onSample(s) {
    let now = null;
    if (s.mu) now = { app: appName(s.ms) || (s.ms ? 'Música' : 'Spotify'), title: String(s.mu).slice(0, 80) };
    else if (MUSIC_TITLE.test(s.t || '') && !/pausad|paused/i.test(s.t)) now = { app: (String(s.t).match(MUSIC_TITLE) || [])[1], title: String(s.t).replace(/\s*[-–|]\s*(youtube music|soundcloud|deezer|apple music|tidal|amazon music).*$/i, '').slice(0, 80) };
    // Apagado, en reunión o presentando: se deja de bailar al instante.
    const blocked = S().settings.musicMode === false || ctx.getMeeting() || ctx.isPresenting();
    if (blocked) now = null;
    // ¿Es música de verdad o alguien hablando? Lo decide lo que se oye (si se puede escuchar).
    if (ctx.audioOnMedia) ctx.audioOnMedia(!!now);
    if (now) {
      const v = ctx.audioVerdict ? ctx.audioVerdict() : 'off';
      if (v === 'speech') now = null; // un vídeo o podcast de alguien hablando: no se baila
      else if (v === 'pending') { if (!music) return; } // aún escuchando: no empieza a bailar todavía
      else if (v === 'unavailable' && !looksLikeMusic(now, s.ms)) now = null; // sin oído: por la app y el título
      if (now) now.heard = v === 'music';
    }
    const was = music;
    // Una pausa corta (cambiar de canción, anuncios) no corta el baile.
    if (!now && was && !blocked) {
      if (!musicPausedAt) { musicPausedAt = Date.now(); return; }
      if (Date.now() - musicPausedAt < 12000) return;
    }
    musicPausedAt = 0;
    music = now;
    if (!!was !== !!now || (was && now && was.title !== now.title)) {
      ctx.send('pet:music', now);
      if (now && !was) {
        const d = ctx.today();
        d.music = (d.music || 0) + 1;
        // Como mucho un comentario cada 30 min (y nunca en silencio o en modo foco).
        if (Date.now() - lastMusicTalk > 30 * 60e3 && !ctx.isMuted()) {
          lastMusicTalk = Date.now();
          const song = now.title.split(' - ').pop().slice(0, 40);
          ctx.say(pick(MUSIC_LINES)(song), 'dance', 6000, { log: false, cat: 'pet' });
        }
      }
    }
  }

  function snapshot() {
    return {
      personality: S().settings.personality || 'motivador',
      personas: Object.entries(PERSONAS).map(([id, p]) => ({ id, name: p.name, emoji: p.emoji })),
      home: homeView(),
      collection: collectionView(),
      petDiary: Object.entries(S().petDiary || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14).map(([k, v]) => ({ day: k, ...v })),
      music,
    };
  }

  function start() {
    setInterval(diaryTick, 5 * 60e3);
  }

  return {
    start, snapshot,
    scold, backToWork, praise, chatter, aiTone,
    buyHome, onPomodoroDone, writeDiary, onSample,
  };
}

module.exports = { create, HOME, POOL, PERSONAS };
