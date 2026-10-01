// Rutas de la línea de comandos "pm" y del puente MCP, según cómo se instaló PM.
// Instalador normal: el ejecutable y los scripts están en una carpeta fija.
// Microsoft Store (MSIX): la carpeta del paquete cambia con cada actualización y Windows
// virtualiza lo que la app escribe en AppData, así que se usa:
//  - el alias de ejecución "pm-pollito.exe" (declarado en build/appx-extensions.xml), que
//    Windows mantiene en %LOCALAPPDATA%\Microsoft\WindowsApps y apunta siempre a la versión actual;
//  - una copia de los scripts en ~/.pm-pollito/bin (fuera de AppData: no se virtualiza), que PM
//    refresca en cada arranque.
const path = require('path');

const unpacked = (p) => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

/**
 * @param {{ store: boolean, home: string, localAppData: string, appDir: string, execPath: string }} o
 */
function paths({ store, home, localAppData, appDir, execPath }) {
  const srcCli = unpacked(path.join(appDir, 'cli', 'pm.js'));
  const srcBridge = unpacked(path.join(appDir, 'mcp', 'bridge.js'));
  if (!store) {
    const dir = path.join(localAppData, 'Microsoft', 'WindowsApps');
    return { store: false, exe: execPath, cli: { script: srcCli, dir, file: path.join(dir, 'pm.cmd'), onPath: true }, bridge: srcBridge, copies: [] };
  }
  const bin = path.join(home, '.pm-pollito', 'bin');
  return {
    store: true,
    exe: path.join(localAppData, 'Microsoft', 'WindowsApps', 'pm-pollito.exe'),
    cli: { script: path.join(bin, 'pm.js'), dir: bin, file: path.join(bin, 'pm.cmd'), onPath: false },
    bridge: path.join(bin, 'bridge.js'),
    copies: [[srcCli, path.join(bin, 'pm.js')], [srcBridge, path.join(bin, 'bridge.js')]],
  };
}

/** Contenido de pm.cmd. */
function cliCmd(exe, script) {
  return ['@echo off', 'rem PM Pollito: linea de comandos del pollito', 'chcp 65001 >nul', 'setlocal',
    'set ELECTRON_RUN_AS_NODE=1', `"${exe}" "${script}" %*`, ''].join('\r\n');
}

/** Comando de PowerShell para añadir la carpeta al PATH de tu usuario (en la Store no se puede hacer desde la app). */
const pathCommand = (dir) => `[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';${dir}', 'User')`;

module.exports = { paths, cliCmd, pathCommand };
