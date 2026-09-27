# 🐣 PM — tu pollito Project Manager

Widget de escritorio con un pollito tamagotchi que vive encima de todas tus ventanas, vigila cuánto llevas gastado de tus límites de Claude y te acompaña en tu día.

## Qué hace

- **Siempre encima y siempre vivo.** Respira, parpadea, pasea, picotea, aletea, baila y te sigue con la mirada.
- **Lo puedes mover.** Arrástralo a cualquier sitio del escritorio y recuerda dónde lo dejaste.
- **Avisos de consumo animados.** Te avisa al 25 %, 50 %, 75 %, 90 % y 100 % de tu sesión de 5 h y de tu límite semanal. Cuanto más cerca estás del límite, más se agobia: suda, entra en pánico o se desmaya. Cuando el límite se reinicia, lo celebra 🎉.
- **Clic = panel.** Chatea con él ("¿cuánto llevo?", "¿cuándo se reinicia?", "tokens de hoy", "mis tareas", "ayuda") y consulta tus estadísticas.
- **Daily a las 8:00.** Te pregunta qué hiciste ayer, qué vas a hacer hoy (cada respuesta queda como tarea) y en qué te puede ayudar.
- **Cierre a las 16:30.** Antes de las 5 te pregunta si cumpliste lo que dijiste y puede pasar lo pendiente a mañana.
- **Mascota.** Le pones nombre y tiene felicidad y pancita: dale de comer 🌽 y acarícialo (frota el ratón encima) 💛.
- **Memoria.** Recuerda todo entre aperturas: nombre, chat, tareas, posición, historial, la última pestaña… (con copia de respaldo).
- **Rencoroso.** Si lo cierras, pide confirmación 🥺; la próxima vez que lo abras estará **enojado** 😤 (y más aún si lo mataste de golpe). Se le pasa con mimos, maicito o diciéndole "perdón". Si solo apagaste el PC, te perdona.
- **Vigila tu productividad.** Sabe qué ventana tienes delante (solo en tu PC). Si ves YouTube, Netflix, redes, etc. te mira con cara de 🤨; a los 10, 20, 30 min te regaña cada vez más fuerte 💢, y te felicita cuando vuelves a trabajar. Si llevas 20 min sin tocar nada, pregunta si sigues ahí. En 📋 Día ves tu tiempo de trabajo vs. distracciones.
- **"Es trabajo".** Si te regaña por un tutorial de YouTube, dile "es trabajo" y ese sitio cuenta como trabajo el resto del día.
- **Silencio.** Clic derecho → *Silenciar 1 hora* (o escríbele "silencio") para reuniones; solo avisará de tus límites.
- **Clic derecho** en el pollito: menú rápido (comer, acariciar, daily, cierre, silenciar, ocultar, cerrar).
- **Niveles.** Gana XP con tareas completadas, daily, cierre, horas enfocadas y mimos. Nivel 3: corbatín 🎀 · nivel 8: corona 👑.
- **Sonidos de pío** sintetizados (se pueden apagar) y notificaciones de Windows si el pollito está oculto.
- **Arranca con Windows** automáticamente (se puede quitar en 🐣 Mascota → Rutina).
- **📬 Agenda: reuniones de Teams.** Pega el enlace ICS de tu calendario (Outlook / Microsoft 365 / Google) y te avisa 10 min antes de cada reunión y al empezar, con botón **Unirse** (Teams, Meet, Zoom, Webex).
- **Detecta reuniones en vivo.** Si una app usa tu micrófono o hay una ventana de reunión de Teams, se pone audífonos 🎧, se calla y no te regaña; al terminar te pregunta si salió alguna tarea.
- **📧 Correo.** Conecta Gmail, Yahoo, iCloud u otro IMAP con una *contraseña de aplicación*: te avisa de correos nuevos y te dice cuántos tienes sin leer (solo lee remitente y asunto). Microsoft suele bloquear IMAP en Outlook/Hotmail.

