// Plugin de ejemplo de PM Pollito. Cópialo, cambia el "id" de plugin.json y hazlo tuyo.
// Documentación: PLUGINS.md en el repositorio de PM Pollito.
const FRASES = [
  'Un paso pequeño también es avanzar 🐾',
  'Termina una cosa antes de empezar otra ✨',
  'Hoy mejor que ayer, mañana mejor que hoy 💪',
  'Si se puede hacer en 2 minutos, hazlo ya ⏱️',
];

module.exports.activate = async (pm) => {
  // Un comando en la paleta (Ctrl+Alt+Espacio).
  pm.registerCommand({ id: 'frase', label: 'Una frase para arrancar', icon: '💬' }, () => {
    pm.say(FRASES[Math.floor(Math.random() * FRASES.length)]);
  });

  // Cada 5 tareas hechas, una celebración (el contador se guarda entre reinicios).
  pm.on('task:done', async () => {
    const n = ((await pm.storage.get('tareas')) || 0) + 1;
    await pm.storage.set('tareas', n);
    if (n % 5 === 0) pm.say(`¡Llevas ${n} tareas hechas desde que me instalaste! 🎉`);
  });

  // Tras un pomodoro, si la sesión de Claude va alta, sugiere parar un rato.
  pm.on('pomodoro:done', async () => {
    const st = await pm.getStatus();
    if (st.session && st.session.pct >= 80) pm.say(`Tu sesión de Claude va al ${st.session.pct}%: buen momento para una pausa ☕`);
  });

  pm.log('Hola, pollito: listo');
};
