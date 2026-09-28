# Novedades de PM Pollito

## 1.8.0 — Claude cierra el ciclo
- **🔧 Claude arregla su propio PR**: PM vigila los PR que abrió Claude. Si falla el CI, le pasa el log del error y sube el arreglo a la misma rama (automático, con un máximo de intentos). Si en la revisión piden cambios, te ofrece "Aplicar la revisión" (o lo hace solo, si lo activas). Te avisa cuando el CI pasa y cuando mezclan o cierran el PR.
- **👀 Claude en vivo**: mientras trabaja ves qué hace ("✏️ Editando src/cart.js · 14 pasos").
- **⚡ Varias a la vez**: hasta 3 peticiones de la cola en paralelo, cada una en su copia del repo.
- **🔎 Segunda opinión**: antes de avisarte, otra pasada de Claude (solo lectura, máx. $1) revisa el cambio buscando bugs, secretos o cosas a medias; lo ves en el panel y va dentro del PR.
- **🐞 Informe de errores opcional**: si algo falla, PM te pregunta una vez si puede enviar el error al autor. Solo el error, la versión y el sistema: sin tareas, notas, chat, correos, rutas ni claves.
- **💛 Donación**: botón "Invítame un café" (PayPal) en Acerca de.
- **🍎 Mac en CI**: los tests también corren en macOS y cada release incluye un `.dmg` (sin firmar).

## 1.7.0 — De ticket a PR
- **🚀 Claude te deja un PR listo**: cuando termina una petición de la cola, un botón hace commit, sube la rama y abre el pull request en GitHub contra la rama en la que estabas, con lo que se pidió, lo que dijo Claude y el resultado de los tests.
- **🧪 Tests antes de avisarte**: PM corre `npm test`, `pytest`, `cargo test` o `go test` en la copia (usando tus `node_modules` sin reinstalar) y el aviso te dice si pasan o fallan, con la salida.
- **💵 Tope de gasto por petición** (Ajustes → Integraciones): Claude se detiene al llegar a los dólares que elijas.
- **▶ Empezar un ticket**: crea la rama con su nombre (`pm-12-informe-de-ventas`), lo pone en tus tareas con el cronómetro en marcha y lo pasa a "En curso" en Jira, Linear o Azure DevOps.
- **🤖 Ticket a Claude**: manda el ticket a la cola con su título, enlace y descripción; el PR lo menciona. La primera vez eliges el repo de cada proyecto y PM lo recuerda.
- **👥 Configuración del equipo en un clic**: exporta un `pm-equipo.json` con lo común (URL de Jira/Azure, IDs de Microsoft/Google, canal y horarios, sin tokens personales) y el equipo lo importa; si lo dejas junto al proyecto al compilar, el instalador lo aplica solo.
- **🎫 Tiempo por ticket** en el informe semanal.
- **🧩 Claude y la terminal ven tus tickets**: herramientas MCP `pm_tickets`, `pm_ticket_start`, `pm_ticket_to_claude`, `pm_queue_run` y `pm_runs`; comandos `pm tickets`, `pm start PM-12`, `pm claude PM-12`, `pm run` y `pm runs`.
- **🌐 Lo nuevo de 1.6 y 1.7 en inglés, portugués y francés.**
- **⚙️ Versiones automáticas**: GitHub Actions corre los tests en cada push y, al subir una etiqueta `vX.Y.Z`, compila y publica el release (sin tokens en tu PC).

## 1.6.0 — PM de equipo
- **🎫 Tus tickets del equipo**: conecta Jira, GitHub Issues, Linear o Azure DevOps (Ajustes → Integraciones). Tus tickets asignados aparecen en 📋 Día para añadirlos a tus tareas; te aviso cuando te asignan uno nuevo. Al completar la tarea, el ticket pasa a "Hecho" en su gestor y (Jira y Azure DevOps) se carga el tiempo que mediste con el cronómetro.
- **▶️ La cola de Claude se ejecuta sola**: pulsa ▶ en una petición de la cola y Claude Code la hace en una copia aparte del repo (tu carpeta y tu rama no se tocan). Al terminar te aviso para **ver los cambios, aceptarlos** (quedan en una rama `pm/claude-…`) **o descartarlos**. Modo automático opcional: cuando termina una, empieza la siguiente.
- **📣 Canal del equipo**: pega el webhook de Slack, Teams o Discord y publico tu daily cada mañana, el informe semanal los viernes y avisos de sitios caídos o CI roto.
- **📱 Avisos al celular** con ntfy o Telegram (por defecto solo si no estás en el PC): Claude terminó o te necesita, reuniones, recordatorios y límites. Desde el bot de Telegram también anotas tareas y recordatorios, ves /tareas y /estado, marcas /hecha y mandas peticiones a la /cola de Claude.
- **📅 Microsoft 365 y Google**: el inicio de sesión para calendario y correo se activa pegando el ID de aplicación en Ajustes (sin recompilar), con soporte para el inquilino de tu empresa.
- **🔄 Actualizaciones de verdad**: las versiones se publican en GitHub y, cuando hay una nueva, puedes pulsar "Actualizar ahora" (antes solo se instalaba al cerrar PM, que casi nunca se cierra).
- Arreglado: ir a Ajustes → Diagnóstico con la ventana ya abierta no cargaba los datos.
- Por dentro: `main.js` y el panel partidos en módulos más pequeños (arranque, consumo, rutina del pollito, agenda, avisos) y 14 tests nuevos (entre ellos, la cola de Claude de punta a punta con un repo real).

