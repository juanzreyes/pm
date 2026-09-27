const input = document.getElementById('t');
const msg = document.getElementById('m');
input.focus();

pm.onCaptureOpen(() => {
  pm.getState().then((s) => { if (s.lang === "en") I18N.translateDom(document.body, "en"); }).catch(() => {});
  input.value = '';
  msg.textContent = '';
  setTimeout(() => input.focus(), 30);
});

input.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    pm.captureClose();
  } else if (e.key === 'Enter') {
    const text = input.value.trim();
    if (!text) return pm.captureClose();
    input.value = '';
    await pm.captureSubmit(text);
  }
});
