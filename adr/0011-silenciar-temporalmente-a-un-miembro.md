# ADR 0011: Silenciar temporalmente a un miembro (texto y voz)

- **Fecha:** 2026-11-11

## Contexto

La historia optativa 60 pide que un miembro con permisos de moderación pueda silenciar a otro durante un tiempo: mientras dure, no puede enviar mensajes ni hablar en los canales de voz del servidor. El silencio vence solo (CA 2) y un moderador lo puede levantar antes (CA 3). En los dos casos, el miembro recupera la voz **en el momento**, aunque siga conectado.

Esto choca con decisiones anteriores:

- **D11 (2026-10-06)** dejó fuera de voz la moderación de servidor (silenciar, ensordecer o mover a otro), porque ninguna historia la pedía. Esta historia la pide, y el grupo confirmó que se suma solo el silencio del micrófono.
- **Voz no tiene base de datos** ([ADR 0004](0004-voz-sin-base-de-datos.md)), así que no puede recordar quién está silenciado ni hasta cuándo, y LiveKit no devuelve un permiso por sí solo cuando pasa un tiempo.
- **El permiso se chequea al entrar** ([ADR 0003](0003-voz-consulta-sincrona-a-servidores.md)). Silenciar a alguien que ya está en una llamada no puede depender de esa consulta.

## Decisión

### Servidores es la fuente de verdad

- **Permiso nuevo `MODERATE_MEMBERS`**, al final del enum (`1 << 11`, después de `MANAGE_MESSAGES`). El bit lo fija el orden de declaración, así que insertarlo en el medio cambiaría permisos ya guardados. No es overwriteable por canal: el silencio es de todo el servidor. `ADMINISTRATOR` y el dueño lo tienen siempre.
- **Tabla de silencios** con una fila por `(server_id, user_id)`: `muted_by`, `reason` opcional, `created_at` y `expires_at`. Silenciar a quien ya está silenciado **reemplaza** la duración, y cuenta como una transición nueva.
- **Endpoints:**
  - `PUT /api/v1/servers/{server_id}/members/{target_user_id}/mute` con `{ "duration_seconds": <int>, "reason": <string|null> }`. Devuelve `201` si lo silenció y `200` si reemplazó un silencio activo. La duración va de 60 segundos a 28 días.
  - `DELETE /api/v1/servers/{server_id}/members/{target_user_id}/mute` levanta el silencio (`204`, o `404` si no estaba silenciado).
  - `GET /api/v1/servers/{server_id}/mutes` lista los silencios activos, para quien tiene `MODERATE_MEMBERS`.
  - `GET /api/v1/servers/{server_id}/members/me/permissions` suma `muted_until`, para que el cliente sepa si el propio usuario está silenciado.
