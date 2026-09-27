// Predicción de consumo: a partir de las últimas lecturas del límite calcula el ritmo (%/hora)
// y a qué hora llegarías al 100% si sigues igual.

/**
 * samples: [{ t, u, r }]  (t = hora de la lectura, u = % usado, r = hora de reinicio de esa ventana)
 * limit:   { utilization, resetsAt }
 * windowMs: cuánto historial mirar (p. ej. 90 min para la sesión de 5 h)
 */
function forecast(samples, limit, windowMs) {
  if (!limit || !limit.resetsAt) return null;
  const now = Date.now();
  const resetAt = Date.parse(limit.resetsAt);
  // Solo lecturas de la ventana actual (mismo reinicio, con 10 min de margen) y recientes.
  const pts = samples.filter((s) => Math.abs(s.r - resetAt) < 10 * 60e3 && now - s.t <= windowMs);
  if (pts.length < 2 || pts[pts.length - 1].t - pts[0].t < 8 * 60e3) return { rate: null, eta: null, resetAt };

  // Regresión lineal: % frente al tiempo.
  const n = pts.length;
  const mt = pts.reduce((a, p) => a + p.t, 0) / n;
  const mu = pts.reduce((a, p) => a + p.u, 0) / n;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.t - mt) * (p.u - mu); den += (p.t - mt) ** 2; }
  const perMs = den ? num / den : 0;
  const rate = perMs * 3600e3; // % por hora

  if (rate <= 0.3) return { rate: Math.max(0, rate), eta: null, willHit: false, resetAt };
  const eta = now + ((100 - limit.utilization) / rate) * 3600e3;
  return { rate, eta, willHit: eta < resetAt, beforeReset: resetAt - eta, resetAt };
}

module.exports = { forecast };