### Productividad
- **🤖 Claude Code.** En 🐣 Perfil → Integraciones → *Conectar con Claude Code*: añade hooks a `~/.claude/settings.json` (con copia `.pm-backup`). El pollito muestra una burbuja 💭 mientras Claude trabaja, avisa cuando termina ("¡Claude terminó en *proyecto*!") y cuando necesita tu permiso. Si PM está cerrado, los hooks fallan en silencio.
- **🍅 Pomodoro.** 25 min de concentración + 5 de descanso (15 cada 4). El pollito se pone una bandana, muestra la cuenta atrás y te regaña cada 2 min (no 10) si te distraes. +10 XP por pomodoro.
- **✍️ Captura rápida: `Ctrl+Alt+P`** desde cualquier app. Escribe una tarea, o un recordatorio con hora: "recuérdame a las 3 revisar el informe", "en 20 min llamar a Ana", "mañana a las 9:30 la demo".
- **💻 Git.** Vigila tus repos (carpeta configurable): el daily se rellena solo con tus commits del último día laborable, avisa si llevas 3 h sin commit o si haces cambios directos en `main`, y celebra cada commit (+2 XP).
- **🐙 GitHub** (token personal): PRs que esperan tu revisión y estado de los tuyos; avisa si falla el CI, si aprueban o piden cambios y si hay comentarios nuevos.
- **📊 Informe semanal y 📋 daily para copiar** (formato Slack/Teams). Los viernes, tras el cierre, el pollito te ofrece el informe.
- **⏱️ Tiempo por proyecto** (detectado desde VS Code, Cursor, JetBrains, terminal…) con exportación a CSV para Excel.
- **🧘 Salud.** Pausa activa cada 50 min de actividad continua, regla 20-20-20 para la vista y recordatorio de agua (cada uno se puede apagar). No interrumpe en reuniones ni pomodoros.

### Más
- **🤖 IA de verdad** (🐣 Perfil → IA): con una API key de Anthropic el chat responde cualquier cosa con el contexto real de tu día y puede **añadir/completar tareas, crear recordatorios y empezar pomodoros**. El informe y el daily tienen botón **✨ Mejorar con IA**. Modelo por defecto: Claude Opus 5 (esfuerzo bajo, rápido); se puede cambiar a Sonnet 5 o Haiku 4.5.
- **🙈 Se esconde al presentar**: si compartes pantalla en Teams o hay una ventana a pantalla completa (PowerPoint, vídeo, juego), el pollito y sus avisos desaparecen y te cuenta lo que pasó al terminar.
- **📈 Estadísticas del mes**: mapa de calor de horas, trabajo vs distracción, tareas cumplidas vs planeadas, tokens de Claude por día y proyectos.
- **🏅 Logros y 🔥 rachas**: 19 logros (racha de dailies, día perfecto, madrugador, tomatero, cero distracciones, commitero…).
- **🐓 Evolución y 🛍️ tienda**: pollito → pollo joven (nivel 5) → gallo (nivel 10). Con el 🌽 maíz (1 por XP + logros + minijuego) compras gorros, gafas, bufanda, corbata, capa y colores de plumas.
- **🎮 Minijuego "Atrapa el maíz"** (45 s) desde el clic derecho o 🐣 Perfil.
- **🌐 Mis sitios** (📬 Agenda): vigila URLs (webs, APIs, `localhost`) cada 2 min y avisa si se caen o vuelven.
- **🌐 Español / English** (🐣 Perfil → Idioma).

### Experiencia de uso
- **Botones en los avisos**: los bocadillos traen acciones directas (`Unirme`, `Posponer 10 min`, `Es trabajo`, `Hacer daily`, `Otro pomodoro`…).
- **🔍 Paleta de comandos** (`Ctrl+Alt+Espacio` desde cualquier app, o `Ctrl+K` en el panel): busca y ejecuta cualquier acción; con texto libre, lo anota o se lo pregunta al pollito.
- **🔔 Centro de avisos**: historial con filtros y contador de no leídos (en el pollito y en el panel).
- **⚙️ Ventana de ajustes** con buscador: General, Apariencia (tema oscuro, tamaño, modo discreto, menos animación, volumen), Salud, Privacidad y datos (pausar seguimiento, exportar/importar/borrar), Integraciones, Cuenta de Claude, IA, Atajos y Acerca de.
- **Tareas editables**: doble clic para editar, arrastrar para ordenar, prioridad por colores, hora con recordatorio y "Deshacer" al borrar.
- **Tour de bienvenida** y lista "Configura tu pollito"; atajos `1`–`5`, `/`, `N`, `P`, `Esc`.
- **Vida en reposo**: cuando está tranquilo revisa su portapapeles de PM, teclea en su portátil, toma café, hace globos de chicle, canta, se rasca, se acicala, saluda, estornuda, tiene hipo, se sienta, gira y persigue mariposas (según la hora del día).
- **Acerca de**: *Hecho con ❤️ por Juanzreyes*.

