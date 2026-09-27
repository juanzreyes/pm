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

## Instalador para Windows

```bash
npm run dist
```

Genera `dist/PM-Pollito-Setup-<versión>.exe`: doble clic, elegir carpeta, y queda con acceso directo e inicio con Windows. La versión instalada usa la **misma memoria** que la de desarrollo (`%APPDATA%/pm-pollito`). El icono se regenera con `npm run icon`.

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
src/brain.js       personalidad y respuestas del chat (100 % local)
src/store.js       persistencia en %APPDATA%/pm-pollito/pm-data.json
renderer/pet.*     el pollito (SVG + animaciones CSS)
renderer/panel.*   panel: chat, uso, día, mascota y ajustes
```
