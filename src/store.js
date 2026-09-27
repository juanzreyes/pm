// Persistencia en JSON dentro de la carpeta de datos de la app.
// Escribe de forma atómica y guarda una copia de respaldo (.bak) para no perder nunca la memoria.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  pet: {
    name: '',
    born: null,
    happiness: 80, // 0-100
    fullness: 80, // 0-100 (pancita llena)
    lastTick: null,
    lastPetAt: 0,
    xp: 0,
    clean: 100, // limpieza
    energy: 100, // energía
    sick: false,
  },
  settings: {
    morningTime: '08:00',
    eveningTime: '16:30',
    workdaysOnly: false,
    autoStart: false,
    manualToken: '', // cifrado con safeStorage (base64)
    chatter: true,
    focusWatch: true, // vigilar distracciones
    sounds: true, // píos
    muteUntil: 0, // modo silencio (reuniones)
    autoStartAsked: false,
    accounts: {}, // cuentas con inicio de sesión web: { microsoft: {...}, google: {...} }
    theme: 'system', // 'system' | 'light' | 'dark'
    petSize: 'm', // 's' | 'm' | 'l'
    discreet: false, // se esconde en el borde de la pantalla
    reducedMotion: false,
    volume: 70,
    voice: true, // leer en voz alta los avisos importantes
    micWatch: true, // detectar reuniones por el micrófono (sin grabar nada)
    gitWatch: true,
    trackingPausedUntil: 0,
  },
  // Memoria de la vida del pollito entre aperturas.
  life: {
    running: false, // si queda en true al arrancar = lo cerraron de golpe
    lastStart: null,
    lastQuitAt: null,
    lastQuitHow: null, // 'user' | 'shutdown'
    closes: 0,
    crashes: 0,
    angryUntil: 0,
    lastView: 'chat',
    lastSaid: '',
  },
  web: { orgId: null, orgName: null }, // sesión de claude.ai (las cookies viven en la partición de Electron)
  position: null, // {x, y}
  days: {}, // 'YYYY-MM-DD' -> { standup, review, focus, snoozeStandup, snoozeReview }
  alerts: {}, // '<limite>|<resets_at>' -> [umbrales ya avisados]
  chat: [],
};

function merge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = merge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'pm-data.json');
    this.bak = this.file + '.bak';
    this.data = structuredClone(DEFAULTS);
    for (const f of [this.file, this.bak]) {
      try {
        this.data = merge(DEFAULTS, JSON.parse(fs.readFileSync(f, 'utf8')));
        break;
      } catch {
        /* no existe o está dañado: prueba el respaldo */
      }
    }
    this._timer = null;
  }

  /** Guarda en breve (agrupa cambios seguidos). */
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 250);
  }

  /** Guarda ya mismo, de forma síncrona. */
  flush() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const json = JSON.stringify(this.data, null, 2);
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, json);
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.bak);
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('No se pudo guardar:', e.message);
    }
  }
}

module.exports = { Store };