- **Mismas reglas que expulsar** ([historia 59](../eventos.md#serversmemberkicked)): no se puede silenciar a uno mismo (`409`) ni al dueño (`403`), el objetivo tiene que ser miembro (`404`), y quien silencia tiene que tener un rol más alto que el objetivo (`403`).
- **"Silenciado" se decide comparando `expires_at` con la hora actual**, no por la existencia de la fila. Así, un silencio vencido deja de aplicar en el instante, aunque el job todavía no haya borrado la fila.
- **Al expulsar, banear o salir del servidor se borra el silencio** junto con la membresía. Si vuelve, entra sin silencio.

### Acceso interno: `muted_until`

Las dos consultas de acceso suman el campo `muted_until` (fecha ISO 8601, o `null` si no está silenciado o el silencio ya venció). Agregar un campo es compatible y no cambia los que ya existen:

```
GET /internal/voice/channels/{channel_id}/access?user_id={uuid}
200 { "channel": {…}, "can_connect": true, "muted_until": "2026-11-11T21:00:00+00:00" }

GET /internal/messages/channels/{channel_id}/access?user_id={uuid}
200 { "channel": {…}, "can_send": true, …, "muted_until": null }
```

`can_send` y `can_connect` no cambian de significado: hablan del permiso del rol. Un miembro silenciado puede seguir entrando a un canal de voz para escuchar y puede seguir leyendo los canales de texto.

### Eventos

Servidores emite por outbox, en la misma transacción que el cambio:

- `servers.member.muted` al silenciar o al reemplazar la duración;
- `servers.member.unmuted` al levantarlo a mano **o al vencer**. Es el mismo evento en los dos casos, con `unmuted_by: null` cuando venció.

El detalle de los campos está en el [catálogo de eventos](../eventos.md#serversmembermuted).

### Expiración: un job en servidores

Un job periódico de servidores, cada 30 segundos, toma los silencios con `expires_at <= ahora`, los borra y emite `servers.member.unmuted` por cada uno. Toma las filas con `FOR UPDATE SKIP LOCKED`, así dos instancias de servidores no emiten el mismo vencimiento dos veces.

- Cada pasada abre su **propio span raíz** (`mute.expire`) antes de escribir en el outbox. Si no, el evento saldría sin `traceparent` ([observabilidad](../observabilidad.md#eventos)).
- El log de cada vencimiento aclara que lo hizo el sistema (`unmuted_by: null`).

El job solo hace falta para devolverle la voz **en vivo** a quien sigue conectado. Para todo lo demás alcanza con la comparación de `expires_at`, así que un job atrasado demora el regreso del micrófono hasta 30 segundos, pero nunca deja a alguien silenciado de más en el texto ni al reconectar.

### Voz: quitar el micrófono en vivo

- `media.Client` suma un método que cambia, para un participante de una sala, las fuentes que puede publicar (`UpdateParticipant` de LiveKit con nuevos `ParticipantPermission`). Al quitar una fuente, LiveKit despublica la pista de esa fuente.
- **Ante `servers.member.muted`:** voz busca las salas del usuario con ese `server_id` en la metadata, igual que con el baneo ([ADR 0007](0007-revocacion-de-acceso-por-servidor.md)), y en cada una le saca **solo** `microphone`. Si `expires_at` ya pasó, ignora el evento.
- **Ante `servers.member.unmuted`:** en las mismas salas le devuelve las fuentes configuradas (`MEDIA_ALLOWED_SOURCES`).
- **Al entrar** (`join`), si `muted_until` está en el futuro, el token sale sin `microphone`. Así, salir y volver a entrar no levanta el silencio.
- Voz sigue sin base de datos: todo lo que necesita viene en el evento o en la consulta de acceso.
- Las llamadas a LiveKit llevan un span manual, como el resto de `media.Client`.

### Mensajes: rechazar el envío

Al enviar, si `muted_until` está en el futuro, mensajes responde `403` con un detalle que dice hasta cuándo dura el silencio. Leer y suscribirse no cambian. El cambio en el contrato se acordó con quien mantiene mensajes.

### Cliente

- El cliente no necesita un mensaje nuevo por WebSocket. LiveKit le avisa al participante cuando cambian sus permisos (`ParticipantPermissionsChanged`), y con eso deshabilita o habilita el micrófono.
- Para el texto, usa `muted_until` de `members/me/permissions` y deshabilita el campo de envío hasta esa hora. El `403` del envío lo cubre si el dato quedó viejo.

### Logs

Nunca se loguea el motivo, solo ids y la duración.

## Alternativas descartadas

- **Que voz lleve la cuenta de los silencios:** obliga a voz a tener estado propio y un timer por silencio, contra el [ADR 0004](0004-voz-sin-base-de-datos.md). Además, un timer en memoria se pierde si la instancia se reinicia.
- **Un evento `servers.member.mute_expired` distinto de `unmuted`:** para los consumidores es el mismo efecto. Con un solo tipo, y `unmuted_by: null`, alcanza para distinguirlos en la auditoría.
- **Que mensajes y voz programen la expiración cada uno:** duplicaría la lógica en dos servicios y haría falta que los dos acuerden la hora de vencimiento.
- **Que el token de LiveKit venza junto con el silencio:** el TTL del token solo vale para conectar y no corta una sesión ya establecida, así que no sirve para quitar ni devolver el micrófono en vivo.
- **Desconectar al silenciado de la sala de voz:** la historia pide que no pueda hablar, no que deje de escuchar. Y si lo desconecta, podría volver a entrar con un join.
- **Silenciar también pantalla y video:** la historia habla de "hablar por voz". Se quita solo `microphone`. El audio de una pantalla compartida (`screen_share_audio`) queda permitido: es una limitación conocida.

## Consecuencias

- **Reabre D11 solo para el silencio del micrófono.** Ensordecer, mover o desconectar a otro siguen fuera del alcance.
- **Voz suma una llamada a LiveKit por sala** en cada silencio, y busca las salas en O(salas), igual que con el baneo.
- **Desorden entre eventos.** Si un `unmuted` viejo llega después de un `muted` nuevo, voz le devolvería el micrófono a alguien que sigue silenciado. Es raro, porque los dos salen del mismo stream y en orden, y se corrige solo al reconectar. Se acepta en vez de agregar una consulta síncrona a servidores por cada evento.
- **Si voz se pierde un evento** (por ejemplo, porque LiveKit no respondió y se agotaron los reintentos), el micrófono queda como estaba hasta que el usuario reconecte. El texto no se ve afectado, porque mensajes consulta en cada envío.
- **El cambio de contrato** de `ChannelAccess` en mensajes es solo un campo nuevo. Los consumidores que no lo conozcan lo ignoran.
