# ADR 0009: Tiempo real de mensajes

- **Fecha:** 2026-11-02

## Contexto

La historia 15 ("Enviar mensaje en un canal") pide que un mensaje se entregue en tiempo real a todos los miembros conectados al canal (CA 1), y la historia 16 ("Historial y reconexión") pide que, tras una desconexión breve, el usuario no pierda los mensajes enviados mientras estuvo fuera (CA 2). El enunciado recomienda WebSockets con reconexión y pide pub/sub entre las instancias del servicio de mensajes.

El contrato de tiempo real y la forma de abrir el WebSocket ya están decididos para todos los servicios ([ADR 0006](0006-tiempo-real-websocket-por-servicio.md)): ticket por el gateway, WebSocket directo al servicio, una suscripción por recurso y el servicio autoriza cada suscripción con la misma regla que usa en HTTP. Falta decidir las piezas propias de mensajes:

- **Mensajes no tiene Redis hoy.** El bus de eventos corre sobre un Redis compartido ([ADR 0001](0001-bus-de-eventos-redis-streams.md)), pero mensajes todavía no lo usa.
- **Mensajes no tiene el estado de servidores:** membresías, baneos, roles, el bitmask de permisos ni la suspensión de un servidor. Todo eso vive en servidores, igual que para voz ([ADR 0003](0003-voz-consulta-sincrona-a-servidores.md)).
- **El enunciado pide un punto único de entrada** y que cualquier llamada síncrona entre servicios se justifique.
- **Render (plan free):** los servicios se duermen sin tráfico, con cold starts de 30 a 60 s, y pueden dar errores pasajeros durante un deploy.
- **Divergencia de suspensión:** el cliente ya tiene enganchada la UI de "servidor suspendido" al status **423** que devuelve servidores en sus rutas de miembros ([`eventos.md`](../eventos.md#serversserversuspended)).
- **Stack distinto al de voz:** mensajes es Python/FastAPI, no Go. La resiliencia del ADR 0005 está escrita para Go (`sony/gobreaker`) y hay que adaptarla.

## Decisión

### Mensajes sirve su propio WebSocket

Mensajes mantiene sus propios WebSocket siguiendo el **contrato común** ([`tiempo-real.md`](../tiempo-real.md), [ADR 0006](0006-tiempo-real-websocket-por-servicio.md)): ticket por el gateway (`POST /api/v1/messages/realtime/ticket`), WebSocket directo al servicio, una suscripción por canal de texto (`channel_id`).

Cuando se crea un mensaje, mensajes publica el frame `messages.created` ([contrato](../tiempo-real.md#mensajes)) a las conexiones suscriptas al canal, **después** de que la transacción de base de datos del mensaje commitea. El frame es **incremental**: un mensaje nuevo, no el estado completo del canal. La recuperación tras un corte no se apoya en el bus sino en que el cliente vuelve a pedir el historial por HTTP y mergea por `id` (historia 16, CA 2).

### Reparto entre instancias con Redis Pub/Sub

Mensajes reparte los `messages.created` (y las revocaciones de acceso) entre sus instancias con **Redis Pub/Sub**, en el namespace `mensajes:realtime:*`, sobre el **mismo Redis del bus de eventos** ([ADR 0001](0001-bus-de-eventos-redis-streams.md), [ADR 0006](0006-tiempo-real-websocket-por-servicio.md)). Como mensajes todavía no usa Redis, esto suma una **dependencia de runtime nueva** (`REDIS_URL`).

### Autorización por consulta síncrona a servidores

Tanto al suscribirse por WebSocket como en el `GET` del historial, mensajes **consulta a servidores de forma síncrona** para decidir el acceso, con la misma regla en los dos caminos (la autorización de la suscripción no es más laxa que la de HTTP, [ADR 0006](0006-tiempo-real-websocket-por-servicio.md)). Mensajes no replica la lógica de roles de servidores: solo usa la respuesta.

```
GET /internal/messages/channels/{channel_id}/access?user_id={uuid}
X-Service-Secret: <secreto del par mensajes → servidores>

200 { "channel": { "id": "...", "server_id": "...", "type": "text" }, "can_read": true }
403 el usuario no es miembro del servidor (o está baneado)
404 el canal no existe
409 el canal no es de texto
423 el servidor está suspendido
```

- Las rutas `/internal/*` no se publican en el gateway. Se protegen con un **secreto propio del par mensajes → servidores** (`X-Service-Secret`, con el valor de `SERVICE_SECRET_MENSAJES` del lado de servidores), distinto del secreto del gateway.
- El `user_id` va por query porque lo manda mensajes, un servicio de confianza, que lo toma de `X-User-Id`; el usuario final nunca elige ese valor.

### Mapeo de la suspensión a 423

El endpoint interno de mensajes mapea "servidor suspendido" a **423**, mientras que el de voz lo trata como 403 (y no se cambia). Dos motivos:

1. El cliente ya tiene la UI de "servidor suspendido" enganchada al 423 que devuelven las rutas de miembros de servidores. Reusar ese status evita un camino nuevo en el cliente.
2. En el endpoint interno de mensajes, la **membresía y el baneo se chequean antes que la suspensión**. Así un usuario que no es miembro recibe **403** y no se entera, por un 423, de que el servidor existe y está suspendido.

### Resiliencia ante servidores

Se adapta el esquema del [ADR 0005](0005-voz-resiliencia-ante-servidores.md) (escrito para Go/`sony/gobreaker`) al stack de mensajes (Python/`httpx`):

- **Timeouts:** 2 s por intento, 5 s total por consulta (incluidos reintentos y esperas).
- **Reintentos:** hasta 3 intentos dentro del tope total, con backoff exponencial y jitter (50-100 ms antes del segundo intento, 100-200 ms antes del tercero). Solo se reintentan los fallos de disponibilidad (5xx, timeout o error de red).
- **Circuit breaker en memoria, por instancia:** se abre tras 5 consultas fallidas seguidas, queda abierto 30 s y después deja pasar una sonda (half-open). No hace falta compartirlo entre instancias.
- **Falla cerrado → 503:** agotados los reintentos o con el breaker abierto, el `GET`/`POST` responde **503**. En el WebSocket, un `subscribe` que no se puede autorizar responde un `error` 503.
- **Respuestas definitivas:** 403, 404, 409 y **423** no se reintentan ni cuentan como fallo para el breaker, porque muestran que servidores respondió.

## Alternativas descartadas

- **RabbitMQ, Kafka o NATS para el reparto entre instancias:** son infraestructura más pesada y no están en el stack; sumarlas solo para el fan-out de mensajes a los sockets no se justifica. La no-retención de Redis Pub/Sub —que sería el argumento a favor de un bus persistente— es aceptable acá, porque la recuperación de los mensajes perdidos durante una desconexión se resuelve con el refetch del historial por HTTP (historia 16, CA 2), no con el bus. El enunciado pide justificar en un ADR la tecnología de pub/sub elegida.
- **Un stream de Redis (como el bus de eventos) en lugar de Pub/Sub:** retiene y permite releer, pero el fan-out a los sockets no necesita retención ni consumer groups: cada instancia solo quiere enterarse de lo que pasa ahora para empujarlo a sus conexiones. Pub/Sub es más simple para eso y la recuperación ya está cubierta por el historial.
- **Réplica local del estado de servidores en mensajes, alimentada por eventos:** evita la llamada síncrona, pero obliga a mensajes a reimplementar el cálculo de permisos de servidores, la fuente más probable de bugs de seguridad. Es el mismo descarte que hizo voz ([ADR 0003](0003-voz-consulta-sincrona-a-servidores.md)).
- **Confiar en lo que manda el cliente o en el JWT:** el JWT solo trae el rol global (`user`/`staff`), no los roles por servidor. No alcanza para decidir el acceso a un canal.
- **Mapear la suspensión a 403 como voz:** sería más uniforme entre servicios, pero obligaría al cliente a un camino nuevo para distinguir "no sos miembro" de "el servidor está suspendido", cuando ya tiene la UI del 423 de las rutas HTTP de servidores.
- **Polling en lugar de WebSocket:** no cumple la entrega en tiempo real que pide la historia 15. Queda como respaldo del cliente si el WebSocket no conecta.

## Consecuencias

- **El `GET` del historial también lleva el chequeo de acceso** (la misma regla en HTTP y en la suscripción, [ADR 0006](0006-tiempo-real-websocket-por-servicio.md)). En consecuencia, **el staff y la moderación que no sean miembros del servidor reciben 403** en ese `GET`: ver el historial de un canal exige acceso al servidor, no un rol de plataforma.
- **Dependencia de servidores:** con servidores caído, el `GET` y el `POST` de mensajes fallan cerrado con **503**. El **polling de respaldo del cliente** (cada 5 s) debe hacer **backoff ante un 503** (hasta 30 s, y vuelve a 5 s con la primera respuesta correcta) para no agravar la caída mientras servidores se recupera o despierta de un cold start.
- **Cold start de servidores:** el primer acceso después de que servidores se durmió puede dar 503, igual que en voz ([ADR 0005](0005-voz-resiliencia-ante-servidores.md)). El cliente recibe un error claro y reintenta con backoff.
- **Redis es una dependencia de runtime nueva para mensajes** (`REDIS_URL`), compartido con el bus de eventos.
- **Entrega en vivo best effort:** `messages.created` y `messages.access_revoked` se pueden perder si el socket estaba caído (Pub/Sub no retiene). El cliente lo cubre con el refetch del historial al reconectar y con el 403/423 de la próxima llamada HTTP.
- **Pendiente (fuera de alcance de esta historia):**
  - Consumir `auth.user.suspended`, `servers.member.banned` y `servers.server.suspended` para cortar la entrega en un socket ya abierto. Hoy la revocación en vivo se limita al esquema por servidor del [ADR 0007](0007-revocacion-de-acceso-por-servidor.md) con el tipo propio de mensajes; la suspensión global y el baneo se resuelven al reconectar y en la próxima llamada HTTP.
  - Las rutas públicas de servidores filtran la suspensión (devuelven 423 **antes** de verificar la membresía, por el dependency `reject_suspended_server`), lo que deja que un no miembro distinga un servidor suspendido. No se corrige en esta historia; el endpoint interno de mensajes sí chequea la membresía antes que la suspensión.