### Claude, bienestar y tamagotchi
- **🔮 Predicción de consumo**: calcula tu ritmo (%/h) y te avisa antes: *"llegarás al 100% a las 16:40, 1 h antes del reinicio"* (sesión y semanal).
- **💵 Coste por proyecto**: coste equivalente en la API (hoy, 7 días y por proyecto) a partir de los registros de Claude Code. Pregúntale "¿cuánto me cuesta?".
- **Icono de la bandeja con anillo**: % de la sesión (verde → rojo) o la cuenta atrás del pomodoro.
- **⏱️ Cronómetro por tarea** con estimación (doble clic en el reloj): aprende cuánto sueles desviarte.
- **Ánimo del día** en el cierre, **alerta de agotamiento** (días largos, noches, fines de semana, ánimo bajo) y **🧠 tus patrones** (mejor franja horaria, día más productivo, días de más distracción).
- **Más tamagotchi**: limpieza 🧼 (bañarlo), energía ⚡ (siesta y dormir de noche) y enfermedad 🤒 (medicina por 25 🌽).
- **Temporadas y cumpleaños**: gorro de Papá Noel y nieve en Navidad, calabaza y murciélagos en Halloween, fiesta en Año Nuevo, San Valentín y el cumpleaños del pollito.
- **🔊 Voz**: lee en voz alta los avisos importantes con las voces de Windows (sin internet).

### Planificación, Claude y juego
- **🤖 Diario automático de Claude Code**: lo que le pediste a Claude en cada proyecto aparece en *Día → Hoy con Claude* (con ✨ resumen por IA), en tu daily de mañana y en el daily para Slack/Teams.
- **💡 Consejo de modelo**: si vas camino del límite y casi todo es Opus, te sugiere `/model sonnet` (botón para copiarlo) y te avisa al reiniciarse para volver.
- **📚 Biblioteca de prompts**: tus prompts favoritos a un clic (chat → 📚 Prompts o la paleta). `{{clipboard}}` se sustituye por lo que tengas copiado.
- **🐞 Portapapeles inteligente**: si copias un error (stack trace, excepción, npm ERR!…), te ofrece preguntar a la IA, copiar un prompt listo para Claude o guardarlo como tarea. Se puede desactivar en Privacidad.
- **🗓️ Bloques de tiempo**: arrastra tus tareas a una línea de horas (con tus reuniones); te avisa al empezar cada bloque con botones de pomodoro y cronómetro.
- **🎯 Objetivos semanales** con progreso (aparecen en el informe semanal; los lunes te propone definirlos).
- **💧 Hábitos con rachas** 🔥: agua, moverte, leer, dormir temprano o los tuyos (clic +1, clic derecho −1).
- **🗒️ Notas rápidas del día** con autoguardado y buscador en notas de otros días.
- **Jugar con el pollito**: lánzale maíz 🌽, juega a la pelota ⚽ o sale a **pasear por la barra de tareas** 🚶 (y lo hace solo de vez en cuando).
- **🐾 Especies**: pollito, patito, gatito o pingüino (Perfil → Especie) y **amiguitos** en la tienda (🐤 / 🦆).
- **🖥️ Sigue tu monitor**: con varias pantallas, se cambia a la pantalla donde estás trabajando.
- **💾 Copia de seguridad automática semanal** en OneDrive / Google Drive (o Documentos), conserva las 6 últimas y sin claves.
- **📄 Informe mensual en PDF**: horas por día, proyectos, tareas, coste de Claude y logros del mes (Día, Estadísticas o la paleta; el día 1 te lo ofrece).

### Foco, rutinas y diagnóstico
- **🎯 Modo foco ("no me distraigas")**: 25/50/90 min desde *Día*, la paleta o el chat ("modo foco 30 min"). Solo pasan los avisos urgentes (reuniones, recordatorios, Claude, límites); el resto espera en el centro de avisos y te regaña al minuto si te distraes. Se activa solo durante tus bloques de tiempo y pomodoros (configurable en Ajustes → General).
- **🔁 Tareas recurrentes**: "cada lunes: revisar métricas", "todos los días: leer correo", "cada lunes y jueves: 1:1 con Ana" (chat, paleta o Ctrl+Alt+P). Se añaden solas a tu daily.
- **🧩 Plantillas de día**: Día de foco, de reuniones o de bugs (bloques + tareas en un clic, saltando lo que choca con reuniones). Guarda tu día como plantilla.
- **🔍 Búsqueda global**: la paleta (Ctrl+Alt+Espacio) busca también en tareas, recordatorios, notas, prompts, objetivos, avisos y el diario de Claude.
- **🩺 Diagnóstico** (Ajustes → Diagnóstico): memoria, CPU, últimos errores y "Copiar informe" (sin datos personales). Los errores se guardan en `pm-errors.log`.
- **🎁 Novedades** al actualizar y elección de especie desde la bienvenida.

