// os de Node en Android: lo justo para nombres de dispositivo y rutas.
const name = () => (globalThis.__pmDevice && globalThis.__pmDevice.name) || 'Android';
module.exports = {
  hostname: name,
  homedir: () => '/home',
  tmpdir: () => '/tmp',
  platform: () => 'android',
  type: () => 'Android',
  release: () => (globalThis.__pmDevice && globalThis.__pmDevice.osVersion) || '',
  arch: () => 'arm64',
  uptime: () => Math.floor(performance.now() / 1000),
  userInfo: () => ({ username: 'android', homedir: '/home', uid: 0, gid: 0, shell: null }),
  cpus: () => Array.from({ length: (navigator.hardwareConcurrency || 4) }, () => ({ model: 'ARM', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } })),
  totalmem: () => ((navigator.deviceMemory || 4) * 1024 ** 3),
  freemem: () => ((navigator.deviceMemory || 4) * 1024 ** 3) / 2,
  loadavg: () => [0, 0, 0],
  networkInterfaces: () => ({}),
  EOL: '\n',
  constants: { signals: {} },
};
