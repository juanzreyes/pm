// Panel 2.0: el alma del pollito (Perfil): rasgos, huerta, trucos, familia, fechas, sueños, cartas y postales.
/* global $, esc, state, toast, I18N */
(() => {
  const tr = (el) => { if (state && state.lang && state.lang !== 'es' && el) I18N.translateDom(el, state.lang); };
  const fmtDay = (k) => new Date(k + 'T12:00').toLocaleDateString(state.lang === 'en' ? 'en' : 'es', { weekday: 'short', day: 'numeric', month: 'short' });
  const act = async (action, arg) => {
    const r = await pm.soulAct(action, arg);
    if (r && r.ok === false && r.error) toast('😿 ' + r.error);
    return r;
  };
  const KIND = { birthday: '🎂', deadline: '🏁', other: '📅' };

  function render() {
    const s = state.soul;
    if (!s) return;
    // 🏖️ vacaciones
    const v = s.vacation;
    $('#soul-vacation').classList.toggle('hidden', !v);
    if (v) {
      const back = new Date(v.until).toLocaleDateString(state.lang === 'en' ? 'en' : 'es', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
      $('#soul-vacation').innerHTML = `<b>${v.emoji} Está de vacaciones en ${esc(v.place)}</b><div class="muted">Se fue porque estaba solito y con hambre. Vuelve el ${esc(back)}.</div>
        <button type="button" class="soft mini" data-soul="callBack">📞 Pedirle que vuelva (${v.price} 🌽)</button>`;
    }
    // 🧬 rasgos
    const mine = new Set(s.traits.map((t) => t.id));
    $('#soul-traits').innerHTML = s.allTraits.map((t) => {
      const got = s.traits.find((x) => x.id === t.id);
      return `<span class="trait-chip ${mine.has(t.id) ? 'on' : ''}" title="${esc(t.desc)}">${t.emoji} ${esc(t.name)}${got && got.inherited ? ' <small>(heredado)</small>' : ''}</span>`;
    }).join('');
    // 🌱 huerta
    const g = s.garden;
    $('#soul-harvests').textContent = `🧺 ${g.harvests}`;
    $('#soul-garden').innerHTML = g.pots.map((p, i) => `<div class="pot ${p.ripe ? 'ripe' : ''} ${p.wilted ? 'wilted' : ''}" data-i="${i}">
        <div class="pot-plant">${p.emoji}</div>
        <div class="pot-bar"><i style="width:${Math.min(100, (p.growth / 3) * 100)}%"></i></div>
        ${p.ripe ? '<button type="button" class="primary mini" data-soul="harvest">🧺 Cosechar</button>'
          : p.growth === 0 && !p.wilted ? `<select class="pot-seed" aria-label="Semilla">${g.plants.map((x) => `<option value="${x.id}" ${x.id === p.plant ? 'selected' : ''}>${x.emoji} ${esc(x.name)}</option>`).join('')}</select>`
            : `<small class="muted">${p.wilted ? 'marchita: completa una tarea' : esc(p.name)}</small>`}
      </div>`).join('') + (g.canBuy ? `<button type="button" class="pot pot-buy" data-soul="buyPot" title="Otra maceta">＋<small>${g.potPrice} 🌽</small></button>` : '');
    // 🎪 trucos
    $('#soul-practice').textContent = s.practiceLeft > 0 ? `${s.practiceLeft} práctica${s.practiceLeft === 1 ? '' : 's'} hoy` : 'mañana más';
    $('#soul-tricks').innerHTML = s.tricks.map((t) => `<div class="trick row between" data-id="${t.id}">
        <span>${t.emoji} <b>${esc(t.name)}</b> ${t.learned ? '<span class="okmsg small">✓ aprendido</span>' : `<span class="muted small">${t.progress}/${t.need}</span>`}</span>
        <button type="button" class="${t.learned ? 'soft' : 'ghost'} mini" data-soul="${t.learned ? 'perform' : 'practice'}" ${!t.learned && s.practiceLeft <= 0 ? 'disabled' : ''}>${t.learned ? '▶ Hacerlo' : '🏋️ Practicar'}</button>
      </div>`).join('') + '<div class="muted small">Los trucos aprendidos los hace solo cuando terminas todas tus tareas o algo grande.</div>';
    // 🌳 familia
    const L = s.legacy;
    $('#soul-gen').textContent = `Gen. ${L.generation}`;
    $('#soul-family').innerHTML = (L.heirEgg
      ? `<div>🥚✨ <b>Huevo heredero listo</b> ${L.heirEgg.traits.length ? '· lleva ' + L.heirEgg.traits.join(', ') : ''}</div>
         <form class="row gap soul-heir"><input class="heir-name" maxlength="24" placeholder="Nombre del heredero" /><button class="primary mini" type="submit">🐣 Que nazca</button></form>
         <div class="muted small">Al nacer, ${esc(state.pet.name || 'tu pollito')} se jubila y pasa al árbol. Se conservan tu maíz, colección, casita, logros y accesorios.</div>`
      : L.canLay ? `<button type="button" class="primary mini" data-soul="layEgg">🥚 Poner un huevo heredero</button><div class="muted small">Hereda un rasgo, los trucos y la especie.</div>`
        : `<div class="muted">Cuando sea gallo (nivel ${L.needLevel}, ahora ${L.level}) y tenga ${L.needDays} días (ahora ${L.ageDays}), podrá poner un huevo heredero.</div>`)
      + (L.lineage.length ? `<div class="lineage">${L.lineage.map((a) => `<div>👴 <b>${esc(a.name)}</b> <span class="muted small">gen. ${a.generation} · nivel ${a.level} · ${(a.traits || []).length} rasgos · ${(a.tricks || []).length} trucos</span></div>`).join('')}</div>` : '');
    // 📅 fechas
    $('#soul-dates').innerHTML = s.dates.length
      ? s.dates.map((d) => `<div class="row between soul-date" data-id="${esc(d.id)}"><span>${KIND[d.kind] || '📅'} ${esc(d.label)} <span class="muted small">${d.day}/${d.month}${d.year ? '/' + d.year : ''} · ${d.inDays === 0 ? '¡hoy!' : d.inDays < 0 ? 'pasó' : `en ${d.inDays} día${d.inDays === 1 ? '' : 's'}`}</span></span><button type="button" class="icon mini" data-soul="removeDate" aria-label="Quitar">✕</button></div>`).join('')
      : '<span class="muted">Cuéntame cumpleaños y entregas importantes y te aviso a tiempo.</span>';
    // 💭 sueños, 💌 cartas, 📮 postales
    $('#soul-dreams').innerHTML = s.dreams.length ? s.dreams.map((d) => `<div class="entry"><b>${esc(fmtDay(d.day))}</b><p>${esc(d.text)}</p></div>`).join('') : '<span class="muted small">Cada mañana te cuento lo que soñé.</span>';
    $('#soul-letters').innerHTML = s.letters.length ? s.letters.map((l, i) => `<details class="entry" ${i === 0 ? 'open' : ''}><summary><b>Semana del ${esc(fmtDay(l.week))}</b></summary><p class="letter">${esc(l.text)}</p></details>`).join('') : '<span class="muted small">Los viernes, al cierre, te escribo una carta sobre tu semana.</span>';
    $('#soul-postcards').innerHTML = s.postcards.length ? s.postcards.map((c) => `<div class="entry postcard"><b>${c.emoji} ${esc(c.place)}</b><p>${esc(c.text)}</p></div>`).join('') : '<span class="muted small">Ojalá nunca tenga que mandarte una 😅 (me voy de vacaciones si me descuidas mucho).</span>';
    tr($('#v-pet'));
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-soul]');
    if (!b || !b.closest('#v-pet')) return;
    const a = b.dataset.soul;
    if (a === 'harvest') return act('harvest', Number(b.closest('.pot').dataset.i));
    if (a === 'practice' || a === 'perform') return act(a, b.closest('.trick').dataset.id);
    if (a === 'removeDate') return act('removeDate', b.closest('.soul-date').dataset.id);
    if (a === 'layEgg' && !confirm('¿Poner el huevo heredero? Cuando nazca, tu pollito actual se jubila.')) return;
    b.disabled = true;
    try { await act(a); } finally { b.disabled = false; }
  });
  document.addEventListener('change', (e) => {
    const sel = e.target.closest('.pot-seed');
    if (sel) act('plant', { i: Number(sel.closest('.pot').dataset.i), kind: sel.value });
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('.soul-heir');
    if (!f) return;
    e.preventDefault();
    const n = f.querySelector('.heir-name').value.trim();
    if (!n) return f.querySelector('.heir-name').focus();
    if (confirm(`¿Que nazca ${n}? ${state.pet.name || 'Tu pollito'} se jubila y pasa al árbol genealógico.`)) act('hatchHeir', n);
  });
  $('#soul-date-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await act('addDate', { label: $('#soul-date-label').value, date: $('#soul-date-date').value, kind: $('#soul-date-kind').value });
    if (r && r.ok) { $('#soul-date-label').value = ''; $('#soul-date-date').value = ''; }
  });
  $('#soul-letter-now').addEventListener('click', async (e) => { e.currentTarget.disabled = true; try { await act('letter'); } finally { e.currentTarget.disabled = false; } });
  $('#soul-dream-now').addEventListener('click', async (e) => { e.currentTarget.disabled = true; try { await act('dream'); } finally { e.currentTarget.disabled = false; } });

  const prevRender = window.renderExtras;
  window.renderExtras = () => { if (prevRender) prevRender(); render(); };
  if (typeof state !== 'undefined' && state) window.renderExtras();
})();
