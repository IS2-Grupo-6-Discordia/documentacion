# Sistema de diseño

- **Prototipos y componentes en Figma:** [Discordia — Prototipos y sistema de diseño](https://www.figma.com/design/YV4I8KiDbfm8lBaauL7dx5)
  - Página **Sistema de diseño**: colores, tipografía y componentes.
  - Página **Prototipos**: cliente web, app mobile y backoffice, con navegación clickeable ([ver como prototipo](https://www.figma.com/proto/YV4I8KiDbfm8lBaauL7dx5?node-id=4-7&starting-point-node-id=4-7)).
- **Decisiones de UX y su porqué:** [decisiones-ux.md](decisiones-ux.md)

## Qué sistema usamos

Un **sistema propio, oscuro**, construido con [NativeWind](https://www.nativewind.dev/) (Tailwind sobre React Native / Expo). No adoptamos Material ni HIG enteros: en un chat la densidad y la consistencia entre web, Android y backoffice pesan más que seguir las convenciones de una sola plataforma. Sí tomamos de esos sistemas lo que aplica a todos: tamaños mínimos de toque en mobile, foco visible, feedback al presionar y estados de error en línea.

La **única fuente de verdad** de los tokens es `tailwind.config.ts`, idéntico en `discordia-cliente-web` (web + APK) y `discordia-backoffice`. En Figma cada variable tiene como *code syntax* el nombre de la clase Tailwind, así un token se busca igual en el diseño y en el código.

## Tokens

### Color

| Token (Figma) | Clase Tailwind | Valor | Uso |
|---|---|---|---|
| `bg` | `bg` | `#0A1620` | Fondo de toda la app |
| `surface/1` | `surface` | blanco 5,5 % | Paneles: sidebar de canales, tarjetas |
| `surface/2` | `surface-2` | blanco 10 % | Superficie elevada, hover, composer |
| `surface/3` | `surface-3` | blanco 15 % | Rail de servidores, botón deshabilitado |
| `border/1` | `border` | blanco 13 % | Separadores y bordes por defecto |
| `border/2` | `border-2` | blanco 24 % | Bordes con más contraste |
| `text/default` | `text` | `#E6F3F3` | Texto principal |
| `text/muted` | `muted` | `#8DA8AC` | Texto secundario, labels |
| `text/subtle` | `subtle` | `#5E7E82` | Placeholders, metadatos |
| `primary/default` | `primary` | `#37D6C0` | Acción principal, foco, selección |
| `primary/hover` | `primary-h` | `#2BC4AF` | Hover de la acción principal |
| `primary/dim` | `primary-d` | teal 17 % | Fondo de chips y estados activos |
| `primary/ink` | `primary-ink` | `#04211D` | Texto sobre `primary` |
| `accent/default` · `accent/dim` | `accent` · `accent-d` | `#F0C24B` | Avisos (sesión expirada, servidor despertando) |
| `danger/default` · `danger/dim` | `danger` · `danger-d` | `#FF7F72` | Errores y acciones destructivas |
| `success/default` · `success/dim` | `success` · `success-d` | `#4FD69C` | Confirmaciones |
| `status/online` · `away` · `offline` | `online` · `away` · `offline` | verde · amarillo · blanco 24 % | Presencia |
| `selection` | `sel` | teal 15 % | Canal o fila seleccionada |

Reglas:

- **Un solo color de acción.** El teal marca lo que se puede hacer y lo que está seleccionado. No hay un segundo color de marca que compita.
- **Las superficies son capas de blanco translúcido** sobre el fondo. La jerarquía se arma con capas (`surface/1` → `/2` → `/3`), no sumando colores.
- **Los colores semánticos significan siempre lo mismo:** amarillo = aviso, rojo = error o algo irreversible, verde = éxito o presencia. Cada uno tiene su versión `dim` para el fondo del aviso, con el color pleno en el borde y el ícono.

### Tipografía

Fuente **del sistema** (`fontFamily: System`): SF Pro en Apple, Roboto en Android, Segoe UI en Windows. La app se siente nativa en cada plataforma y no hay que cargar fuentes. En Figma se representa con **Inter**, que tiene métricas parecidas.

| Estilo | Tamaño / peso | Uso |
|---|---|---|
| Título/Pantalla | 22 · 800 | Título de las pantallas de autenticación |
| Título/Sección | 20 · 800 | Título de las secciones del backoffice |
| Título/Modal | 16 · 700 | Títulos de modales, nombre del servidor |
| Cuerpo/Base | 14 · 400 | Campos de texto, contenido general |
| Cuerpo/Mensaje · Cuerpo/Autor | 12,5 · 400 / 700 | Mensajes del chat y su autor |
| Cuerpo/Secundario | 12 · 400 | Subtítulos, avisos |
| Botón/Principal | 14 · 700 | Botones |
| Etiqueta/Campo | 10 · 600, MAYÚSCULAS, tracking 1,1 | Labels de campos y encabezados de grupo |
| Etiqueta/Rol | 9 · 800, MAYÚSCULAS | Tags de rol y estado |
| Metadato | 10 · 400 | Hora, "(editado)", ayudas |

La escala es **compacta a propósito**: en un chat se leen muchos mensajes cortos, y una escala de lectura (16 px de cuerpo) obliga a scrollear el doble.

### Forma y espaciado

| Token | Valor | Uso |
|---|---|---|
| `radius/control` | 10 | Botones, campos y controles: un único radio para todo lo que se toca |
| `radius/banner` | 12 | Avisos en línea |
| `radius/brand` | 14 | Marca "D" |
| `radius/card` | 18 | Tarjetas (`rounded-card`): login, KPIs del backoffice |
| `radius/pill` | 9999 | Chips de filtro y de estado |
| `space/1…6` | 4 · 8 · 12 · 16 · 24 | Escala de espaciado en múltiplos de 4 |

## Componentes

Están en `components/` de cada app y tienen su equivalente en la página **Sistema de diseño** de Figma.

| Componente | Archivo | Variantes | Regla |
|---|---|---|---|
| Botón | `PressableScale` | Primario · Secundario · Peligro · Cargando | Escala a 0,97 al presionar (y hover en web). Un solo primario por pantalla o modal. "Cargando" deshabilita el botón y dice qué está pasando ("Ingresando…", "Esperando al servidor…") |
| Campo | `AuthField` | Vacío · Foco · Error | Label en mayúsculas arriba, anillo teal en foco, borde rojo en error. Las contraseñas tienen un botón de ojo |
| Aviso | patrón en línea | Info · Advertencia · Error | Ícono + texto que explica qué pasó y qué hacer. Nunca un `alert()` del sistema |
| Modal | `ModalShell` | — | Fondo oscurecido, una tarjeta con título, subtítulo opcional y botón de cierre en la esquina. Todos los modales usan este marco |
| Tag / rol | `Tag` | Dueño · Admin · Staff · Suspendido | Junto al autor del mensaje y en las filas de miembros o usuarios |
| Avatar + presencia | `Avatar`, `StatusDot` | En línea · Ausente · Desconectado | Iniciales sobre teal tenue si no hay foto. El punto de presencia va abajo a la derecha |
| Fila de canal | (en `chat.tsx`) | Normal · Seleccionado · No leído; Texto · Voz | Seleccionado = fondo y texto teal. No leído = negrita + punto |
| Ícono de servidor | (en `chat.tsx`) | Normal · Activo · Con menciones | 34 px. El activo se rellena de teal y suma una barra teal a la izquierda. Los no leídos se marcan con un punto blanco arriba y las menciones con un contador rojo abajo |
| Toggle | `Toggle` | Sí · No | Para preferencias y permisos que se aplican al instante |

## Cómo mantenerlo

- **Un color, radio o tamaño nuevo se agrega primero en `tailwind.config.ts`** de las dos apps, y después en las variables de Figma con el mismo nombre de clase.
- **Antes de crear un componente, buscar si ya existe** en `components/`. Las variantes se agregan al componente existente; no se crea uno nuevo.
- **Las pantallas nuevas se dibujan en Figma con los componentes de la librería** antes de implementarlas, y se presentan en la weekly.