## 1.5.2
- **🎵 Música o alguien hablando**: mientras algo suena, el pollito escucha el sonido del PC (no el micrófono) y solo baila si es música. Con vídeos o podcasts de gente hablando, ni con música de fondo, no baila. En los vídeos de reacción baila con la canción y no se para por comentarios cortos. Se analiza al momento en tu PC, sin grabar ni guardar nada, y se puede desactivar en Ajustes → General.

## 1.5.1
- **🎵 El pollito baila con tu música**: detecta lo que suena en cualquier app (Spotify, el navegador, Apple Music…) con los controles multimedia de Windows. Se pone auriculares y baila con 5 pasos que van cambiando (cabeceo, balanceo, alas arriba, saltitos y giro), con notas musicales. Deja de bailar en reuniones y presentaciones, y saluda al acabar.
- El modo ahorro de memoria vuelve a estar activo por defecto.

## 1.5.0 — Versión "pro"
- **🧩 El pollito dentro de Claude (MCP)**: Claude Code y Claude Desktop pueden leer y actualizar tus tareas, la cola, notas, recordatorios, hitos y límites (herramientas `pm_…`). Solo por tu PC y con clave secreta.
- **📟 Línea de estado en Claude Code**: 🐣 42% · 🍅 12:30 · ✅ 3/7 · 📋 cola.
- **🎬 Sesiones de Claude en vivo**: qué hace cada sesión, en qué proyecto, tokens, coste y aviso si parece atascada.
- **🧠 Memoria de proyecto**: el pollito escribe en el `CLAUDE.md` de cada repo los comandos, errores frecuentes, decisiones y entregas.
- **🔄 Sincronizar entre PCs** por OneDrive / Google Drive, sin perder nada (y lo borrado no reaparece).
- **📝 Exportar a Markdown / Obsidian** (a mano o cada noche) y **📅 bloques de tiempo a tu calendario (.ics)**.
- **👤 Perfiles** (Trabajo, Personal…) con el mismo pollito.
- **⌨️ Comando `pm`** en cualquier terminal.
- **⚡ ~40% menos memoria y menos CPU** (modo ahorro, ventanas que se liberan solas, audio que se apaga).
- **🔒 Más seguridad**: ventanas aisladas (sandbox), mensajes internos verificados, sin navegación ni ventanas emergentes.
- **🧯 Modo seguro** si la app no consigue arrancar, con restauración de la última copia.
- **🍎 Preparada para Mac** (vigilante de ventanas para macOS y configuración de empaquetado).
- Tests de lógica y de interfaz, chequeo de tipos y código principal dividido en módulos.

## 1.4.1
- El gafete de PM volvió 🪪 (el contador de avisos lo estaba tapando).

## 1.4.0
- Vigilante de tests y builds en VS Code, mensaje de commit sugerido, revisión antes de push, tiempo por rama.
- Cola para Claude, presupuesto semanal, priorizar el día, dividir tareas, tareas que envejecen, hitos, revisión del viernes.
- Casita, huevos coleccionables, diario del pollito, personalidades y modo música.
- Copias cifradas, portugués y francés, alto contraste, tests automáticos.

## 1.3.x
- Modo foco, tareas recurrentes, plantillas de día, búsqueda global, diagnóstico.
- Arreglado: el pollito se escondía con ventanas maximizadas en un segundo monitor.

## 1.2.0
- Diario de Claude Code, consejo de modelo, biblioteca de prompts, portapapeles inteligente, bloques de tiempo, objetivos, hábitos, notas, juegos, especies, seguir al monitor, copia automática e informe mensual en PDF.

## 1.1.0 y anteriores
- El pollito PM: límites de Claude, daily y cierre, tamagotchi, avisos, agenda, pomodoro, GitHub, git, informes, estadísticas, logros, tienda, extensión de VS Code…
