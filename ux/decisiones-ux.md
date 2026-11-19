# Decisiones de UX

Cómo se ve Discordia, cómo se navega y por qué. Cada decisión sigue el formato de los [ADRs](../adr/): contexto, decisión, alternativas descartadas y consecuencias. Los tokens y componentes que se nombran están en [sistema-de-diseno.md](sistema-de-diseno.md), y las pantallas, en el [Figma del proyecto](https://www.figma.com/design/YV4I8KiDbfm8lBaauL7dx5).

| # | Decisión | Aplica a |
|---|---|---|
| [UX-01](#ux-01-tema-oscuro-con-un-solo-color-de-acción) | Tema oscuro con un solo color de acción | Todo |
| [UX-02](#ux-02-layout-de-chat-en-columnas-servidores--canales--chat--miembros) | Layout de chat en columnas | Cliente web |
| [UX-03](#ux-03-en-el-teléfono-un-panel-por-vez) | En el teléfono, un panel por vez | Mobile |
| [UX-04](#ux-04-una-sola-app-expo-para-web-y-android) | Una sola app Expo para web y Android | Cliente web, mobile |
| [UX-05](#ux-05-backoffice-como-app-aparte-organizada-por-expedientes) | Backoffice como app aparte, organizada por expedientes | Backoffice |
| [UX-06](#ux-06-errores-en-línea-que-dicen-qué-hacer) | Errores en línea que dicen qué hacer | Todo |
| [UX-07](#ux-07-avisar-cuando-el-servidor-está-despertando) | Avisar cuando el servidor está despertando | Todo |
| [UX-08](#ux-08-cambiar-de-canal-o-servidor-sin-pantallas-de-carga) | Cambiar de canal o servidor sin pantallas de carga | Cliente web, mobile |
| [UX-09](#ux-09-confirmar-solo-lo-irreversible-o-lo-que-tiene-costo) | Confirmar solo lo irreversible o lo que tiene costo | Todo |
| [UX-10](#ux-10-acciones-sobre-un-mensaje-hover-en-web-mantener-apretado-en-mobile) | Acciones sobre un mensaje: hover en web, mantener apretado en mobile | Cliente web, mobile |
| [UX-11](#ux-11-la-llamada-sigue-mientras-navegás) | La llamada sigue mientras navegás | Cliente web, mobile |
| [UX-12](#ux-12-mostrar-solo-lo-que-el-usuario-puede-hacer) | Mostrar solo lo que el usuario puede hacer | Cliente web, mobile |
| [UX-13](#ux-13-no-leídos-visibles-en-tres-niveles) | No leídos visibles en tres niveles | Cliente web, mobile |
| [UX-14](#ux-14-español-rioplatense-y-accesibilidad-básica) | Español rioplatense y accesibilidad básica | Todo |

---

## UX-01: Tema oscuro con un solo color de acción

**Contexto.** Una app de chat y voz se usa durante muchas horas y muchas veces de noche. Además, tiene muchos estados que comunicar (seleccionado, no leído, error, aviso, presencia), y si cada uno trae su propio color, la pantalla se vuelve ruidosa.

**Decisión.** Fondo oscuro (`bg #0A1620`), superficies como capas de blanco translúcido y **un solo color de acción**, el teal `#37D6C0`, para lo que se puede tocar y lo que está seleccionado. Amarillo, rojo y verde se reservan para avisos, errores y éxito o presencia.

**Alternativas descartadas.**
- *Tema claro o claro + oscuro:* duplica el trabajo de diseño y prueba de cada pantalla, y ninguna historia lo pide.
- *Paleta con varios colores de marca:* compiten con los colores de estado, y el usuario ya no sabe si algo es "importante" o "decorativo".

**Consecuencias.** Lo accionable se reconoce de un vistazo. Agregar un estado nuevo implica reutilizar un color semántico, no inventar uno. El precio es que el contraste de los textos secundarios (`muted`, `subtle`) hay que cuidarlo en cada pantalla nueva.

## UX-02: Layout de chat en columnas: servidores → canales → chat → miembros

**Contexto.** El modelo del dominio es jerárquico: un usuario tiene servidores, un servidor tiene categorías y canales, y un canal tiene mensajes y miembros. Los usuarios llegan con el modelo mental de otras apps de comunidades.

**Decisión.** En pantallas anchas, cuatro columnas que siguen esa jerarquía de izquierda a derecha: el **rail de servidores** (52 px, íconos), el **sidebar de canales** (216 px, agrupados en texto y voz), el **chat** (flexible) y el **panel de miembros** (216 px, se oculta con el botón "Miembros").

**Alternativas descartadas.**
- *Navegación por pestañas o pantallas apiladas en escritorio:* obliga a ir y volver para cambiar de canal, que es la acción más frecuente.
- *Servidores en un desplegable:* esconde los indicadores de no leído y de menciones de los otros servidores.

**Consecuencias.** Cambiar de servidor o de canal es un solo clic, y todo el contexto queda a la vista. Como el patrón ya es conocido, no hace falta onboarding. En pantallas angostas no entra, y eso lo resuelve [UX-03](#ux-03-en-el-teléfono-un-panel-por-vez).

## UX-03: En el teléfono, un panel por vez

**Contexto.** Por debajo de 768 px de ancho, las columnas de [UX-02](#ux-02-layout-de-chat-en-columnas-servidores--canales--chat--miembros) no entran.

**Decisión.** Por debajo de `NARROW_BREAKPOINT = 768`, la pantalla muestra **un panel a la vez**: servidores + canales, o el chat. El chat tiene una flecha "volver a los canales", y la lista de miembros entra como **hoja lateral** sobre el contenido, con un fondo oscurecido que la cierra al tocarlo. Los botones chicos crecen para que sean fáciles de tocar.

**Alternativas descartadas.**
- *Barra de pestañas inferior:* suma un nivel de navegación que en escritorio no existe, y los dos diseños se alejan.
- *Achicar las columnas:* los nombres de canal y los mensajes quedan ilegibles.

**Consecuencias.** La misma pantalla (`chat.tsx`) sirve para escritorio y teléfono, cambiando solo cómo se acomodan los paneles. La navegación en mobile sigue la jerarquía del dominio (servidor → canal → chat), igual que en escritorio.

## UX-04: Una sola app Expo para web y Android

**Contexto.** Hay que entregar un cliente web y una app mobile con las mismas funciones, y el equipo es chico.

**Decisión.** Una sola base de código Expo (React Native + NativeWind) que se publica como web y se compila como APK. Lo que depende de la plataforma, como la voz o el login con Google, se separa en archivos `.web.tsx` y `.native.tsx`.

**Alternativas descartadas.**
- *Dos apps (web en React y mobile nativa):* duplica cada historia de usuario y los dos diseños terminan divergiendo.

**Consecuencias.** Un cambio de diseño llega a las dos plataformas a la vez, y el sistema de diseño es uno solo. Los detalles propios de cada plataforma (hover, tooltips, mantener apretado) se resuelven con condiciones de `Platform.OS`.

## UX-05: Backoffice como app aparte, organizada por expedientes

**Contexto.** El staff de la plataforma tiene un rol global, independiente de los roles de cada servidor, y toma decisiones con impacto sobre cuentas ajenas: suspender, reactivar, revisar reportes.

**Decisión.** El backoffice es **otra app** (`discordia-backoffice`) con el mismo sistema de diseño y una barra superior con cinco secciones: Usuarios, Servidores, Reportes, Métricas y Observabilidad. Las listas llevan al **expediente** del usuario o del servidor, que reúne su historial, y es ahí donde se toman las medidas. Una etiqueta "Staff" al lado del logo deja claro en qué app estás.

**Alternativas descartadas.**
- *Sección de administración dentro del cliente:* mezcla dos contextos de uso y aumenta el riesgo de que un usuario común vea o toque herramientas de staff.
- *Menú lateral:* con cinco secciones, una barra superior alcanza y deja todo el ancho para las tablas.

**Consecuencias.** El cliente no carga código de staff. Para decidir, el staff ve todo el contexto en un solo lugar (el expediente) en vez de actuar directo desde una fila.

## UX-06: Errores en línea que dicen qué hacer

**Contexto.** El sistema son varios microservicios en un plan gratuito, así que los fallos de red, los timeouts y los `4xx/5xx` pasan seguido. El enunciado exige que ningún fallo deje la interfaz inconsistente o sin feedback (resiliencia en la capa de presentación).

**Decisión.**
- **Los errores se muestran en línea**, en el lugar donde ocurrieron (en el formulario, la lista o el modal), con el componente *Aviso*. Nunca con un `alert()` del sistema.
- **El mensaje siempre es humano y accionable.** `friendlyError` (`lib/api/client.ts`) muestra el detalle del backend solo si es un texto para personas, y si no, uno genérico según el código HTTP. Los detalles técnicos van a la consola, no al usuario.
- **Lo que falló se puede reintentar** sin perder lo que ya se cargó: "Reintentar" en las listas, en el historial y en el login con Google.
- **Los botones dicen lo que está pasando** mientras esperan ("Ingresando…", "Esperando al servidor…") y se deshabilitan para evitar envíos dobles.

**Alternativas descartadas.**
- *Toasts globales:* desaparecen solos y no quedan cerca de lo que falló.
- *Mostrar el error del backend tal cual:* los errores de validación de Pydantic o los 500 no le sirven al usuario.

**Consecuencias.** Cada pantalla tiene que diseñar sus estados de carga, vacío y error, y en Figma los tres aparecen en los componentes *Botón* y *Aviso*.

## UX-07: Avisar cuando el servidor está despertando

**Contexto.** En Render gratuito, los servicios se duermen tras 15 minutos sin tráfico, y la primera request puede tardar hasta un minuto. Sin aviso, el login parece roto.

**Decisión.** Al abrir la app se despiertan los servicios en segundo plano. Si todavía están dormidos, el login muestra un aviso con barra de progreso, "Despertando el servidor. La primera vez puede tardar hasta un minuto; podés ir completando tus datos", y **deja escribir mientras tanto**. Si no responden, el aviso pasa a error con un texto que explica qué hacer.

**Alternativas descartadas.**
- *Spinner bloqueante:* el usuario no sabe si esperar o recargar, y pierde el tiempo en que podría estar completando sus datos.

**Consecuencias.** La espera se ve y se aprovecha. El backoffice usa el mismo mecanismo en su pantalla de carga.

## UX-08: Cambiar de canal o servidor sin pantallas de carga

**Contexto.** Cambiar de canal es la acción más frecuente. Si cada cambio muestra un loader, la app se siente lenta aunque el backend responda bien.

**Decisión.**
- **Caché en memoria por canal y por servidor**, con revalidación en segundo plano: un canal ya visitado se pinta al instante.
- **Precarga** de la primera página de cada canal de texto y de los canales de cada servidor.
- **El loader aparece solo si la carga supera un breve período de gracia**, así un canal rápido nunca "parpadea".
- **Al cambiar de servidor, los mensajes del anterior se limpian enseguida**, para que no queden a la vista mensajes que no corresponden.

**Alternativas descartadas.**
- *Loader en cada cambio:* es simple, pero hace sentir lenta toda la app.

**Consecuencias.** Navegar se siente instantáneo. Las cachés se limitan (LRU) y se borran al cerrar sesión, para que otra cuenta nunca vea datos de la anterior.

## UX-09: Confirmar solo lo irreversible o lo que tiene costo

**Contexto.** Pedir confirmación en todo entrena al usuario a aceptar sin leer. Pero algunas acciones no se pueden deshacer o afectan a otros.

**Decisión.** Se pide confirmación, en un `ModalShell` con el botón en variante *Peligro*, para **borrar** un canal, una categoría o un servidor, **expulsar**, **banear**, **transferir la propiedad**, **salir de un servidor** y **entrar a una llamada de voz**, porque prende el micrófono. Lo reversible se aplica al instante: cambiar un permiso, marcar como leído o editar un mensaje.

Cuando la acción no está permitida, se explica por qué en vez de esconderla sin más. Por ejemplo, el dueño no puede salir de su servidor, y el modal le dice las dos salidas posibles: transferirlo o borrarlo.

**Alternativas descartadas.**
- *Deshacer en vez de confirmar:* no sirve para efectos que el backend aplica enseguida y que notan otros usuarios (un ban, una expulsión).

**Consecuencias.** Cuando aparece un modal de confirmación, el usuario sabe que es en serio.

## UX-10: Acciones sobre un mensaje: hover en web, mantener apretado en mobile

**Contexto.** Cada mensaje tiene acciones (editar, eliminar, reportar), pero mostrarlas siempre llena el chat de botones.

**Decisión.** En web, las acciones aparecen **al pasar el mouse** sobre el mensaje, alineadas a la derecha del autor. En mobile, **mantener apretado** abre una hoja con las mismas acciones. Solo se muestran las que el usuario puede hacer (editar sus propios mensajes, eliminar si tiene `MANAGE_MESSAGES`). La edición es en línea: Enter guarda y Escape cancela.

**Alternativas descartadas.**
- *Menú "⋯" siempre visible:* agrega ruido visual a cada mensaje.

**Consecuencias.** El chat queda limpio y cada plataforma usa su gesto natural. Lo que se descubre menos, porque no está a la vista, se compensa con convenciones conocidas.

## UX-11: La llamada sigue mientras navegás

**Contexto.** Durante una llamada, el usuario quiere seguir leyendo y escribiendo en otros canales.

**Decisión.** La pantalla de voz tiene "Volver al chat", que **no corta la llamada**. Mientras hay una llamada abierta, una **barra de llamada activa** en el sidebar muestra el estado ("Conectando…" o "Conectado a voz") y lleva de vuelta a la llamada o la corta. Los controles de la llamada (micrófono, cámara, compartir pantalla y colgar) son botones redondos grandes. Colgar es el único en rojo.

**Alternativas descartadas.**
- *Llamada en una pantalla exclusiva:* obliga a elegir entre hablar y leer.

**Consecuencias.** Se puede estar en una llamada y en el chat a la vez, y siempre se ve que el micrófono está activo.

## UX-12: Mostrar solo lo que el usuario puede hacer

**Contexto.** Los permisos son por servidor, por rol y por canal. Un botón que siempre termina en "no tenés permiso" frustra.

**Decisión.** Los controles de administración y moderación (crear canales, roles, banear, silenciar…) **solo aparecen si el usuario tiene el permiso**, según `members/me/permissions`. Si no se puede enviar en un canal, el composer lo explica. Si el permiso **todavía no se conoce** (la consulta falló por algo transitorio), el campo no se deshabilita: el backend valida de todas formas.

**Alternativas descartadas.**
- *Mostrar todo deshabilitado:* llena la interfaz de opciones que la mayoría nunca va a usar.

**Consecuencias.** La interfaz de un miembro común es más simple que la de un admin. El backend sigue siendo la fuente de verdad: ocultar un botón no es seguridad.

## UX-13: No leídos visibles en tres niveles

**Contexto.** Con varios servidores y canales, el usuario necesita saber dónde hay algo nuevo sin entrar a todos.

**Decisión.** Hay tres niveles de indicador. En el **servidor**, un punto blanco en su ícono del rail si hay mensajes nuevos (gris si el servidor está silenciado) y un contador rojo con la cantidad de menciones. En el **canal**, el nombre en negrita y un punto. En el **chat**, una línea "Mensajes no leídos" que marca desde dónde leer. Las preferencias de notificación se configuran por canal y por servidor.

**Consecuencias.** Se puede saber qué hay de nuevo con solo mirar el rail y el sidebar.

## UX-14: Español rioplatense y accesibilidad básica

**Contexto.** Los usuarios son de Argentina, y la interfaz se usa con mouse, teclado y pantalla táctil.

**Decisión.**
- **Textos en español rioplatense con voseo** ("Entrá a tu cuenta", "Registrate", "¿Olvidaste tu contraseña?"), cortos y en segunda persona.
- **Etiquetas de accesibilidad** (`accessibilityLabel`) en los botones de solo ícono, **roles** (`alert`, `tab`, `radio`) en avisos y controles, **foco visible** (anillo teal) en los campos, **áreas de toque más grandes** en el teléfono y **tooltip** con el nombre completo del servidor en el rail (web).

**Consecuencias.** La app habla como sus usuarios y se puede usar con lector de pantalla en los flujos principales. El contraste de los textos secundarios queda como punto a revisar en cada iteración.
