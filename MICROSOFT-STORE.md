# Publicar PM Pollito en la Microsoft Store

El proyecto ya está preparado para la Store (paquete `.appx`/MSIX). Lo único que falta son **los datos de tu cuenta** de Partner Center, que no se suben a git.

## 1. Cuenta y nombre (una sola vez)

1. Crea una cuenta de desarrollador en [Partner Center](https://partner.microsoft.com/dashboard) (cuenta individual: pago único).
2. **Aplicaciones y juegos → Nuevo producto → Aplicación MSIX o PWA** y reserva el nombre (por ejemplo, *PM Pollito*).
3. En tu app: **Administración de productos → Identidad del producto**. Copia estos tres valores:
   - `Package/Identity/Name` → `identityName`
   - `Package/Identity/Publisher` → `publisher` (empieza por `CN=`)
   - `Package/Properties/PublisherDisplayName` → `publisherDisplayName`

## 2. `store.config.json`

En la raíz del proyecto (está en `.gitignore`):

```json
{
  "identityName": "12345TuNombre.PMPollito",
  "publisher": "CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
  "publisherDisplayName": "Tu nombre"
}
```

## 3. Compilar

```bash
npm run dist:store
```

Genera `dist/PM-Pollito-<versión>.appx`. Si tienes el SDK de Windows instalado se usa su `makeappx`; los logos salen de `build/appx/` (se regeneran con `npx electron scripts/make-appx-assets.js`). No hace falta certificado: la Store firma el paquete.

## 4. Envío en Partner Center

- **Paquetes**: sube el `.appx`.
- **Propiedades**: categoría *Productividad*.
- **Clasificación por edades**: el cuestionario (sin contenido sensible).
- **Directiva de privacidad**: obligatoria, porque PM lee el nombre de la ventana activa para medir tu foco. Puedes publicar la sección de privacidad del README en una página (por ejemplo, GitHub Pages) y poner esa URL. Todo se guarda en el PC del usuario.
- **Capacidad `runFullTrust`**: la añade electron-builder (toda app de escritorio empaquetada la necesita). Si te piden justificarla: *"Aplicación de escritorio Win32 (Electron) empaquetada con MSIX; necesita confianza completa para su bandeja del sistema, la ventana flotante y el servidor local de integraciones."*
- **Descripción y capturas**: al menos una captura de 1366×768 o mayor.

La certificación suele tardar de unas horas a 3 días.

## Qué cambia en la versión de la Store

| | Instalador normal | Microsoft Store |
|---|---|---|
| Actualizaciones | Solas, desde GitHub Releases | Las pone la Store (el actualizador interno se desactiva) |
| Inicio con Windows | Ajustes de PM | Configuración de Windows → Aplicaciones → Inicio (PM abre esa pantalla) |
| Comando `pm` | Se instala solo en el PATH | En `%USERPROFILE%\.pm-pollito\bin`; PM te da el comando para añadirlo al PATH una vez |
| MCP en Claude Desktop | Ruta del ejecutable | Alias estable `pm-pollito.exe` + copia del puente en `~/.pm-pollito/bin` |

Las rutas de la Store cambian con cada versión y Windows virtualiza lo que la app escribe en AppData; por eso la CLI y el MCP usan el alias de ejecución (declarado en `build/appx-extensions.xml`) y copias estables de los scripts, que PM refresca en cada arranque.

> ⚠️ Probado: el paquete compila y su manifiesto es válido (alias, tarea de inicio, logos). **No probado** todavía: instalar el `.appx` (necesita firma o la Store) y que el alias pase `ELECTRON_RUN_AS_NODE` a la CLI. Pruébalo con el primer envío "privado" (visibilidad oculta) antes de publicarlo.
