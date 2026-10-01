// Pantalla del pollito en lugar del sitio que distrae. La URL original viene tras el "#".
/* global chrome */
const $ = (s) => document.querySelector(s);
const original = location.hash.slice(1);
const host = self.PMExt.hostOf(original);
if (host) $('#host').textContent = host;
chrome.runtime.sendMessage({ type: 'blocked', host });
chrome.storage.session.get('status').then(({ status }) => {
  if (status && status.focus && status.focus.until) $('#left').textContent = `Quedan ${self.PMExt.minsLeft(status.focus.until)} min de foco.`;
});
$('#back').addEventListener('click', () => (history.length > 1 ? history.back() : window.close()));
$('#snooze').addEventListener('click', async () => {
  await new Promise((ok) => chrome.runtime.sendMessage({ type: 'snooze' }, ok));
  if (/^https?:\/\//.test(original)) location.replace(original);
});
