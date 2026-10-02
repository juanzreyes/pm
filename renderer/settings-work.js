// Ajustes 1.6: cola de Claude que se ejecuta sola, tickets del equipo y avisos fuera del PC.
// Usa $, $$, esc e isEn de settings.js (se carga antes).
/* global $, $$, esc, isEn, I18N */
(() => {
  let st = null;
  const msg = (el, ok, text) => { el.className = 'small ' + (ok ? 'okmsg' : 'err'); el.textContent = (ok ? '' : '😿 ') + text; };
  const segOn = (el, v) => { for (const b of el.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === v); };

  function render() {
    if (!st) return;
    // ---------- cola automática ----------
    const cr = st.claudeRunner || {};
    $('#run-status').textContent = cr.busy ? '🤖 trabajando…' : cr.bin ? (cr.auto ? '▶️ automática' : 'lista') : 'sin Claude Code';
    $('#run-bin').textContent = cr.bin ? cr.bin : 'No lo encontré en este PC. Instálalo (npm i -g @anthropic-ai/claude-code) o elige dónde está.';
    $('#run-auto').checked = !!cr.auto;
    $('#run-tests').checked = cr.tests !== false;
    segOn($('#run-par'), String(cr.parallel || 2));
    $('#run-limits').checked = cr.respectLimits !== false;
    if (document.activeElement !== $('#run-limitpct')) $('#run-limitpct').value = cr.limitPct || 85;
    $('#run-modelauto').checked = cr.modelAuto !== false;
    $('#run-review').checked = cr.review !== false;
    $('#run-fixci').checked = cr.autoFixCi !== false;
    $('#run-fixrev').checked = !!cr.autoFixReview;
    if (document.activeElement !== $('#run-maxfix')) $('#run-maxfix').value = cr.maxFixes ?? 2;
    if (document.activeElement !== $('#run-budget')) $('#run-budget').value = cr.budget || 0;
    // ---------- plugins ----------
    const pl = st.plugins;
    if (pl) {
      $('#pl-list').innerHTML = pl.list.length ? pl.list.map((p) => (p.ok
        ? `<div class="opt box small"><div class="row between"><div><b>${esc(p.name)}</b> <span class="muted">v${esc(p.version)}${p.author ? ' · ' + esc(p.author) : ''}</span></div><input type="checkbox" class="switch pl-toggle" data-id="${esc(p.id)}" ${p.enabled ? 'checked' : ''} aria-label="Activar ${esc(p.name)}" /></div>
          <p class="muted">${esc(p.description)}</p>
          <div class="small">${p.perms.map((x) => esc(x)).join(' · ') || 'Sin permisos'}</div>
          ${p.enabled ? `<div class="small ${p.lastError ? 'err' : 'okmsg'}">${p.lastError ? '😿 ' + esc(p.lastError) : p.ready ? '✅ funcionando' : '⏳ arrancando…'}</div>` : ''}</div>`
        : `<div class="opt box small"><b>${esc(p.id)}</b><div class="small err">😿 ${esc(p.error)}</div></div>`)).join('')
        : '<div class="muted small">Aún no tienes plugins. Pon la carpeta de uno en la carpeta de plugins, o instala el ejemplo para ver cómo es.</div>';
    }
    // ---------- extensión del navegador ----------
    const bx = st.browserExt;
    if (bx) {
      $('#bx-token').value = bx.token;
      $('#bx-status').textContent = bx.connected ? '🟢 conectada' : bx.lastSeen ? 'sin conexión reciente' : 'sin emparejar';
      $('#bx-block').checked = bx.block;
      if (document.activeElement !== $('#bx-sites')) $('#bx-sites').value = bx.sites.join(', ');
    }
    // ---------- apariencia 2.0 ----------
    const ss = st.settings || {};
    segOn($('#pet-style'), ss.petStyle || 'normal');
    $('#pet-perch').checked = ss.petPerch !== false;
    $('#desktop-widget').checked = !!ss.desktopWidget;
    $('#pet-physics').checked = ss.petPhysics !== false;
    $('#pc-react').checked = ss.pcReactions !== false;
    $('#type-along').checked = ss.typeAlong !== false;
    if (document.activeElement !== $('#weather-city')) $('#weather-city').value = ss.weatherCity || '';
    const w = st.presence && st.presence.weather;
    $('#weather-info').textContent = w ? (w.error ? `😿 ${w.error}` : `${w.place}: ${w.temp} °C · ${{ rain: '☔ lluvia', snow: '❄️ nieve', hot: '🥵 calor', cold: '🧣 frío', mild: '🌤️ agradable' }[w.kind] || ''}`) : 'Paraguas si llueve, bufanda con frío, abanico con calor (Open-Meteo, sin cuenta).';
    // ---------- productividad 2.0 ----------
    if (document.activeElement !== $('#s-endofday')) $('#s-endofday').value = (st.coach && st.coach.endOfDay) || '';
    $('#s-ritual').checked = ss.closingRitual !== false;
    $('#s-sumclaude').checked = ss.summaryWithClaude !== false;
    if (document.activeElement !== $('#s-closeapps')) $('#s-closeapps').value = (ss.closeApps || []).join(', ');
    $('#s-stuck').checked = ss.stuckDetector !== false;
    $('#s-plancheck').checked = ss.planCheck !== false;
    $('#s-besthour').checked = ss.bestHour !== false;
    if (document.activeElement !== $('#s-myname')) $('#s-myname').value = ss.myName || '';
    // ---------- informe de errores ----------
    const erp = st.errReport || {};
    $('#err-box').classList.toggle('hidden', !erp.available);
    $('#err-on').checked = erp.consent === true;
    // ---------- configuración del equipo ----------
    const tp = (st.team && st.team.pack) || null;
    $('#tp-status').textContent = tp ? `✅ ${tp.name || 'importada'}` : 'solo tuya';
    segOn($('#run-perm'), cr.permission || 'acceptEdits');

    // ---------- tickets ----------
    const tk = st.tickets || { providers: {} };
    const pv = tk.providers || {};
    const on = { github: pv.github && pv.github.on, jira: pv.jira && pv.jira.has, linear: pv.linear && pv.linear.has, azure: pv.azure && pv.azure.has };
    for (const d of $$('details.tk[data-p]')) {
      const p = d.dataset.p;
      d.classList.toggle('on', !!on[p]);
      d.querySelector('.tk-del').classList.toggle('hidden', !on[p]);
      const n = (tk.issues || []).filter((i) => i.provider === p).length;
      const err = (tk.errors || []).find((e) => e.provider === p);
      d.querySelector('.tk-st').textContent = err ? `⚠️ ${err.error}` : on[p] ? `${n} asignado${n === 1 ? '' : 's'}` : '';
      const f = d.querySelector('form');
      if (p === 'jira' && document.activeElement.form !== f) { f.site.value = pv.jira.site || ''; f.email.value = pv.jira.email || ''; }
      if (p === 'azure' && document.activeElement.form !== f) f.org.value = pv.azure.org || '';
      if (f.token) f.token.placeholder = on[p] ? '•••••••• (guardado)' : f.token.dataset.ph || (f.token.dataset.ph = f.token.placeholder);
    }
    const count = Object.values(on).filter(Boolean).length;
    $('#tk-status').textContent = count ? `${(tk.issues || []).length} tickets` : 'sin conectar';
    $('#tk-close').checked = tk.close !== false;
    $('#tk-time').checked = tk.logTime !== false;

    // ---------- canal del equipo ----------
    const r = st.remote || { team: {}, phone: { telegram: {} } };
    const KIND = { slack: 'Slack', teams: 'Teams', discord: 'Discord', generic: 'webhook' };
    $('#team-status').textContent = r.team.configured ? `${r.team.on ? '✅' : '⏸️'} ${KIND[r.team.kind] || 'webhook'}` : 'sin conectar';
    $('#team-url').placeholder = r.team.configured ? '•••••••• (guardado; pega otro para cambiarlo)' : 'https://hooks.slack.com/… o la URL del flujo de Teams';
    $('#team-opts').classList.toggle('hidden', !r.team.configured);
    $('#team-on').checked = !!r.team.on;
    if (document.activeElement !== $('#team-daily')) $('#team-daily').value = r.team.daily || '';
    $('#team-weekly').checked = !!r.team.weekly;
    for (const c of $$('.team-cat')) c.checked = (r.team.cats || []).includes(c.value);

    // ---------- celular ----------
    const ph = r.phone;
    $('#phone-on').checked = !!ph.on;
    segOn($('#phone-via'), ph.via);
    segOn($('#phone-when'), ph.when);
    $('#ntfy-box').classList.toggle('hidden', ph.via !== 'ntfy');
    $('#tg-box').classList.toggle('hidden', ph.via !== 'telegram');
    $('#ntfy-topic').textContent = ph.ntfyTopic || '(se crea al activarlo)';
    const tg = ph.telegram || {};
    $('#tg-token').placeholder = tg.configured ? '•••••••• (guardado)' : '123456:ABC-…';
    $('#tg-state').innerHTML = !tg.configured ? ''
      : tg.paired ? `✅ Vinculado con <b>@${esc(tg.bot)}</b>`
        : `Abre <button type="button" class="link" data-open="https://t.me/${esc(tg.bot)}">@${esc(tg.bot)}</button> y envíale este código: <div class="pair-code">${esc(tg.code)}</div>`;
    for (const c of $$('.phone-cat')) c.checked = (ph.cats || []).includes(c.value);

    // ---------- Microsoft 365 / Google ----------
    const oa = st.oauthInfo || { microsoft: {}, google: {} };
    const ready = st.oauthReady || {};
    $('#oa-status').textContent = ready.microsoft || ready.google ? `✅ ${[ready.microsoft && 'Microsoft', ready.google && 'Google'].filter(Boolean).join(' + ')}` : 'sin configurar';
    $('#oa-ms-st').textContent = oa.microsoft.clientId ? `✅ ${oa.microsoft.clientId.slice(0, 8)}…${oa.microsoft.tenant ? ' · ' + oa.microsoft.tenant : ''}` : '';
    $('#oa-gg-st').textContent = oa.google.clientId ? `✅ ${oa.google.clientId.slice(0, 12)}…${oa.google.hasSecret ? '' : ' (falta el secreto)'}` : '';
    if (st.lang && st.lang !== 'es') I18N.translateDom(document.body, st.lang);
  }

  // ---------- Microsoft 365 / Google ----------
  for (const [id, prov] of [['#oa-ms', 'microsoft'], ['#oa-gg', 'google']]) {
    $(id).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const patch = {};
      for (const el of f.querySelectorAll('input')) patch[el.name] = el.value.trim();
      const r = await pm.saveOauth({ [prov]: patch });
      if (r.ok) for (const el of f.querySelectorAll('input')) el.value = '';
      msg($('#oa-msg'), r.ok, r.ok ? (r.ready[prov] ? '¡Listo! Ya puedes pulsar "Conectar" en 📬 Agenda.' : 'Guardado; falta completar algún dato.') : r.error);
    });
  }
  $('#oa-ms-del').addEventListener('click', () => pm.saveOauth({ remove: 'microsoft' }));
  $('#oa-gg-del').addEventListener('click', () => pm.saveOauth({ remove: 'google' }));

  // ---------- cola automática ----------
  $('#run-bin-pick').addEventListener('click', async () => { st = await pm.chooseClaudeBin(); render(); });
  $('#run-auto').addEventListener('change', (e) => pm.updateSettings({ claudeAutoRun: e.target.checked }));
  $('#run-tests').addEventListener('change', (e) => pm.updateSettings({ claudeRunTests: e.target.checked }));
  $('#run-limits').addEventListener('change', (e) => pm.updateSettings({ claudeRespectLimits: e.target.checked }));
  $('#run-limitpct').addEventListener('change', (e) => pm.updateSettings({ claudeLimitPct: Number(e.target.value) || 85 }));
  $('#run-modelauto').addEventListener('change', (e) => pm.updateSettings({ claudeModelAuto: e.target.checked }));
  $('#run-par').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pm.updateSettings({ claudeParallel: Number(b.dataset.v) }); });
  $('#run-review').addEventListener('change', (e) => pm.updateSettings({ claudeReview: e.target.checked }));
  $('#run-fixci').addEventListener('change', (e) => pm.updateSettings({ claudeAutoFixCi: e.target.checked }));
  $('#run-fixrev').addEventListener('change', (e) => pm.updateSettings({ claudeAutoFixReview: e.target.checked }));
  $('#run-maxfix').addEventListener('change', (e) => pm.updateSettings({ claudeMaxFixes: Number(e.target.value) || 0 }));
  $('#run-budget').addEventListener('change', (e) => pm.updateSettings({ claudeRunBudget: Number(e.target.value) || 0 }));

  // ---------- apariencia 2.0 ----------
  $('#pet-style').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pm.updateSettings({ petStyle: b.dataset.v }); });
  $('#pl-folder').addEventListener('click', () => pm.pluginsFolder());
  $('#pl-scan').addEventListener('click', () => pm.pluginsScan());
  $('#pl-example').addEventListener('click', () => pm.pluginsExample());
  $('#pl-list').addEventListener('change', async (e) => {
    const t = e.target.closest('.pl-toggle');
    if (!t) return;
    const p = (st.plugins.list || []).find((x) => x.id === t.dataset.id);
    // Activar pide tu permiso explícito, con la lista de lo que podrá hacer.
    if (t.checked && !confirm(`¿Activar "${p.name}"?\n\nPodrá:\n• ${p.perms.join('\n• ') || 'nada con PM'}\n\nSu código corre en tu PC: actívalo solo si confías en quien lo hizo.`)) { t.checked = false; return; }
    const r = await pm.pluginsEnable(p.id, t.checked);
    if (!r.ok) { t.checked = !t.checked; alert('😿 ' + r.error); }
  });
  $('#bx-copy').addEventListener('click', () => { navigator.clipboard.writeText($('#bx-token').value).catch(() => {}); $('#bx-copy').textContent = '✅ Copiado'; setTimeout(() => { $('#bx-copy').textContent = '📋 Copiar'; }, 1500); });
  $('#bx-regen').addEventListener('click', () => { if (confirm('¿Crear un código nuevo? La extensión tendrá que emparejarse otra vez.')) pm.browserRegen(); });
  $('#bx-folder').addEventListener('click', () => pm.browserFolder());
  $('#bx-block').addEventListener('change', (e) => pm.updateSettings({ focusBlock: e.target.checked }));
  $('#bx-sites').addEventListener('change', (e) => pm.browserSites(e.target.value));
  $('#pet-physics').addEventListener('change', (e) => pm.updateSettings({ petPhysics: e.target.checked }));
  $('#desktop-widget').addEventListener('change', () => pm.command('widget.toggle'));
  $('#pet-perch').addEventListener('change', (e) => pm.updateSettings({ petPerch: e.target.checked }));
  $('#pc-react').addEventListener('change', (e) => pm.updateSettings({ pcReactions: e.target.checked }));
  $('#type-along').addEventListener('change', (e) => pm.updateSettings({ typeAlong: e.target.checked }));
  $('#weather-city').addEventListener('change', (e) => pm.updateSettings({ weatherCity: e.target.value }));

  // ---------- productividad 2.0 ----------
  $('#s-endofday').addEventListener('change', (e) => e.target.value && pm.updateSettings({ endOfDay: e.target.value }));
  $('#s-ritual').addEventListener('change', (e) => pm.updateSettings({ closingRitual: e.target.checked }));
  $('#s-sumclaude').addEventListener('change', (e) => pm.updateSettings({ summaryWithClaude: e.target.checked }));
  $('#s-closeapps').addEventListener('change', (e) => pm.updateSettings({ closeApps: e.target.value }));
  $('#s-stuck').addEventListener('change', (e) => pm.updateSettings({ stuckDetector: e.target.checked }));
  $('#s-plancheck').addEventListener('change', (e) => pm.updateSettings({ planCheck: e.target.checked }));
  $('#s-besthour').addEventListener('change', (e) => pm.updateSettings({ bestHour: e.target.checked }));
  $('#s-myname').addEventListener('change', (e) => pm.updateSettings({ myName: e.target.value }));

  // ---------- informe de errores ----------
  $('#err-on').addEventListener('change', (e) => pm.errorsConsent(e.target.checked));
  $('#err-send').addEventListener('click', async () => {
    const r = await pm.errorsSend();
    msg($('#err-msg'), r.ok, r.ok ? (r.sent ? `Enviado${r.sent === 1 ? '' : 's'} ${r.sent}. ¡Gracias!` : 'No hay errores nuevos que enviar ✨') : r.error);
  });

  // ---------- configuración del equipo ----------
  $('#tp-export').addEventListener('click', async () => {
    const withHook = $('#tp-webhook').checked;
    if (withHook && !confirm('El webhook permite publicar en el canal: compártelo solo con tu equipo. ¿Incluirlo?')) return;
    const r = await pm.teamExport({ name: $('#tp-name').value.trim(), includeWebhook: withHook });
    if (r.canceled) return;
    msg($('#tp-msg'), r.ok, r.ok ? `Guardado en ${r.file}. Pásaselo a tu equipo: en PM → Ajustes → Integraciones → Importar.` : r.error);
  });
  $('#tp-import').addEventListener('click', async () => {
    const r = await pm.teamImport();
    if (r.canceled) return;
    if (!r.ok) return msg($('#tp-msg'), false, r.error);
    $('#tp-msg').className = 'small okmsg';
    $('#tp-msg').innerHTML = `¡Listo${r.name ? `: ${esc(r.name)}` : ''}!${r.todo.length ? ' Te falta tu parte:<ul>' + r.todo.map((t) => `<li>${esc(t)}</li>`).join('') + '</ul>' : ''}`;
  });
  $('#run-perm').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.v === 'bypassPermissions' && !confirm('Con "Todo", Claude puede ejecutar cualquier comando sin preguntarte (dentro de la copia aparte del repo, pero con acceso a tu PC). ¿Seguro?')) return;
    pm.updateSettings({ claudeRunPermission: b.dataset.v });
  });

  // ---------- tickets ----------
  for (const d of $$('details.tk[data-p]')) {
    const p = d.dataset.p;
    const f = d.querySelector('form');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const patch = {};
      for (const k of ['site', 'email', 'org', 'token']) if (f[k]) patch[k] = f[k].value.trim();
      if (p === 'github') patch.on = true;
      $('#tk-msg').className = 'small muted';
      $('#tk-msg').textContent = '⏳ Conectando…';
      const r = await pm.ticketsSave(p, patch);
      if (f.token) f.token.value = '';
      msg($('#tk-msg'), r.ok, r.ok ? `¡Conectado! ${r.count} ticket${r.count === 1 ? '' : 's'} asignado${r.count === 1 ? '' : 's'}. Los verás en 📋 Día.` : r.error);
    });
    d.querySelector('.tk-del').addEventListener('click', async () => {
      await pm.ticketsSave(p, { remove: true });
      $('#tk-msg').textContent = '';
    });
  }
  $('#tk-close').addEventListener('change', (e) => pm.updateSettings({ trackersClose: e.target.checked }));
  $('#tk-time').addEventListener('change', (e) => pm.updateSettings({ trackersLogTime: e.target.checked }));

  // ---------- canal del equipo ----------
  $('#team-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = $('#team-url').value.trim();
    if (!u) return;
    const r = await pm.remoteSave({ teamWebhook: u });
    $('#team-url').value = '';
    msg($('#team-msg'), r.ok, r.ok ? 'Guardado. Pulsa "Probar" para ver el mensaje en el canal.' : r.error);
  });
  $('#team-on').addEventListener('change', (e) => pm.remoteSave({ teamOn: e.target.checked }));
  $('#team-daily').addEventListener('change', (e) => pm.remoteSave({ teamDaily: e.target.value }));
  $('#team-weekly').addEventListener('change', (e) => pm.remoteSave({ teamWeekly: e.target.checked }));
  for (const c of $$('.team-cat')) c.addEventListener('change', () => pm.remoteSave({ teamCats: $$('.team-cat').filter((x) => x.checked).map((x) => x.value) }));
  $('#team-test').addEventListener('click', async () => { const r = await pm.remoteTest('team'); msg($('#team-msg'), r.ok, r.ok ? '✅ Mensaje enviado al canal' : r.error); });
  $('#team-daily-now').addEventListener('click', async () => { const r = await pm.remotePost('daily'); msg($('#team-msg'), r.ok, r.ok ? '✅ Daily publicado' : r.error); });
  $('#team-weekly-now').addEventListener('click', async () => { const r = await pm.remotePost('weekly'); msg($('#team-msg'), r.ok, r.ok ? '✅ Informe publicado' : r.error); });
  $('#team-remove').addEventListener('click', async () => { if (confirm('¿Quitar el webhook del canal?')) { await pm.remoteSave({ teamWebhook: '', teamOn: false }); $('#team-msg').textContent = ''; } });

  // ---------- celular ----------
  $('#phone-on').addEventListener('change', (e) => pm.remoteSave({ phoneOn: e.target.checked }));
  $('#phone-via').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pm.remoteSave({ phoneVia: b.dataset.v }); });
  $('#phone-when').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pm.remoteSave({ phoneWhen: b.dataset.v }); });
  for (const c of $$('.phone-cat')) c.addEventListener('change', () => pm.remoteSave({ phoneCats: $$('.phone-cat').filter((x) => x.checked).map((x) => x.value) }));
  $('#ntfy-copy').addEventListener('click', () => pm.copy($('#ntfy-topic').textContent));
  $('#ntfy-new').addEventListener('click', () => { if (confirm('¿Crear un tema nuevo? Tendrás que suscribirte otra vez en la app ntfy.')) pm.remoteSave({ newNtfyTopic: true }); });
  $('#tg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = $('#tg-token').value.trim();
    if (!t) return;
    $('#phone-msg').className = 'small muted';
    $('#phone-msg').textContent = '⏳ Comprobando el bot…';
    const r = await pm.remoteSave({ telegramToken: t, phoneVia: 'telegram' });
    $('#tg-token').value = '';
    msg($('#phone-msg'), r.ok, r.ok ? 'Bot listo. Envíale el código para vincularlo.' : r.error);
  });
  $('#phone-test').addEventListener('click', async () => { const r = await pm.remoteTest('phone'); msg($('#phone-msg'), r.ok, r.ok ? '✅ Enviado: mira tu celular' : r.error); });

  pm.onState((s) => { st = s; render(); });
  pm.getState().then((s) => { st = s; render(); });
})();
