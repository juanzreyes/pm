// Granja del equipo (src/teamfarm.js): escribe tu tarjeta y tu buzón en la carpeta compartida,
// lee los de tus compañeros, entrega kudos y visitas, y premia el reto de foco semanal.
// Parte del proceso principal. `M` es el contexto compartido de la app.
/* eslint-disable no-use-before-define */
module.exports = function install(M) {
  const tf = require('../teamfarm');
  const S = () => M.store.data;
  const set = () => S().settings;
  const F = () => (S().farm = S().farm || { id: '', sent: [], seen: [], received: [], rewardWeek: '', pendingVisits: [] });
  const dir = () => (set().teamFolder ? M.path.join(set().teamFolder, 'pm-granja') : '');
  const on = () => !!set().teamFolder && set().teamShare !== false;
  let mates = [];
  let cards = [];
  let lastErr = '';

  function myId() {
    const f = F();
    if (!f.id) { f.id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); M.store.save(); }
    return f.id;
  }
  function myCard() {
    const d = S();
    let streak = 0;
    try { streak = M.gami.streaks(d).daily; } catch { /* sin historial */ }
    return tf.card({
      id: myId(), name: set().myName || d.pet.name || 'Yo', pet: d.pet, level: M.levelInfo(d.pet.xp || 0).level,
      focusMode: !!M.focusMode(), focusUntil: d.focusUntil || 0, weekMins: tf.weekFocusMins(d.days), streak, kudos: (F().received || []).filter((e) => e.type === 'kudo').length,
    });
  }

  // ---------- archivos de la carpeta compartida ----------
  function writeJson(file, obj) {
    const tmp = file + '.tmp';
    M.fs.writeFileSync(tmp, JSON.stringify(obj));
    M.fs.renameSync(tmp, file);
  }
  function readJson(file) {
    try { return JSON.parse(M.fs.readFileSync(file, 'utf8')); } catch { return null; }
  }
  function publish() {
    M.fs.mkdirSync(dir(), { recursive: true });
    const f = F();
    f.sent = tf.trimOutbox(f.sent);
    writeJson(M.path.join(dir(), myId() + '.json'), myCard());
    writeJson(M.path.join(dir(), myId() + '.out.json'), f.sent);
  }
  function readAll() {
    const names = M.fs.readdirSync(dir()).filter((n) => /^[\w-]+\.json$/.test(n) && !n.endsWith('.out.json'));
    cards = names.map((n) => readJson(M.path.join(dir(), n))).filter(Boolean);
    const boxes = names.map((n) => n.replace(/\.json$/, '')).filter((id) => id !== myId()).map((id) => readJson(M.path.join(dir(), id + '.out.json')));
    mates = tf.farm(cards, myId());
    return boxes;
  }

  /** Cada minuto: publica tu tarjeta, lee la granja y entrega lo que te llegó. */
  /** Dejar de compartir: tu tarjeta y tu buzón salen de la carpeta del equipo. */
  function unpublish() {
    if (!dir()) return;
    for (const n of [myId() + '.json', myId() + '.out.json']) { try { M.fs.unlinkSync(M.path.join(dir(), n)); } catch { /* ya no estaba */ } }
  }
  function tick() {
    if (!on()) { unpublish(); mates = []; return; }
    try {
      publish();
      deliver(readAll());
      reward();
      lastErr = '';
    } catch (e) {
      if (lastErr !== e.message) M.diag.log('main', 'Granja del equipo: ' + e.message);
      lastErr = e.message;
    }
    M.broadcast();
  }

  function deliver(boxes) {
    const f = F();
    const fresh = tf.inbox(boxes, myId(), f.seen);
    for (const e of fresh) {
      f.seen.push(e.id);
      if (e.type === 'kudo') {
        S().pet.coins = (S().pet.coins || 0) + tf.KUDO_CORN;
        S().pet.happiness = Math.min(100, (S().pet.happiness || 0) + 5);
        f.received.push(e);
        M.say(`🌽 ¡${e.fromName} te dio un kudo!${e.msg ? ` «${e.msg}»` : ''} (+${tf.KUDO_CORN} maíz para ${S().pet.name || 'mí'})`, 'love', 10000, { cat: 'pet', remote: false });
        M.sendPet('pet:anim', 'love');
      } else if (e.type === 'visit') {
        f.pendingVisits.push(e);
      }
    }
    f.seen = f.seen.slice(-300);
    f.received = f.received.slice(-30);
    // Las visitas esperan a que termines el modo foco: nadie te interrumpe.
    if (f.pendingVisits.length && !M.focusMode()) {
      const v = f.pendingVisits.shift();
      M.sendPet('pet:visitor', { name: v.fromName, petName: v.petName, species: v.species, ms: 45000 });
      M.say(`🏠 ¡${v.petName}, el pollito de ${v.fromName}, vino de visita!${v.msg ? ` «${v.msg}»` : ''}`, 'hop', 9000, { cat: 'pet', remote: false });
    }
    if (fresh.length) M.store.save();
  }

  /** Reto semanal cumplido: premio una sola vez por semana. */
  function reward() {
    const ch = tf.challenge([myCard(), ...mates]);
    const f = F();
    if (!ch.reached || ch.members < 2 || f.rewardWeek === ch.week) return;
    f.rewardWeek = ch.week;
    S().pet.coins = (S().pet.coins || 0) + 30;
    M.addXp(20);
    M.store.save();
    M.say(`🏆 ¡El equipo cumplió el reto de foco de la semana (${Math.round(ch.done / 60)} h entre ${ch.members})! +30 maíz y +20 XP`, 'celebrate', 12000, { cat: 'pet' });
  }

  // ---------- acciones ----------
  const mate = (id) => mates.find((m) => m.id === id) || null;
  function giveKudo(to, msg = '') {
    if (!on()) return { ok: false, error: 'Primero elige la carpeta del equipo' };
    const m = mate(to);
    if (!m) return { ok: false, error: 'No encuentro a esa persona en la granja' };
    const f = F();
    if (!tf.kudosLeft(f.sent)) return { ok: false, error: `Ya diste tus ${tf.KUDOS_PER_DAY} kudos de hoy; mañana hay más` };
    const me = myCard();
    const e = tf.event('kudo', me, m.id, msg);
    f.sent.push(e);
    M.store.save();
    try { publish(); } catch (err) { return { ok: false, error: err.message }; }
    M.say(`🌽 Le mandaste un kudo a ${m.name}: su pollito recibe ${tf.KUDO_CORN} de maíz.`, 'happy', 6000, { cat: 'pet', remote: false });
    // También al canal del equipo, si lo tienes conectado.
    if (set().teamOn && set().teamWebhook && !M.TEST) M.remote.sendTeam({ text: `🌽 ${me.name} le dio un kudo a ${m.name}${e.msg ? `: «${e.msg}»` : ''}` }).catch((err) => M.diag.log('main', 'Kudo al canal: ' + err.message));
    M.broadcast();
    return { ok: true, left: tf.kudosLeft(f.sent) };
  }
  function visit(to, msg = '') {
    if (!on()) return { ok: false, error: 'Primero elige la carpeta del equipo' };
    const m = mate(to);
    const f = F();
    const can = tf.canVisit(m, f.sent);
    if (!can.ok) return can;
    f.sent.push(tf.event('visit', myCard(), m.id, msg));
    M.store.save();
    try { publish(); } catch (err) { return { ok: false, error: err.message }; }
    M.sendPet('pet:anim', 'hop');
    M.say(`🏠 Me voy un ratito a visitar a ${m.petName} (de ${m.name}). ¡Ahora vuelvo!`, 'hop', 7000, { cat: 'pet', remote: false });
    M.broadcast();
    return { ok: true };
  }
  async function chooseFolder(win) {
    const r = await M.dialog.showOpenDialog(win, { title: 'Carpeta compartida del equipo (OneDrive, Google Drive, red…)', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    return setFolder(r.filePaths[0]);
  }
  function setFolder(folder) {
    if (set().teamFolder && set().teamFolder !== folder) unpublish();
    set().teamFolder = folder || '';
    if (folder && set().teamShare === undefined) set().teamShare = true;
    M.store.save();
    tick();
    return { ok: true, folder: set().teamFolder };
  }

  function farmState() {
    const f = F();
    const me = on() ? myCard() : null;
    return {
      folder: set().teamFolder || '', share: set().teamShare !== false, on: on(), error: lastErr,
      me, mates, challenge: me ? tf.challenge([me, ...mates]) : null,
      kudosLeft: tf.kudosLeft(f.sent), received: (f.received || []).slice(-8).reverse(), pendingVisits: (f.pendingVisits || []).length,
    };
  }

  function start() {
    myId();
    if (M.TEST) return;
    setTimeout(tick, 5000);
    setInterval(tick, 60e3);
  }

  return { start, tick, giveKudo, visit, chooseFolder, setFolder, farmState };
};