### Extensión para VS Code
En `vscode-extension/`: el pollito en la barra de estado de VS Code (% de sesión, pomodoro, cronómetro, tareas y avisos), menú rápido al hacer clic y `Ctrl+Alt+N` para anotar. Habla solo con la app en `127.0.0.1:47823`.
```bash
cd vscode-extension
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension pm-pollito-1.0.0.vsix
```

## Instalador para Windows

```bash
npm run dist
```

Además de `dist/`, **cada compilación deja en `public/` la versión lista para compartir** (script `postdist`):
el instalador `PM-Pollito-Setup-<versión>.exe`, la extensión `pm-pollito-vscode-<versión>.vsix`, un `LEEME.txt` con las instrucciones para cualquier persona y `SHA256.txt` para comprobar los archivos. Solo queda la última versión. (Los binarios están en `.gitignore`: compártelos por Drive, USB o GitHub Releases.) Para regenerarla sin recompilar: `npm run public`.

Genera `dist/PM-Pollito-Setup-<versión>.exe`: doble clic, elegir carpeta, y queda con acceso directo e inicio con Windows. La versión instalada usa la **misma memoria** que la de desarrollo (`%APPDATA%/pm-pollito`). El icono se regenera con `npm run icon`.

### Firmar el instalador (quitar el aviso de SmartScreen)
Sin firma, Windows muestra "Windows protegió su PC / editor desconocido" al instalar. Para evitarlo:
1. Consigue un **certificado de firma de código** (OV o EV) de una autoridad (Sectigo, DigiCert, SSL.com…) o usa **Azure Trusted Signing** (más barato, por suscripción).
2. Con un certificado `.pfx`, define antes de compilar:
   ```powershell
   $env:CSC_LINK = "C:\ruta\certificado.pfx"
   $env:CSC_KEY_PASSWORD = "contraseña-del-certificado"
   npm run dist
   ```
   electron-builder firma el `.exe` automáticamente.
3. Añade en `package.json` → `build.win` el campo `"publisherName": "<nombre exacto del certificado>"` para que las actualizaciones automáticas verifiquen la firma.
   (Con Azure Trusted Signing se usa `build.win.azureSignOptions` en lugar de `CSC_LINK`.)

### Publicar actualizaciones automáticas
La app instalada busca actualizaciones cada 6 h (y desde 🐣 Perfil → *Buscar actualizaciones*). Para activarlo:
1. Crea un repositorio en GitHub (p. ej. `pm-pollito`) y añade en `package.json` → `build`:
   `"publish": [{ "provider": "github", "owner": "TU_USUARIO", "repo": "pm-pollito" }]`
2. Sube la versión en `package.json` (`"version": "1.0.1"`).
3. Con un token de GitHub en la variable `GH_TOKEN`, ejecuta `npm run release`: sube el instalador como *release* y todas las copias instaladas se actualizan solas al cerrarse.

## Uso

```bash
npm install
npm start
```

O doble clic en **`PM.vbs`** para abrirlo sin consola. En la bandeja del sistema (junto al reloj) está el menú con *Iniciar con Windows*, *Salir*, etc.

## Conexión con tu cuenta de Claude

En el panel pulsa **🌐 Conectar con mi cuenta de Claude**: se abre la página oficial de claude.ai y entras como siempre. PM nunca ve tu contraseña; guarda la sesión en su propio perfil de navegador y solo la usa para leer tu uso (la misma información de *claude.ai → Ajustes → Uso*).

Alternativas (en *Opciones avanzadas*): la sesión de Claude Code del equipo o un token OAuth pegado a mano (se guarda cifrado).

Aunque no haya conexión, PM muestra **estadísticas locales** (respuestas, tokens y modelos de hoy, últimas 5 h y últimos 7 días) leyendo los registros de Claude Code en `~/.claude/projects`.

