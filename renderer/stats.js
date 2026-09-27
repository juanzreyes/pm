// Estadísticas del mes: gráficos SVG propios (sin librerías), con tooltip al pasar el ratón.
(function () {
  const ov = document.getElementById('o-stats');
  ov.classList.add('viz-root');
  const tip = document.getElementById('st-tip');
  const W = 330; // ancho útil del gráfico en el panel

  const fmtH = (secs) => {
    const m = Math.round(secs / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  };
  const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n));
  const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Barra con esquinas superiores redondeadas (4px) apoyada en la línea base.
  function bar(x, y, w, h, fill, r = 4) {
    if (h <= 0) return '';
    r = Math.min(r, h, w / 2);
    return `<path class="mark" fill="${fill}" d="M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z"/>`;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
    return 10 * p;
  }

  // ---- Mapa de calor: horas trabajadas en 5 semanas ----
  function heatmap(days) {
    const cell = 30, gap = 4, left = 22, top = 4;
    const labels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    const bins = [0, 1, 2, 4, 6]; // horas
    const color = (h) => (h <= 0 ? 'var(--seq-0)' : h < 1 ? 'var(--seq-1)' : h < 2 ? 'var(--seq-2)' : h < 4 ? 'var(--seq-3)' : h < 6 ? 'var(--seq-4)' : 'var(--seq-5)');
    // Alinea por semanas (lunes arriba).
    const first = days[0];
    const offset = (first.dow + 6) % 7;
    let svg = '';
    labels.forEach((l, i) => { svg += `<text x="0" y="${top + i * (cell / 2 + 2) + 9}">${l}</text>`; });
    const rows = 7, rowH = cell / 2 + 2;
    days.forEach((d, i) => {
      const idx = i + offset;
      const col = Math.floor(idx / 7), row = idx % 7;
      const x = left + col * (cell * 1.6 + gap), y = top + row * rowH;
      const h = d.work / 3600;
      svg += `<rect class="mark" data-tip="${escH(d.label)}: ${escH(fmtH(d.work))} de trabajo" x="${x}" y="${y}" width="${cell * 1.6}" height="${rowH - 2}" rx="3" fill="${color(h)}"/>`;
    });
    const height = top + rows * rowH + 18;
    // Leyenda de escala
    let lx = left;
    svg += `<text x="${lx}" y="${height - 3}">0 h</text>`;
    lx += 18;
    ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'].forEach((c, i) => {
      svg += `<rect x="${lx + i * 16}" y="${height - 11}" width="14" height="9" rx="2" fill="${c}"/>`;
    });
    svg += `<text x="${lx + 5 * 16 + 4}" y="${height - 3}">6+ h</text>`;
    void bins;
    return `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="Mapa de calor de horas trabajadas">${svg}</svg>`;
  }

  // ---- Barras apiladas: trabajo vs distracción (14 días) ----
  function stacked(days) {
    const H = 120, left = 26, bottom = 16, top = 6;
    const vals = days.map((d) => ({ w: d.work / 3600, d: d.distraction / 3600, d0: d }));
    const max = niceMax(Math.max(...vals.map((v) => v.w + v.d), 1));
    const plotH = H - bottom - top, slot = (W - left) / vals.length, bw = Math.min(14, slot - 6);
    let svg = '';
    for (let i = 0; i <= 2; i++) {
      const y = top + plotH - (plotH * i) / 2;
      svg += `<line x1="${left}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--grid)" stroke-width="1"/><text x="0" y="${y + 3}">${(max * i) / 2}h</text>`;
    }
    vals.forEach((v, i) => {
      const x = left + i * slot + (slot - bw) / 2;
      const hw = (v.w / max) * plotH, hd = (v.d / max) * plotH;
      const base = top + plotH;
      // trabajo abajo (plano arriba si hay distracción encima), 2px de separación entre segmentos
      svg += hd > 0 ? `<rect class="mark" x="${x}" y="${base - hw}" width="${bw}" height="${Math.max(0, hw)}" fill="var(--series-1)"/>` : bar(x, base - hw, bw, hw, 'var(--series-1)');
      if (hd > 0) svg += bar(x, base - hw - hd - (hw > 0 ? 2 : 0), bw, hd, 'var(--series-2)');
      svg += `<rect class="hit" x="${left + i * slot}" y="${top}" width="${slot}" height="${plotH}" fill="transparent" data-tip="${escH(v.d0.label)} · Trabajo ${escH(fmtH(v.d0.work))} · Distracción ${escH(fmtH(v.d0.distraction))}"/>`;
      if (i % 2 === 0 || i === vals.length - 1) svg += `<text x="${x + bw / 2}" y="${H - 3}" text-anchor="middle">${escH(v.d0.label.split(' ')[0])}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Horas de trabajo y distracción por día">${svg}</svg>`;
  }

  // ---- Barras simples verticales (tokens por día) ----
  function simpleBars(days, get, fmt, label) {
    const H = 110, left = 30, bottom = 16, top = 12;
    const vals = days.map(get);
    const max = niceMax(Math.max(...vals, 1));
    const plotH = H - bottom - top, slot = (W - left) / vals.length, bw = Math.min(14, slot - 6);
    let svg = '';
    for (let i = 0; i <= 2; i++) {
      const y = top + plotH - (plotH * i) / 2;
      svg += `<line x1="${left}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="0" y="${y + 3}">${fmt((max * i) / 2)}</text>`;
    }
    const peak = vals.indexOf(Math.max(...vals));
    vals.forEach((v, i) => {
      const x = left + i * slot + (slot - bw) / 2, h = (v / max) * plotH;
      svg += bar(x, top + plotH - h, bw, h, 'var(--series-1)');
      if (i === peak && v > 0) svg += `<text x="${x + bw / 2}" y="${top + plotH - h - 3}" text-anchor="middle" style="fill:var(--text-primary);font-weight:800">${fmt(v)}</text>`;
      svg += `<rect class="hit" x="${left + i * slot}" y="${top}" width="${slot}" height="${plotH}" fill="transparent" data-tip="${escH(days[i].label)} · ${escH(fmt(v))} ${escH(label)}"/>`;
      if (i % 2 === 0 || i === vals.length - 1) svg += `<text x="${x + bw / 2}" y="${H - 3}" text-anchor="middle">${escH(days[i].label.split(' ')[0])}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escH(label)} por día">${svg}</svg>`;
  }

  // ---- Tareas: planeadas (fondo claro) vs cumplidas (sólido) ----
  function tasks(days) {
    const H = 100, left = 18, bottom = 16, top = 12;
    const max = niceMax(Math.max(...days.map((d) => d.planned), 1));
    const plotH = H - bottom - top, slot = (W - left) / days.length, bw = Math.min(14, slot - 6);
    let svg = '';
    for (let i = 0; i <= 2; i++) {
      const y = top + plotH - (plotH * i) / 2;
      const v = (max * i) / 2;
      svg += `<line x1="${left}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--grid)"/>${Number.isInteger(v) ? `<text x="0" y="${y + 3}">${v}</text>` : ''}`;
    }
    days.forEach((d, i) => {
      const x = left + i * slot + (slot - bw) / 2;
      const hp = (d.planned / max) * plotH, hd = (d.done / max) * plotH;
      svg += bar(x, top + plotH - hp, bw, hp, 'var(--seq-1)');
      svg += bar(x + 2, top + plotH - hd, bw - 4, hd, 'var(--series-1)');
      svg += `<rect class="hit" x="${left + i * slot}" y="${top}" width="${slot}" height="${plotH}" fill="transparent" data-tip="${escH(d.label)} · ${d.done}/${d.planned} tareas"/>`;
      if (i % 2 === 0 || i === days.length - 1) svg += `<text x="${x + bw / 2}" y="${H - 3}" text-anchor="middle">${escH(d.label.split(' ')[0])}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tareas cumplidas frente a planeadas">${svg}</svg>`;
  }

  // ---- Barras horizontales: proyectos (30 días) ----
  function projects(list) {
    if (!list.length) return '<div class="muted small">Aún no hay tiempo por proyecto registrado.</div>';
    const rowH = 22, labelW = 104, H = list.length * rowH;
    const max = Math.max(...list.map((p) => p[1]), 1);
    const plotW = W - labelW - 56;
    let svg = '';
    list.forEach(([name, secs], i) => {
      const y = i * rowH + 4, w = Math.max(3, (secs / max) * plotW);
      const short = name.length > 16 ? name.slice(0, 15) + '…' : name;
      svg += `<text x="0" y="${y + 11}" style="fill:var(--text-primary);font-weight:700">${escH(short)}</text>`;
      svg += `<path class="mark" fill="var(--series-1)" d="M${labelW},${y} H${labelW + w - 4} Q${labelW + w},${y} ${labelW + w},${y + 4} V${y + 10} Q${labelW + w},${y + 14} ${labelW + w - 4},${y + 14} H${labelW} Z" data-tip="${escH(name)}: ${escH(fmtH(secs))}"/>`;
      svg += `<text x="${labelW + w + 5}" y="${y + 11}">${escH(fmtH(secs))}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Horas por proyecto">${svg}</svg>`;
  }

  function chart(title, legend, body) {
    const lg = legend ? `<div class="legend">${legend.map(([c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</div>` : '';
    return `<div class="chart"><h4>${title}</h4>${lg}${body}</div>`;
  }

  async function openStats() {
    document.querySelectorAll('.overlay').forEach((o) => o.classList.add('hidden'));
    ov.classList.remove('hidden');
    const s = await pm.stats();
    const d14 = s.days.slice(-14);
    const t = s.totals;
    document.getElementById('st-tiles').innerHTML = [
      [`${t.hours.toFixed(1)} h`, 'Horas este mes'],
      [`🔥 ${t.streak}`, 'Racha de dailies'],
      [`🍅 ${t.pomodoros}`, 'Pomodoros este mes'],
      [`📦 ${t.commits}`, 'Commits este mes'],
    ].map(([v, l]) => `<div class="tile2"><b>${v}</b><span>${l}</span></div>`).join('');
    const insightsHtml = `<div class="chart insights"><h4>🧠 Tus patrones</h4>${(s.insights || []).map((x) => `<p>${escH(x)}</p>`).join('')}</div>`;
    const moodDays = d14.filter((d) => d.mood);
    const MOOD = ['', '😫', '😕', '😐', '🙂', '😄'];
    const moodHtml = moodDays.length
      ? chart('Ánimo (14 días)', null, `<div class="moodrow">${d14.map((d) => `<span data-tip="${escH(d.label)}">${d.mood ? MOOD[d.mood] : '·'}</span>`).join('')}</div>`)
      : '';
    document.getElementById('st-charts').innerHTML =
      insightsHtml +
      chart('Horas trabajadas (30 días)', null, heatmap(s.days)) +
      chart('Trabajo vs distracción (14 días)', [['var(--series-1)', 'Trabajo'], ['var(--series-2)', 'Distracción']], stacked(d14)) +
      chart('Tareas cumplidas vs planeadas (14 días)', [['var(--series-1)', 'Cumplidas'], ['var(--seq-1)', 'Planeadas']], tasks(d14)) +
      moodHtml +
      chart('Tokens de Claude por día (14 días)', null, simpleBars(d14, (d) => d.tokens, fmtTok, 'tokens')) +
      chart('Coste equivalente en la API por día (14 días)', null, simpleBars(d14, (d) => d.cost, (v) => '$' + (v < 10 ? v.toFixed(1) : Math.round(v)), 'USD')) +
      chart('Proyectos (30 días)', null, projects(s.projects));
    lang = (await pm.getState()).lang || 'es';
    if (lang === 'en') I18N.translateDom(ov, 'en');
  }
  let lang = 'es';
  const TIP_EN = [[/ de trabajo$/, ' of work'], [/Trabajo /, 'Work '], [/Distracción /, 'Distraction '], [/ tareas$/, ' tasks']];
  const tipText = (t) => (lang === 'en' ? TIP_EN.reduce((s, [re, r]) => s.replace(re, r), t) : t);

  // Tooltip
  ov.addEventListener('mousemove', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) { tip.classList.add('hidden'); return; }
    tip.textContent = tipText(el.dataset.tip);
    tip.classList.remove('hidden');
    const x = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + 'px';
    tip.style.top = e.clientY - 34 + 'px';
  });
  ov.addEventListener('mouseleave', () => tip.classList.add('hidden'));
  document.getElementById('st-close').addEventListener('click', () => ov.classList.add('hidden'));

  window.openStats = openStats;
})();
