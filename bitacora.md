# Bitácora del proyecto

Evolución semana por semana del backlog y del trabajo de Discordia, desde el armado del backlog (31/08) hasta la semana previa a la entrega final (04/12).

- **Backlog:** los issues de este repo, en los tableros [Historias Obligatorias](https://github.com/orgs/IS2-Grupo-6-Discordia/projects/1) y [Historias Optativas](https://github.com/orgs/IS2-Grupo-6-Discordia/projects/2).
- **Trabajo:** los PRs mergeados en los 9 repos de la organización. No se cuentan los PRs de sincronización entre `develop` y `main`.
- Los datos salen de GitHub (fechas de creación y cierre de los issues y de merge de los PRs). Las semanas van de lunes a domingo.

## Resumen

| Semana | Hito | Issues nuevos | Issues cerrados | Backlog abierto al cierre | PRs mergeados |
|---|---|---:|---:|---:|---:|
| 31/08 – 06/09 | Checkpoint 0 (04/09) | 81 | 0 | 81 | 0 |
| 07/09 – 13/09 | | 2 | 2 | 81 | 3 |
| 14/09 – 20/09 | | 0 | 5 | 76 | 0 |
| 21/09 – 27/09 | Checkpoint 1 (25/09) | 0 | 2 | 74 | 2 |
| 28/09 – 04/10 | | 4 | 12 | 66 | 5 |
| 05/10 – 11/10 | | 1 | 7 | 60 | 6 |
| 12/10 – 18/10 | | 9 | 5 | 64 | 10 |
| 19/10 – 25/10 | Checkpoint 2 (23/10) | 7 | 25 | 46 | 18 |
| 26/10 – 01/11 | | 1 | 2 | 45 | 55 |
| 02/11 – 08/11 | | 3 | 12 | 36 | 53 |
| 09/11 – 15/11 | Checkpoint 3 (13/11) | 0 | 4 | 32 | 68 |
| 16/11 – 22/11 | | 25 | 23 | 34 | 48 |
| 23/11 – 29/11 | | 4 | 15 | 23 | 17 |

En total entraron **137 issues**, se cerraron **114** y se mergearon **285 PRs**. De los **23 abiertos**, 15 son historias optativas que el grupo no eligió (monetización, mensajes directos, adjuntos, búsqueda, reacciones, notificaciones push, entre otras), 1 es una optativa ya hecha que falta cerrar y 7 son tareas técnicas, de testing o de documentación (ver [Estado al cierre](#estado-al-cierre)).

Se ven tres etapas:

1. **Septiembre: base y primeras historias.** Poco volumen de PRs: se armaron los repos, la infraestructura y la autenticación, y se integró el frontend con el gateway.
2. **Octubre: el núcleo.** Roles, canales, voz, moderación y el bus de eventos. El backlog abierto baja de 74 a 45.
3. **Noviembre: optativas y requisitos no funcionales.** El pico de PRs (entre 48 y 68 por semana) llega con la mensajería, las optativas y la observabilidad. Del 16/11 en adelante se cargaron 29 tareas de infraestructura, testing, seguridad y documentación para cerrar los requisitos no funcionales, y se cerraron 38.

## Semana por semana

### 31/08 – 06/09 · Checkpoint 0

- Se cargó el backlog completo: **81 issues**, uno por historia del enunciado, con su épica como etiqueta, y las tareas de setup.
- Checkpoint 0 el 04/09.

### 07/09 – 13/09

- Se crearon los repos de los microservicios y el repo `root`, que levanta todo en local con `docker compose` (#82, #83).
- Gateway: primeras rutas de registro y login (gateway#7 a #9).

### 14/09 – 20/09

- Se cerraron las primeras historias: registro, login, crear servidor, generar invitación y unirse por invitación.

### 21/09 – 27/09 · Checkpoint 1

- Frontend: login, registro y logout conectados al backend real a través del gateway, y mocks de servidores y mensajes (frontend#12, #13).
- Se cerraron edición de perfil y recupero de contraseña.

### 28/09 – 04/10

- **Infraestructura en la nube:** Render para los microservicios y el gateway, Supabase para la base y Vercel para los frontends (#85 a #87), y la integración del frontend con el backend (#84).
- Servidores: primeros endpoints de roles (servidores#7, #8). Autenticación: bcrypt fuera del event loop y caché del cliente de R2.
- 12 issues cerrados, entre ellos login con Google, perfil público, abandonar servidor, transferir propiedad y crear canal.

### 05/10 – 11/10

- **Arranca voz:** scaffolding del microservicio en Go y el spike del join con LiveKit (voz#3 a #5).
- Documentación: ADRs de voz y del bus de eventos (documentacion#88, #90), y Redis compartido en `root` para el bus.
- Se cerraron suspender y reactivar usuarios, el listado de usuarios y el resto de roles (editar permisos, asignar, rol por defecto).

### 12/10 – 18/10

- Voz integrada con servidores en el join y desplegada en Render con su ruta en el gateway.
- Eventos de suspensión publicados por autenticación y consumidos por voz.
- Servidores: crear canal y migraciones al arrancar el contenedor. Frontend: Expo SDK 57.
- Se sumaron 9 tareas de backend y frontend para dividir historias grandes.

### 19/10 – 25/10 · Checkpoint 2

- **La semana con más historias cerradas (25).** Voz: unirse, salir, silenciarse y ver participantes. Roles: eliminar, reordenar, permisos por canal y miembros por rol. Moderación: banear y revocar baneo. Canales: editar, eliminar y reordenar.
- La app de Android pasa a publicarse como APK en cada merge a `main` (frontend#27).
- Documentación de baneos y del tiempo real (documentacion#101, #102).

### 26/10 – 01/11

- **Observabilidad:** logs JSON con `request_id`, trazas con OpenTelemetry y exportación a Grafana Cloud en autenticación, servidores y voz, con los headers de traza en el gateway y los clientes (documentacion#110 a #113).
- **Mi cuenta:** cambiar contraseña y email, y código de verificación en el registro.
- Backoffice: suspender y reactivar servidores, renovación de sesión y deploy en Cloudflare Pages.
- Voz: cámara y compartir pantalla. Mensajes: esqueleto del microservicio.
- 55 PRs, el primer salto grande de volumen.

### 02/11 – 08/11

- **Mensajería en tiempo real:** enviar mensajes, historial paginado y el ADR 0009 de tiempo real (documentacion#117).
- **Administración completa:** expedientes de usuario y servidor, eliminar servidores, reportes y métricas globales en el backoffice.
- Verificación en dos pasos en la app y en el backoffice. Categorías de canales.
- Health checks `/livez` y `/readyz` en todos los servicios (ADR 0010).
- 12 issues cerrados, entre ellos 2FA, reportar mensajes, registro de auditoría y compartir pantalla.

### 09/11 – 15/11 · Checkpoint 3

- **El pico de trabajo: 68 PRs.**
- Optativas de moderación: expulsar (#59), silenciar temporalmente (#60) y filtro de palabras prohibidas (#63), con sus ADRs 0011 y 0012.
- Mensajes: menciones, editar y eliminar con actualización en vivo, y consumo de eventos para cortar el tiempo real al perder el acceso.
- Notificaciones: no leídas, marcar como leídas y silenciar por canal o servidor.
- Llamadas privadas 1 a 1, estado personalizado, métricas por servidor y la pantalla de observabilidad del backoffice (ADR 0013).
- Se eliminó el `/health` genérico.

### 16/11 – 22/11

- **Relevamiento de los requisitos no funcionales:** entraron 25 tareas de infraestructura, testing, seguridad, UX y documentación, y se cerraron 23 issues.
- Documentación: ADR 0014 (gateway) y 0015 (lenguajes y bases de datos), mapa de arquitectura actualizado, sistema de diseño y decisiones de UX con los prototipos de Figma, y README de setup en cada repo.
- Infraestructura: Blueprint de Render para recrear producción, trazas y logs del gateway, y CI de tipos en los frontends.
- Seguridad: límite de intentos de login por cuenta, rate limit por minuto en el gateway, tope de 1 hora del token de recupero y validación del formato real de las imágenes.
- UX: contraste y tamaño mínimo de texto, timeouts y error boundary en los clientes.
- Optativas: gráfico de crecimiento de miembros, preferencias de notificación, centro de notificaciones y video en llamada.

### 23/11 – 29/11

- **Pruebas de carga y estrés con k6** y su informe (documentacion#161): el cuello de botella era servidores, y con 4 workers el p95 del envío bajó de 889 ms a 112 ms.
- ADR 0016 de despliegue en la nube y diagramas C4 (documentacion#162, #163).
- CI: análisis estático de seguridad (reglas de bandit en ruff) en los servicios Python, y CI en cada push a `develop` en los 5 repos de backend.
- Arreglos de producción en el gateway (IP real detrás de Cloudflare, JWKS al arrancar) y reintentos ante fallas transitorias de autenticación en los clientes.
- Guías de usuario de la app y del backoffice (#165), mutation testing en mensajes (#166) y esta bitácora (#168).

## Estado al cierre

Abiertos al 26/11, sin contar la tarea de esta bitácora (#168):

| Tipo | Issues |
|---|---|
| Tareas técnicas en curso | #136 Pruebas de integración entre servicios core · #140 Envío de mensajes idempotente · #144 Mantenimiento · #146 Rendimiento |
| Documentación y testing | #165 Guías de usuario · #166 Mutation testing |
| Para revisar | #138 CI del cliente web y el backoffice (ya resuelto por #158) · #67 Centro de notificaciones (frontend#98 ya mergeado) |
| Optativas no elegidas | #34 Registro con PIN · #42 DMs · #43 Bloquear usuarios · #47 Adjuntos · #48 Reacciones · #49 Buscar mensajes · #66 Notificaciones push · #74 Exportar métricas a CSV · #75 Estado de la plataforma · #76 a #81 Monetización |