## Configurar inicio de sesión con Microsoft y Google (una sola vez)

Los botones **Conectar con Microsoft** y **Conectar con Google** (pestaña 📬 Agenda) usan el inicio de sesión oficial (OAuth). Para eso la app necesita un *ID de aplicación* de cada proveedor. Lo registra **el desarrollador una vez**; después cualquier usuario solo pulsa el botón. Los IDs van en `oauth.config.json` (copia de `oauth.config.example.json`, ignorado por git).

### Microsoft (Outlook, Hotmail, Microsoft 365, reuniones de Teams) · ~5 min
1. Entra en <https://entra.microsoft.com> → **Aplicaciones → Registros de aplicaciones → Nuevo registro**.
2. Nombre: `PM Pollito`. Tipos de cuenta: **Cuentas de cualquier directorio organizativo y cuentas personales de Microsoft**.
3. URI de redirección: plataforma **Cliente público/nativo (móvil y escritorio)** → `http://localhost`. Pulsa **Registrar**.
4. Copia el **Id. de aplicación (cliente)** en `microsoft.clientId`.
5. En **Permisos de API → Microsoft Graph → Permisos delegados** añade: `User.Read`, `Mail.ReadBasic`, `Calendars.Read`, `offline_access`.
   (En algunas empresas un administrador debe aprobar los permisos.)

### Google (Gmail, Google Calendar, Meet) · ~10 min
1. Entra en <https://console.cloud.google.com> y crea un proyecto `PM Pollito`.
2. **APIs y servicios → Biblioteca**: habilita **Gmail API** y **Google Calendar API**.
3. **Pantalla de consentimiento de OAuth** (Google Auth Platform): tipo **Externo**, nombre de la app y tu correo. En *Acceso a datos* añade los permisos `gmail.metadata` y `calendar.readonly`. En *Público* añade tu Gmail como **usuario de prueba**.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth → App de escritorio**.
5. Copia **ID de cliente** y **Secreto del cliente** en `google.clientId` y `google.clientSecret`.

> Mientras la app de Google esté en modo *Prueba*, solo entran los usuarios de prueba y Google pide volver a conectar cada 7 días. Para quitar esos límites hay que publicarla y pasar la verificación de Google.

Reinicia PM después de editar `oauth.config.json`.

## Estructura

```
main.js            proceso principal: ventanas, bandeja, horarios, avisos
preload.js         puente seguro entre ventanas y proceso principal
src/usage.js       límites de Claude + estadísticas locales
src/claudeWeb.js   inicio de sesión en claude.ai por navegador
src/focus.js       ventana activa e inactividad (productividad)
src/productivity.js pomodoro, recordatorios, salud, proyectos, git, GitHub, Claude Code
src/claudeHooks.js hooks de Claude Code + servidor local (127.0.0.1:47823)
src/git.js         repos, commits y estado
src/github.js      PRs y CI (GraphQL)
src/reminders.js   recordatorios en lenguaje natural
src/report.js      informe semanal, daily y CSV de horas
src/calendar.js    calendario ICS · src/mail.js correo IMAP · src/oauth.js + accounts.js login web (desactivado)
renderer/capture.* ventanita de captura rápida (Ctrl+Alt+P)
src/ai.js          chat con IA (SDK oficial de Anthropic, con herramientas)
src/gamification.js logros, rachas, evolución y tienda
src/monitor.js     vigilancia de sitios
src/i18n.js        traducción al inglés (main y ventanas)
renderer/stats.js  gráficos de estadísticas (SVG propio)
renderer/game.*    minijuego
scripts/make-icon.js genera el icono de la app
src/extras.js      diario de Claude, prompts, portapapeles, bloques, objetivos, hábitos, notas, paseos, monitores, copias e informe mensual
src/diag.js        registro de errores (pm-errors.log) y métricas
src/journal.js     peticiones a Claude Code por proyecto (~/.claude/projects)
src/backup.js      copia de seguridad en carpeta sincronizada
src/monthly.js     HTML del informe mensual (→ PDF)
renderer/panel-extras.js objetivos, hábitos, notas, prompts y planificador de bloques
src/brain.js       personalidad y respuestas del chat (100 % local)
src/store.js       persistencia en %APPDATA%/pm-pollito/pm-data.json
renderer/pet.*     el pollito (SVG + animaciones CSS)
renderer/panel.*   panel: chat, uso, día, mascota y ajustes
```
