// Panel 2.0 · equipo: la granja con los pollitos de tus compañeros (dormidos si están en foco),
// kudos con maíz, visitas y el reto de foco semanal. Datos en src/main/teamfarm.js.
/* global $, esc, state, toast, I18N */
(() => {
  const tr = (el) => { if (state && state.lang && state.lang !== 'es' && el) I18N.translateDom(el, state.lang); };
  const COLORS = { chick: ['#ffe066', '#d99a14', '#ff9f1c'], duck: ['#fbfaf5', '#c9bfa8', '#ff9f1c'], cat: ['#f6a85c', '#b86b27', '#ff7b9c'], penguin: ['#3d4352', '#22262f', '#ffb020'] };
  const STATUS = { online: '🟢 en su PC', focus: '😴 en foco · no molestar', away: '💤 desconectado' };
  const MOOD = { feliz: '😊', normal: '🙂', triste: '😢' };

  /** Pollito en miniatura del color de su especie; con los ojos cerrados si está en foco. */
  function mini(c) {
    const [body, line, beak] = COLORS[c.species] || COLORS.chick;
    const sleep = c.status !== 'online';
    const eyes = sleep
      ? '<path d="M16 25 q3 2 6 0 M28 25 q3 2 6 0" stroke="#3b2f2f" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      : '<ellipse cx="19.5" cy="25" rx="2.3" ry="2.8" fill="#3b2f2f"/><ellipse cx="30.5" cy="25" rx="2.3" ry="2.8" fill="#3b2f2f"/>';
    const belly = c.species === 'penguin' ? '<ellipse cx="25" cy="32" rx="10" ry="11" fill="#fff"/>' : '';
    const ears = c.species === 'cat' ? `<path d="M12 18 l2 -10 l8 7z M38 18 l-2 -10 l-8 7z" fill="${body}" stroke="${line}" stroke-width="1.2"/>` : '';
    return `<svg viewBox="0 0 50 50" width="48" height="48" aria-hidden="true">${ears}<ellipse cx="25" cy="29" rx="16" ry="16" fill="${body}" stroke="${line}" stroke-width="1.4"/>${belly}${eyes}<path d="M22 31 q3 -3 6 0 q-3 3 -6 0z" fill="${beak}"/></svg>`;
  }

  let kudoFor = '';
  function render() {
    const f = state.farm;
    if (!f) return;
    $('#farm-folder').textContent = f.folder ? '📁 ' + f.folder : '';
    $('#farm-choose').textContent = f.folder ? '📁 Cambiar carpeta' : '📁 Elegir carpeta del equipo';
    $('#farm-share-row').classList.toggle('hidden', !f.folder);
    $('#farm-share').checked = f.share;
    // Con la granja funcionando, la explicación sobra: queda solo la carpeta.
    $('#farm-setup').querySelector('p').classList.toggle('hidden', !!(f.on && f.mates.length));
    const left = $('#farm-kudos-left');
    left.classList.toggle('hidden', !f.on);
    left.textContent = `🌽 ${f.kudosLeft} kudo${f.kudosLeft === 1 ? '' : 's'} hoy`;

    const ch = f.challenge;
    $('#farm-challenge').classList.toggle('hidden', !ch || ch.members < 2);
    if (ch && ch.members >= 2) {
      $('#farm-challenge').innerHTML = `<div class="row between"><b>🏆 Reto de foco de la semana</b><span class="muted">${Math.round(ch.done / 60)} / ${Math.round(ch.goal / 60)} h</span></div>
        <div class="bar"><i style="width:${ch.pct}%"></i></div>
        <div class="muted">${ch.reached ? '🎉 ¡Reto cumplido! Premio para todos: +30 maíz.' : `Entre ${ch.members}: ${Math.round(ch.goal / 60 / ch.members)} h de foco por persona. `}${ch.top.length ? 'Más enfocados: ' + ch.top.map((t) => `${esc(t.name)} (${Math.round(t.mins / 60 * 10) / 10} h)`).join(' · ') : ''}</div>`;
    }

    const list = $('#farm-list');
    const typing = list.querySelector('.kudo-msg');
    const typed = typing ? typing.value : '';
    const hadFocus = typing && document.activeElement === typing;
    if (!f.on) list.innerHTML = '';
    else if (!f.mates.length) list.innerHTML = '<div class="muted small">Aún no hay nadie más en esta carpeta. Comparte la misma carpeta con tu equipo y que cada uno la elija en su PM.</div>';
    else {
      list.innerHTML = f.mates.map((m) => `<div class="mate st-${m.status}" data-id="${esc(m.id)}">
        <div class="mate-pet">${mini(m)}${m.status === 'focus' ? '<span class="zz">z<sup>z</sup></span>' : ''}</div>
        <div class="mate-info"><b>${esc(m.name)}</b> <span class="muted">· ${esc(m.petName)} ${MOOD[m.mood] || ''}</span>
          <div class="muted small">Nv ${m.level}${m.streak ? ` · 🔥 ${m.streak}` : ''}${m.kudos ? ` · 🌽 ${m.kudos}` : ''} · ${STATUS[m.status]}</div>
          ${kudoFor === m.id ? `<form class="kudo-form row gap"><input class="kudo-msg" maxlength="140" placeholder="¿Por qué?" autocomplete="off" /><button class="primary mini" type="submit">Enviar 🌽</button></form>` : ''}
        </div>
        <div class="mate-acts"><button class="icon mini m-kudo" title="Darle un kudo (su pollito recibe maíz)" aria-label="Kudo" ${f.kudosLeft ? '' : 'disabled'}>🌽</button><button class="icon mini m-visit" title="${m.status === 'online' ? 'Que tu pollito lo visite' : 'Solo cuando está en su PC y no en foco'}" aria-label="Visitar" ${m.status === 'online' ? '' : 'disabled'}>🏠</button></div>
      </div>`).join('');
      const inp = list.querySelector('.kudo-msg');
      if (inp) { inp.value = typed; if (hadFocus || !typing) inp.focus(); }
    }
    // 🏅 Ranking de minijuegos del equipo.
    const lb = f.leaderboard;
    const has = lb && f.mates.length && Object.values(lb).some((l) => l.length);
    $('#farm-leaderboard').classList.toggle('hidden', !has);
    if (has) {
      const G = { corn: '🌽 Maíz', bugs: '🐞 Bugs', snake: '🐍 Viborita' };
      $('#farm-leaderboard').innerHTML = '<b>🏅 Ranking de minijuegos</b><div class="lb">' + Object.entries(G).map(([k, n]) => `<div><div class="muted">${n}</div>${(lb[k] || []).map((x, i) => `<div class="${f.me && x.id === f.me.id ? 'lb-me' : ''}">${['🥇', '🥈', '🥉'][i]} ${esc(x.name)} <b>${x.score}</b></div>`).join('') || '<div class="muted">—</div>'}</div>`).join('') + '</div><button class="ghost mini" id="farm-play">🎮 Jugar</button>';
    }
    const rec = f.received || [];
    $('#farm-received').innerHTML = rec.length ? '<div class="muted small"><b>Kudos que recibiste</b></div>' + rec.map((k) => `<div class="small">🌽 <b>${esc(k.fromName)}</b>${k.msg ? `: «${esc(k.msg)}»` : ''} <span class="muted">${new Date(k.at).toLocaleDateString()}</span></div>`).join('') : '';
    tr($('#v-pet'));
  }

  $('#farm-leaderboard').addEventListener('click', (e) => { if (e.target.closest('#farm-play')) pm.openGame(); });
  $('#farm-choose').addEventListener('click', async () => { const r = await pm.farmFolder(); if (r && r.error) toast('😿 ' + r.error); });
  $('#farm-share').addEventListener('change', (e) => pm.updateSettings({ teamShare: e.target.checked }));
  $('#farm-list').addEventListener('click', async (e) => {
    const card = e.target.closest('.mate');
    if (!card) return;
    if (e.target.closest('.m-kudo')) { kudoFor = kudoFor === card.dataset.id ? '' : card.dataset.id; render(); return; }
    if (e.target.closest('.m-visit')) {
      const r = await pm.farmVisit(card.dataset.id);
      toast(r.ok ? '🏠 Tu pollito salió de visita' : '😿 ' + r.error);
    }
  });
  $('#farm-list').addEventListener('submit', async (e) => {
    e.preventDefault();
    const card = e.target.closest('.mate');
    const send = card.querySelector('.kudo-form button');
    const r = await MOTION.busy(send, () => pm.farmKudo(card.dataset.id, card.querySelector('.kudo-msg').value));
    if (r.ok) { const rc = send.getBoundingClientRect(); MOTION.burst(rc.left + rc.width / 2, rc.top, { n: 12 }); }
    kudoFor = '';
    if (!r.ok) toast('😿 ' + r.error);
    render();
  });

  const prevRender = window.renderExtras;
  window.renderExtras = () => { if (prevRender) prevRender(); render(); };
  if (typeof state !== 'undefined' && state) window.renderExtras();
})();
