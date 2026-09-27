// Traducción español → inglés.
// La app está escrita en español; en modo inglés, los textos pasan por aquí:
//  - EXACT: frases fijas (panel, botones, etiquetas).
//  - RULES: patrones con variables (mensajes del pollito, textos dinámicos).
// Funciona en Node (main) y en el navegador (panel) como variable global I18N.
(function (root) {
  const EXACT = {
    'tu pollito Project Manager': 'your Project Manager chick',
    '💬 Chat': '💬 Chat', '📊 Uso': '📊 Usage', '📋 Día': '📋 Day', '📬 Agenda': '📬 Agenda', '🐣 Perfil': '🐣 Profile',
    '¿Cuánto llevo?': 'How much have I used?', '⏳ Reinicio': '⏳ Reset', 'Hoy': 'Today', 'Tareas': 'Tasks',
    'Actividad local en Claude Code': 'Local activity in Claude Code', '↻ Actualizar': '↻ Refresh', 'Actualizar': 'Refresh',
    '🍅 Pomodoro': '🍅 Pomodoro', '25 min de concentración · 5 de descanso': '25 min focus · 5 min break',
    '▶ Empezar pomodoro': '▶ Start pomodoro', '⏹ Detener': '⏹ Stop', '⏰ Recordatorios': '⏰ Reminders',
    'Tip: pulsa': 'Tip: press', 'desde cualquier app para anotar tareas o recordatorios al vuelo ✍️': 'from any app to jot down tasks or reminders on the fly ✍️',
    '☀️ Daily': '☀️ Daily', '🌇 Cierre': '🌇 Wrap-up', '📋 Copiar daily': '📋 Copy daily', '📊 Informe semanal': '📊 Weekly report',
    '👀 Productividad de hoy': "👀 Today's productivity", '⏱️ Tiempo por proyecto': '⏱️ Time per project', '💻 Git hoy': '💻 Git today',
    'Últimos días': 'Last days', '📅 Reuniones de hoy': "📅 Today's meetings", '📧 Correo': '📧 Email', '🔗 Conectar': '🔗 Connect',
    '🔗 Calendario por enlace ICS': '🔗 Calendar via ICS link', '(tus reuniones de Teams):': '(your Teams meetings):',
    'Abre tu calendario en Outlook web:': 'Open your calendar in Outlook on the web:', 'cuenta de trabajo': 'work account', 'cuenta personal': 'personal account',
    '⚙️ Configuración →': '⚙️ Settings →', 'Calendario': 'Calendar', 'Calendarios compartidos': 'Shared calendars', 'En': 'Under',
    'Publicar un calendario': 'Publish a calendar', 'elige tu calendario, “Puede ver todos los detalles” y pulsa': 'pick your calendar, “Can view all details” and click',
    'Publicar': 'Publish', 'Copia el enlace': 'Copy the', 'y pégalo aquí 👇': 'link and paste it here 👇', 'Configuración': 'Settings',
    '→ tu calendario → “Dirección secreta en formato iCal”.': '→ your calendar → “Secret address in iCal format”.',
    'Conectar': 'Connect', 'Desconectar calendario': 'Disconnect calendar', '🔗 Correo por IMAP (contraseña de aplicación)': '🔗 Email via IMAP (app password)',
    'Proveedor': 'Provider', 'Conectar correo': 'Connect email', 'Desconectar correo': 'Disconnect email',
    '🔒 Solo leo remitente y asunto de tus correos sin leer. La contraseña se guarda cifrada en tu PC.': '🔒 I only read the sender and subject of your unread emails. The password is stored encrypted on your PC.',
    '⭐ XP': '⭐ XP', '💛 Felicidad': '💛 Happiness', '🌽 Pancita': '🌽 Tummy', '🌽 Dar de comer': '🌽 Feed', '💛 Acariciar': '💛 Pet',
    'Nombre': 'Name', 'Guardar': 'Save', 'Rutina': 'Routine', 'Pregunta del daily': 'Daily check-in', 'Cierre del día': 'Day wrap-up',
    'Solo de lunes a viernes': 'Weekdays only', 'Charlas espontáneas': 'Spontaneous chatter', 'Vigilar distracciones (YouTube, redes…)': 'Watch distractions (YouTube, social…)',
    'Sonidos de pío 🔊': 'Chirp sounds 🔊', 'Iniciar con Windows': 'Start with Windows', '🔕 Silenciar 1 hora (reunión)': '🔕 Mute 1 hour (meeting)',
    '🔔 Quitar silencio': '🔔 Unmute', '🔌 Integraciones': '🔌 Integrations', '🤖 Claude Code': '🤖 Claude Code',
    'Te aviso cuando Claude termine una tarea o necesite tu permiso, y muestro una burbuja mientras trabaja. Añade unos hooks a tu': 'I let you know when Claude finishes a task or needs your permission, and show a bubble while it works. Adds a few hooks to your',
    '(con copia de seguridad).': '(with a backup).', 'Conectar con Claude Code': 'Connect Claude Code', '🔄 Reinstalar hooks': '🔄 Reinstall hooks', 'Quitar': 'Remove',
    'PRs que esperan tu revisión, CI fallido, aprobaciones y comentarios. Crea un token personal': 'PRs waiting for your review, failed CI, approvals and comments. Create a personal token',
    'aquí': 'here', '(permisos': '(scopes', 'y': 'and', ') y pégalo. PM solo lo usa para leer; se guarda cifrado.': ') and paste it. PM only uses it to read; it is stored encrypted.',
    'Usar': 'Use', 'Quitar token': 'Remove token', '💻 Carpetas con tus repos de git': '💻 Folders with your git repos',
    'Una por línea. Busco repositorios hasta 2 niveles dentro.': 'One per line. I look for repositories up to 2 levels deep.', 'Guardar carpetas': 'Save folders',
    '🧘 Salud': '🧘 Health', 'Pausa activa cada 50 min': 'Active break every 50 min', 'Descanso visual 20-20-20': '20-20-20 eye break', 'Recordar tomar agua': 'Water reminder',
    'Conexión con Claude': 'Claude connection', '🌐 Conectar con mi cuenta de Claude': '🌐 Connect my Claude account', '🔄 Volver a conectar': '🔄 Reconnect',
    'Cerrar sesión de Claude en PM': 'Sign PM out of Claude', 'Opciones avanzadas': 'Advanced options', 'También puedo usar la sesión de': 'I can also use the',
    'de este equipo o un token OAuth que pegues aquí (se guarda cifrado).': 'session on this PC, or an OAuth token pasted here (stored encrypted).',
    'Quitar token manual': 'Remove manual token', 'Cerrar PM 😢': 'Close PM 😢', '¡Pío! Acabo de nacer': 'Peep! I just hatched', 'Seré tu': "I'll be your",
    ': vigilaré cuánto gastas de Claude, te avisaré cuando te acerques al límite y cada mañana te preguntaré qué vas a hacer.': ": I'll watch your Claude usage, warn you when you get close to the limit and ask every morning what you'll do.",
    '¿Cómo me vas a llamar?': 'What will you call me?', '¡Ese es mi nombre! 💛': "That's my name! 💛", '☀️ ¡Buenos días!': '☀️ Good morning!',
    'Cuéntame para organizar el día.': "Tell me so we can plan the day.", '1. ¿Qué hiciste ayer?': '1. What did you do yesterday?', '2. ¿Qué vas a hacer hoy?': '2. What will you do today?',
    '(Enter para añadir cada tarea)': '(Enter to add each task)', '3. ¿En qué puedo ayudarte?': '3. How can I help you?', 'Más tarde': 'Later', '¡Listo! 🐣': 'Done! 🐣',
    'Listo para pegar en Slack, Teams o un correo.': 'Ready to paste into Slack, Teams or an email.', '📋 Copiar': '📋 Copy', '✅ ¡Copiado!': '✅ Copied!',
    '🌇 Cierre del día': '🌇 Day wrap-up', '¿Cumpliste con lo que dijiste que harías hoy?': 'Did you do what you said you would today?',
    '¿Algo que quieras anotar?': 'Anything to note down?', 'Pasar lo pendiente a mañana': 'Move pending items to tomorrow', 'Guardar cierre ✅': 'Save wrap-up ✅',
    'Cerrar': 'Close', 'Pregúntame algo… pío 🐣': 'Ask me anything… peep 🐣', 'Añadir tarea…': 'Add task…',
    'a las 3 revisar el informe · en 20 min llamar a Ana': 'at 3 review the report · in 20 min call Ana', 'Exportar últimos 30 días a Excel': 'Export last 30 days to Excel',
    'Contraseña de APLICACIÓN (no la normal)': 'APP password (not your normal one)', 'Nombre del pollito': "Chick's name", 'Token (opcional)': 'Token (optional)',
    'Ej: Pollito, Kiwi, Sr. Pío…': 'E.g.: Chicky, Kiwi, Mr. Peep…', 'Terminé el login, revisé PRs…': 'Finished the login, reviewed PRs…', 'Una tarea…': 'A task…',
    'Recuérdame hacer pausas, avísame si me paso de límite…': 'Remind me to take breaks, warn me if I go over the limit…', 'Bloqueos, logros, pendientes…': 'Blockers, wins, pending…',
    'Sin recordatorios pendientes': 'No pending reminders', 'Aún no hay tareas. Haz el daily o añade una 👇': 'No tasks yet. Do the daily or add one 👇',
    'sin plan': 'no plan', '☀️ Hacer daily': '☀️ Do daily', '☀️ Editar daily': '☀️ Edit daily', 'Aquí verás cómo te fue cada día.': "Here you'll see how each day went.",
    '🎨 Tema': '🎨 Theme', '🌐 Idioma': '🌐 Language', '🤖 IA (chat inteligente)': '🤖 AI (smart chat)', '🏅 Logros': '🏅 Achievements', '🛍️ Tienda': '🛍️ Shop',
    '📈 Estadísticas': '📈 Statistics', '🌐 Mis sitios': '🌐 My sites', 'Comprar': 'Buy', 'Equipar': 'Wear', 'Quitarse': 'Take off', 'Puesto': 'Wearing',
    '🎮 Minijuego': '🎮 Mini-game', '✨ Mejorar con IA': '✨ Improve with AI', 'Horas trabajadas (30 días)': 'Hours worked (30 days)',
    'Trabajo vs distracción (14 días)': 'Work vs distraction (14 days)', 'Proyectos (30 días)': 'Projects (30 days)', 'Tokens de Claude por día (14 días)': 'Claude tokens per day (14 days)',
    'Tareas cumplidas vs planeadas (14 días)': 'Tasks done vs planned (14 days)', 'Trabajo': 'Work', 'Distracción': 'Distraction', 'Cumplidas': 'Done', 'Planeadas': 'Planned',
    'Racha de dailies': 'Daily streak', 'Horas este mes': 'Hours this month', 'Pomodoros este mes': 'Pomodoros this month', 'Commits este mes': 'Commits this month',
    'Añadir': 'Add', 'Ocultarme al presentar o en pantalla completa': 'Hide when presenting or full screen', 'Buscar actualizaciones': 'Check for updates',
    // Minijuego
    '🎮 Atrapa el maíz': '🎮 Catch the corn', '🐣 ¡A comer!': '🐣 Snack time!', 'Mueve el pollito con el ratón o las flechas.': 'Move the chick with the mouse or arrow keys.',
    'Atrapa 🌽 (+1) y ⭐ (+5). Esquiva las 🪨 (−3).': 'Catch 🌽 (+1) and ⭐ (+5). Dodge the 🪨 (−3).', 'Cada grano es maíz para la tienda.': 'Every kernel is corn for the shop.',
    '▶ Jugar': '▶ Play', '🔁 Otra vez': '🔁 Again', '⏰ ¡Tiempo!': "⏰ Time's up!", '🏆 ¡Nuevo récord!': '🏆 New record!',
    // Tienda, logros, IA, sitios
    'Ganas 🌽 maíz con cada XP, logros y el minijuego.': 'You earn 🌽 corn with every XP, achievements and the mini-game.',
    'Gafas de sol': 'Sunglasses', 'Gafas de nerd': 'Nerd glasses', 'Gorro de fiesta': 'Party hat', 'Sombrero vaquero': 'Cowboy hat', 'Gorra dev': 'Dev cap',
    'Sombrero de mago': 'Wizard hat', 'Bufanda': 'Scarf', 'Corbata de jefe': 'Boss tie', 'Capa de héroe': 'Hero cape', 'Plumas azul pastel': 'Pastel blue feathers',
    'Plumas rosadas': 'Pink feathers', 'Plumas menta': 'Mint feathers', 'Plumas doradas': 'Golden feathers',
    'Con una API key de Anthropic, el pollito responde cualquier pregunta, prioriza tus tareas, crea recordatorios y mejora tus informes. Consigue la key': 'With an Anthropic API key, the chick answers any question, prioritizes your tasks, creates reminders and polishes your reports. Get the key',
    '(se paga por uso; se guarda cifrada).': '(pay-as-you-go; stored encrypted).', 'Modelo': 'Model', 'Usar IA en el chat': 'Use AI in chat', 'Quitar API key': 'Remove API key',
    'Idioma / Language': 'Idioma / Language', '📈 Estadísticas': '📈 Statistics',
    'Añade tus webs, APIs o servidores locales y te aviso si se caen 🔴': "Add your sites, APIs or local servers and I'll warn you if they go down 🔴",
    'miweb.com · localhost:3000 · api.miapp.com/health': 'mysite.com · localhost:3000 · api.myapp.com/health',
    'comprobando…': 'checking…', '⏳ Pensando…': '⏳ Thinking…', 'Horas este mes': 'Hours this month',
    'Aún no hay tiempo por proyecto registrado.': 'No time per project recorded yet.',
    'Formato listo para Slack o Teams.': 'Ready for Slack or Teams.', 'Últimos 7 días. Listo para Slack, Teams o un correo.': 'Last 7 days. Ready for Slack, Teams or an email.',
    '📋 Daily para copiar': '📋 Daily to copy',
    'Nada de distracciones: el pollito vigila 👀': 'No distractions: the chick is watching 👀', 'Levántate, estírate, toma agua 🧘': 'Stand up, stretch, drink water 🧘',
    'Ayer:': 'Yesterday:', 'Me pediste ayuda con:': 'You asked me for help with:', 'Cierre:': 'Wrap-up:',
    'Sin recordatorios pendientes': 'No pending reminders', 'Conecta GitHub en 🐣 Perfil → Integraciones para ver PRs y CI.': 'Connect GitHub in 🐣 Profile → Integrations to see PRs and CI.',
    'Revisando tus repositorios… 🔍': 'Checking your repositories… 🔍', '¡Nada pendiente en GitHub! 🎉': 'Nothing pending on GitHub! 🎉',
    'Aún no hay datos de hoy. Te estoy observando 👀': "No data for today yet. I'm watching 👀",
    'Aún no hay tiempo registrado hoy. Detecto el proyecto desde VS Code, Cursor, JetBrains, la terminal y más.': 'No time recorded today yet. I detect the project from VS Code, Cursor, JetBrains, the terminal and more.',
    'Conecta tu calendario (abajo 👇) y te avisaré 10 min antes de cada reunión de Teams, con botón para unirte.': "Connect your calendar (below 👇) and I'll warn you 10 min before each Teams meeting, with a join button.",
    'Conecta tu correo (abajo 👇) y te avisaré cuando llegue algo nuevo.': "Connect your email (below 👇) and I'll tell you when something new arrives.",
    '¡Hoy no tienes reuniones! 🎉 Día para enfocarse.': 'No meetings today! 🎉 A day to focus.', 'Unirse': 'Join', 'Vamos bien, ¡a enfocarse! 💪': "Going well, let's focus! 💪",
    '¡Día muy enfocado! 🥹': 'Very focused day! 🥹', 'Demasiadas distracciones 🤨': 'Too many distractions 🤨', 'Más de una hora perdida… 😤': 'Over an hour lost… 😤',
    '¿Qué anoto? Tarea o “recuérdame a las 3 …”': 'What should I note? A task or “remind me at 3pm …”',
    'guardar ·': 'save ·',
    'cerrar · Con hora (“a las 4”, “en 20 min”, “mañana a las 9”) se vuelve recordatorio ⏰': 'close · With a time (“at 4pm”, “in 20 min”, “tomorrow at 9”) it becomes a reminder ⏰',
  };

  // Patrones: [expresión, reemplazo]. Se aplican en orden sobre textos que no están en EXACT.
  const RULES = [
    [/¡Buenos días! ☀️ ¿Qué hiciste ayer y qué vas a hacer hoy\?/g, 'Good morning! ☀️ What did you do yesterday and what will you do today?'],
    [/Hoy tienes (\d+) reuniones? 📅/g, 'You have $1 meeting(s) today 📅'],
    [/y (\d+) correos sin leer 📧/g, 'and $1 unread emails 📧'],
    [/¡Casi termina el día! 🌇 ¿Cumpliste lo que dijiste\?/g, 'The day is almost over! 🌇 Did you do what you said?'],
    [/^¡Buenos días! (.+) reportándose 🫡$/, 'Good morning! $1 reporting for duty 🫡'],
    [/^¡Buenas tardes! (.+) reportándose 🫡$/, 'Good afternoon! $1 reporting for duty 🫡'],
    [/^¡Buenas noches! (.+) reportándose 🫡$/, 'Good evening! $1 reporting for duty 🫡'],
    [/¡Pío! Me actualizaron ✨ Tengo cosas nuevas: escribe "ayuda" para verlas\./g, 'Peep! I got updated ✨ I have new stuff: type "help" to see it.'],
    [/¡¿ME CERRASTE DE GOLPE\?! 😡💢 Estuve apagado (.+?)\. ¡Ni un adiós!/g, 'YOU SHUT ME DOWN JUST LIKE THAT?! 😡💢 I was off for $1. Not even a goodbye!'],
    [/¡Hmph! 😤 Me cerraste hace (.+?)\. ¿Tan mal PM soy\?/g, "Hmph! 😤 You closed me $1 ago. Am I that bad a PM?"],
    [/¡Por fin vuelves! 😠 Me dejaste solito (.+?)\./g, 'Finally, you are back! 😠 You left me alone for $1.'],
    [/Por cierto, tenías pendiente: "(.+?)" 📌/g, 'By the way, you still had pending: "$1" 📌'],
    [/Llevas (\d+)% (de tu sesión|del límite .+?)\. ¡Buen ritmo! 💪/g, "You're at $1% of your limit. Good pace! 💪"],
    [/Vamos por la mitad: (\d+)% .+?🐥/g, "Halfway there: $1% 🐥"],
    [/Uff, (\d+)% .+? 😬 Vamos con calma\. Reinicio en (.+?)\./g, 'Phew, $1% 😬 Easy does it. Resets in $2.'],
    [/¡Alerta! Llevas (\d+)% .+? 🥵 Quedan pocas balas\. Reinicio en (.+?)\./g, 'Alert! You are at $1% 🥵 Running low. Resets in $2.'],
    [/¡Llegamos al 100% .+?! 😵 Se reinicia en (.+?)\. Hora de un descanso\./g, 'We hit 100%! 😵 Resets in $1. Break time.'],
    [/¡Tu límite de sesión se reinició! 🎉 Energía al 100%/g, 'Your session limit reset! 🎉 Energy at 100%'],
    [/Oye… llevas (\d+) min en (.+?) 👀 ¿Eso está en tu lista de tareas\?/g, 'Hey… $1 min on $2 👀 Is that on your task list?'],
    [/¡(\d+) minutos en (.+?)! 😠/g, '$1 minutes on $2! 😠'],
    [/"(.+?)" te está esperando\. ¡A trabajar!/g, '"$1" is waiting for you. Back to work!'],
    [/¡Estamos en pomodoro! /g, "We're in a pomodoro! "],
    [/¿Hola\? ¿Sigues ahí\? 👀 Llevas 20 min sin tocar nada…/g, "Hello? Still there? 👀 20 minutes without touching anything…"],
    [/¡Volviste! Estuviste (.+?) fuera 👀/g, 'You are back! You were away for $1 👀'],
    [/🍅 ¡Pomodoro #(\d+) de 25 min! Modo concentración 😤 Nada de YouTube, ¿eh\?/g, '🍅 Pomodoro #$1, 25 min! Focus mode 😤 No YouTube, ok?'],
    [/🍅 ¡Pomodoro completado! \((\d+) hoy · \+10 XP\)\nDescanso de (\d+) min: levántate y estírate 🧘/g, '🍅 Pomodoro done! ($1 today · +10 XP)\n$2-minute break: stand up and stretch 🧘'],
    [/⏰ ¡Se acabó el descanso! ¿Otro pomodoro\?.*/g, '⏰ Break is over! Another pomodoro? Type "pomodoro" or right-click → 🍅'],
    [/Pomodoro detenido ⏹️/g, 'Pomodoro stopped ⏹️'],
    [/⏰ ¡Recordatorio! /g, '⏰ Reminder! '],
    [/⏰ ¡Anotado! Te recordaré "(.+?)" hoy a las (.+?)\./g, '⏰ Noted! I will remind you "$1" today at $2.'],
    [/📌 Tarea añadida: /g, '📌 Task added: '],
    [/🧘 Llevas 50 min sin parar\..*/g, '🧘 50 minutes non-stop. Active break: stand up and stretch your arms and neck for 2 minutes. Me too! 🐣'],
    [/👀 Regla 20-20-20: mira algo a 6 metros durante 20 segundos\./g, '👀 20-20-20 rule: look at something 20 feet away for 20 seconds.'],
    [/💧 ¿Tomaste agua\? ¡Hidrátate! 🥤/g, '💧 Did you drink water? Stay hydrated! 🥤'],
    [/✅ ¡Claude terminó en (.+?)! \((.+?)\) Ve a revisar 👀/g, '✅ Claude finished in $1! ($2) Go check it 👀'],
    [/🙋 Claude necesita permiso para usar (.+?) \((.+?)\)/g, '🙋 Claude needs permission to use $1 ($2)'],
    [/🙋 Claude está esperando tu respuesta \((.+?)\)/g, '🙋 Claude is waiting for your reply ($1)'],
    [/📦 ¡Commit en (.+?)! "(.+?)" \(\+2 XP\)/g, '📦 Commit in $1! "$2" (+2 XP)'],
    [/💾 Llevas (.+?) sin commit en (.+?) \((\d+) archivos\) 😬 ¡Guarda tu trabajo!/g, "💾 $1 without committing in $2 ($3 files) 😬 Save your work!"],
    [/🎧 Estás en (.+?) \((.+?)\)\. Me pongo los audífonos y me quedo calladito 🤫/g, "🎧 You're in $1 ($2). Headphones on, I'll stay quiet 🤫"],
    [/¡Reunión terminada! \((\d+) min\).*/g, 'Meeting over! ($1 min) 📝 Any new tasks? Add them in 📋 Day or press Ctrl+Alt+P.'],
    [/📅 En (\d+) min: "(.+?)"(.*?)\. ¡Prepárate! 🎧/g, '📅 In $1 min: "$2"$3. Get ready! 🎧'],
    [/🎧 ¡Ya empieza "(.+?)"!/g, '🎧 "$1" is starting!'],
    [/📧 Correo nuevo de (.+?): /g, '📧 New email from $1: '],
    [/¡SUBÍ A NIVEL (\d+)! 🎉 Ahora soy (.+)/g, 'I LEVELED UP TO $1! 🎉 Now I am $2'],
    [/🏅 ¡Logro desbloqueado! (.+?) — (.+?) \(\+(\d+) 🌽\)/g, '🏅 Achievement unlocked! $1 — $2 (+$3 🌽)'],
    [/¡Ñam ñam! 🌽 Gracias 💛/g, 'Nom nom! 🌽 Thanks 💛'],
    [/Pío… tengo hambre 🥺 ¿Me das maicito\? 🌽/g, 'Peep… I am hungry 🥺 Some corn? 🌽'],
    [/¿Me vas a cerrar\? 🥺/g, 'Are you closing me? 🥺'],
    [/¡Yay! Sabía que me querías 💛/g, 'Yay! I knew you loved me 💛'],
    [/Hmph… 😤 … bueno, está bien\. Te perdono 💛/g, 'Hmph… 😤 … fine. I forgive you 💛'],
    [/¡Es viernes! 🎉 Tu informe semanal está listo para copiar y enviar 📊/g, "It's Friday! 🎉 Your weekly report is ready to copy and send 📊"],
    [/Me escondo mientras presentas 🙈/g, 'Hiding while you present 🙈'],
    [/🔴 (.+?) está caído/g, '🔴 $1 is down'],
    [/🟢 (.+?) volvió a funcionar/g, '🟢 $1 is back up'],
    // Panel dinámico
    [/^Hoy · /, 'Today · '],
    [/(\d+) repos vigilados · /g, '$1 repos watched · '],
    [/ commits? hoy/g, ' commit(s) today'],
    [/Se reinicia en /g, 'Resets in '],
    [/Actualizado /g, 'Updated '],
    [/respuestas hoy/g, 'replies today'],
    [/tokens hoy \(entrada\+salida\)/g, 'tokens today (in+out)'],
    [/últimas 5 h · (\d+) resp\./g, 'last 5 h · $1 replies'],
    [/últimos 7 días · (\d+) resp\./g, 'last 7 days · $1 replies'],
    [/Modelos hoy/g, 'Models today'],
    [/Sesión actual \(5 h\)/g, 'Current session (5 h)'],
    [/Semanal · todos los modelos/g, 'Weekly · all models'],
    [/Semanal · /g, 'Weekly · '],
    [/✅ Conectado a tu cuenta de Claude/g, '✅ Connected to your Claude account'],
    [/sin leer/g, 'unread'],
    [/sin conectar/g, 'not connected'],
    [/ · sesión al (\d+)%/g, ' · session at $1%'],
    [/^feliz ✨/, 'happy ✨'], [/^un poco preocupado/, 'a bit worried'], [/^¡en pánico!/, 'panicking!'], [/^agotado/, 'exhausted'],
    [/^con hambre/, 'hungry'], [/^ENOJADO 😤💢 \(acarícialo o pídele perdón\)/, 'ANGRY 😤💢 (pet it or say sorry)'], [/^te está vigilando 🤨/, 'watching you 🤨'],
    [/^🍅 Concentración · #(\d+)/, '🍅 Focus · #$1'], [/^☕ Descanso largo/, '☕ Long break'], [/^☕ Descanso/, '☕ Break'],
    [/^(\d+) completados? hoy · 25 min \+ 5 de descanso/, '$1 done today · 25 min + 5 break'],
    [/^(\d+)\/(\d+) tareas$/, '$1/$2 tasks'],
    [/^Atrapaste (\d+) granos/, 'You caught $1 kernels'],
    [/Récord: (\d+) · Tienes (\d+) 🌽 para la tienda\./g, 'Record: $1 · You have $2 🌽 for the shop.'],
    [/🎮 ¡(\d+) granos atrapados! \+(\d+) 🌽( ¡NUEVO RÉCORD! 🏆)?/g, (m, a, b, c) => `🎮 ${a} kernels caught! +${b} 🌽${c ? ' NEW RECORD! 🏆' : ''}`],
    [/✨ ¡EVOLUCIONÉ! ✨ Ahora soy un (.+?) \(nivel (\d+)\) 🎉/g, '✨ I EVOLVED! ✨ Now I am a $1 (level $2) 🎉'],
    [/¡Mira mi (.+?) nuevo! (.+?) ¿A que me queda genial\? 💛/g, 'Look at my new $1! $2 Looks great on me, right? 💛'],
    [/Te faltan (\d+) 🌽\..*/g, 'You need $1 more 🌽. Finish tasks and pomodoros to earn more!'],
    [/^(\d+) min$/, '$1 min'],
    [/ de trabajo$/, ' of work'],
    [/caído · /g, 'down · '],
    [/Mientras presentabas \((\d+) min\) pasaron (\d+) cosas\. La última: /g, 'While you were presenting ($1 min), $2 things happened. The last one: '],
    [/🎁 ¡Hay una versión nueva \((.+?)\)! Se instalará cuando cierres PM\./g, '🎁 A new version ($1) is available! It will install when you close PM.'],
    [/¡Ya tienes la última versión! ✅/g, 'You have the latest version! ✅'],
    [/ min\b/g, ' min'],
  ];

  function tr(text, lang) {
    if (lang !== 'en' || text == null) return text;
    const s = String(text);
    const trimmed = s.trim();
    if (EXACT[trimmed] !== undefined) return s.replace(trimmed, EXACT[trimmed]);
    let out = s;
    for (const [re, rep] of RULES) out = out.replace(re, rep);
    return out;
  }

  /** Traduce un árbol DOM in situ (textos, placeholder y title). */
  function translateDom(rootEl, lang) {
    if (lang !== 'en' || !rootEl) return;
    const walker = rootEl.ownerDocument.createTreeWalker(rootEl, 4 /* SHOW_TEXT */);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const p = n.parentElement;
      if (!p || /^(SCRIPT|STYLE|TEXTAREA)$/.test(p.tagName) || p.closest('[data-no-i18n]')) continue;
      const t = tr(n.nodeValue, lang);
      if (t !== n.nodeValue) n.nodeValue = t;
    }
    for (const el of rootEl.querySelectorAll('[placeholder],[title]')) {
      for (const a of ['placeholder', 'title']) {
        const v = el.getAttribute(a);
        if (v) {
          const t = tr(v, lang);
          if (t !== v) el.setAttribute(a, t);
        }
      }
    }
  }

  const api = { tr, translateDom, EXACT, RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.I18N = api;
})(typeof window !== 'undefined' ? window : globalThis);
