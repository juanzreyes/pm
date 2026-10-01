# Plugins de PM Pollito

Un plugin es una carpeta con un `plugin.json` y su código JavaScript. PM lo ejecuta en un **proceso aparte**: si falla o se cuelga, PM sigue funcionando.

## Dónde van

`%APPDATA%\pm-pollito\plugins\<id>\` (en PM: **Ajustes → Plugins → Abrir la carpeta de plugins**).
El botón **Instalar el ejemplo** copia `hola-pollito` ahí para que lo uses como punto de partida.

Un plugin nuevo aparece **desactivado**. Al activarlo, PM te muestra los permisos que pide y tienes que aceptarlos.

## plugin.json

```json
{
  "id": "mi-plugin",
  "name": "Mi plugin",
  "version": "1.0.0",
  "description": "Qué hace, en una frase.",
  "author": "Tu nombre",
  "main": "index.js",
  "permissions": ["say", "tasks", "notes", "commands", "events", "status", "storage"]
}
```

- `id`: de 3 a 40 letras minúsculas, números o guiones (único).
- `main`: archivo de entrada, dentro de la carpeta del plugin.
- `permissions`: pide solo lo que necesites.

| Permiso | Qué permite |
|---|---|
| `say` | Hablar por el pollito (máx. una burbuja cada 10 s) |
| `tasks` | Añadir tareas a tu día |
| `notes` | Escribir en tus notas de hoy |
| `commands` | Añadir comandos a la paleta (máx. 20) |
| `events` | Enterarse de tareas hechas, foco, pomodoros, Claude |
| `status` | Leer tus límites de Claude, tareas de hoy y si estás en foco |
| `storage` | Guardar sus propios datos (máx. 256 KB) |

## La API: `activate(pm)`

```js
module.exports.activate = async (pm) => {
  pm.say('¡Hola!');                                   // say
  pm.addTask('Revisar el PR del carrito');           // tasks
  pm.addNote('Decidimos usar Postgres');             // notes
  pm.registerCommand({ id: 'saludo', label: 'Saludar', icon: '👋' }, () => pm.say('👋'));  // commands
  pm.on('task:done', (t) => pm.say(`¡Bien! ${t.text}`));                                   // events
  const st = await pm.getStatus();                   // status → { name, session: { pct }, weekly, tasks: { done, total }, focus, pomo }
  await pm.storage.set('contador', 1);               // storage
  const n = await pm.storage.get('contador');
  pm.log('se ve en Ajustes → Diagnóstico');
};
```

### Eventos

| Evento | Datos |
|---|---|
| `task:done` | `{ text, all }` (`all`: era la última del día) |
| `focus:start` / `focus:end` | `{ mode }` (`manual`, `block` o `pomodoro`) |
| `pomodoro:done` | `{ count }` (pomodoros de hoy) |
| `claude:done` | `{ project }` |
| `day:start` | `{ tasks }` (al hacer el daily) |

## Seguridad

Los permisos limitan lo que el plugin puede hacer **con PM**, pero el código corre en tu PC como cualquier programa (como las extensiones de VS Code). Instala solo plugins de personas en las que confíes y revisa su código.
