# Contrato de tiempo real (WebSocket)

Contrato común de los WebSocket de los servicios. La decisión está en el [ADR 0006](adr/0006-tiempo-real-websocket-por-servicio.md). Cada servicio documenta en su `agents/integraciones.md` los tipos de mensaje propios.

| Servicio | Pedido de ticket (por el gateway) | Mensajes |
|---|---|---|
| voz | `POST /api/v1/voice/realtime/ticket` | [Voz](#voz) |
| mensajes | `POST /api/v1/messages/realtime/ticket` | [Mensajes](#mensajes) |

## Ticket

```
POST /api/v1/<dominio>/realtime/ticket      (con Authorization: Bearer <JWT>)
200 {"url": "wss://<servicio>/ws", "ticket": "<opaco>", "expires_in": 30}
```

- **Opaco:** 32 bytes aleatorios en base64url. El servicio guarda en Redis el **sha256** del ticket, nunca el ticket, con `SET NX EX 30` y el `user_id` como valor.
- **De un solo uso:** se canjea con `GETDEL`. Si se corta la conexión, el cliente pide un ticket nuevo.
- **Nunca se loguea** el ticket ni la URL completa con el ticket.

## Conexión

```
GET wss://<servicio>/ws?ticket=<ticket>
```

- **`Origin`:** tiene que estar en la lista de orígenes permitidos del servicio (los mismos que el CORS del gateway). Si no está, se responde **403** sin hacer el upgrade. Los clientes nativos que no mandan `Origin` se aceptan.
- **Ticket inválido, vencido o ya usado:** se acepta el upgrade y se cierra enseguida con el código **4401**. El navegador no deja leer el status HTTP de un upgrade fallido; el código de cierre sí, así el cliente distingue "pedir otro ticket" de "no hay red".
- **Ping:** el servidor manda un ping cada **25 s**. El navegador responde solo. Si no llega el pong en 10 s, el servidor cierra.

## Mensajes

JSON de texto, uno por frame, siempre con `type`. Tamaño máximo de un mensaje del cliente: 4 KiB. Los campos desconocidos se ignoran.

### Del cliente al servidor

```json
{"type": "subscribe",   "channel_ids": ["<uuid>", "..."]}
{"type": "unsubscribe", "channel_ids": ["<uuid>", "..."]}
```

- Suscribirse dos veces al mismo recurso no es un error: vuelve a mandar el estado actual.
- Hay un límite de suscripciones por conexión (en voz, 50). Pasarlo responde un `error` 429 para los recursos que sobran.

### Del servidor al cliente

```json
{"type": "error", "code": 403, "detail": "No tenés acceso a este canal.", "channel_id": "<uuid>"}
```

- **`code`:** usa la semántica de los status HTTP (400, 403, 404, 409, 423, 429, 503). Un `error` **no cierra** la conexión.
- **`detail`:** en castellano, se le puede mostrar al usuario.
- **`channel_id`:** solo aparece si el error es de un recurso puntual.

Los demás tipos los define cada servicio. Convención: `<dominio>.<cosa>`, por ejemplo `voice.participants`.

### Códigos de cierre

| Código | Significado | Qué hace el cliente |
|---|---|---|
| 1000 | Cierre normal (el cliente se fue) | Nada |
| 1001 | El servidor se apaga o se redespliega | Reconectar |
| 1008 | Mensaje inválido (no es JSON de texto) o no respondió el ping | Reconectar; si se repite por mensajes inválidos, es un bug del cliente |
| 1009 | Mensaje del cliente demasiado grande | Ídem |
| 1011 | Error interno (por ejemplo, no se pudo validar el ticket) | Reconectar |
| 1013 | El cliente no lee los mensajes a tiempo | Reconectar con backoff |
| 4401 | Ticket inválido, vencido o ya usado | Pedir un ticket nuevo y reconectar |
| 4403 | Se perdió el acceso (por ejemplo, suspensión) | No reconectar hasta que cambie la sesión |
| 4429 | Demasiadas conexiones de este usuario | Reconectar con backoff |

> **Ping sin pong:** si no llega el pong dentro del timeout (10 s), el servidor cierra la conexión. **voz** cierra con **1008** (implementa su propio ciclo de ping). **mensajes** delega el keepalive en su servidor ASGI (uvicorn/`websockets`), que cierra ese caso con **1011**. El cliente trata **1008 y 1011 igual: reconecta**, así que la diferencia no cambia su comportamiento.

## Trazabilidad

Cómo viaja el contexto de traza por el WebSocket. El contrato general está en [`observabilidad.md`](observabilidad.md).

- **Al conectar:** el navegador no puede mandar headers en el upgrade, así que el cliente agrega un `traceparent` nuevo a la URL: `wss://<servicio>/ws?ticket=<ticket>&traceparent=<traceparent>`. El servicio lo usa como padre del span de la conexión. Si falta o es inválido, empieza una traza nueva. **No** es motivo de rechazo.
- **Del cliente al servidor:** cualquier frame puede llevar un `request_id` opcional (1 a 128 caracteres). El servicio lo pone en los logs y en el span de ese mensaje.

  ```json
  {"type": "subscribe", "channel_ids": ["<uuid>"], "request_id": "8f3c2b1a-…"}
  ```

- **Del servidor al cliente:**
  - Los `error` devuelven el `request_id` del frame que los causó, si vino.
  - Los demás frames pueden llevar el `trace_id` de lo que los originó: un webhook, un evento del bus, una suscripción. Así se puede saltar desde la consola del navegador a la traza.

  ```json
  {"type": "error", "code": 403, "detail": "No tenés acceso a este canal.", "channel_id": "<uuid>", "request_id": "8f3c2b1a-…"}
  {"type": "voice.participants", "channel_id": "<uuid>", "participants": [], "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"}
  ```

- **Entre instancias:** lo que el servicio reparte por Redis Pub/Sub lleva el `traceparent` de lo que lo originó.
- Los dos campos son opcionales y se pueden ignorar, como cualquier campo desconocido.
- El `traceparent` de la URL no es un secreto, pero la URL completa sigue sin loguearse, porque lleva el ticket.

## Reconexión (cliente)

- **Backoff exponencial con jitter:** 1 s, 2 s, 4 s… hasta 30 s. Se reinicia al conectar bien.
- **Cada intento pide un ticket nuevo:** los tickets son de un solo uso.
- **Al reconectar, repite todas sus suscripciones.** Por eso los mensajes con estado (por ejemplo, `voice.participants`) son **snapshots completos**: el cliente no necesita saber qué se perdió mientras estaba desconectado.
- **Si el pedido del ticket da 401,** la sesión expiró: se deja de reconectar y se sigue el flujo normal de refresh o login.

## Voz

Recurso: canal de voz (`channel_id`). Se suscribe a un canal quien tiene acceso a él (el mismo chequeo con servidores que en el join). **No** hace falta `CONNECT_VOICE`: alcanza con ser miembro del servidor.

```json
{
  "type": "voice.participants",
  "channel_id": "<uuid>",
  "participants": [
    {"user_id": "<uuid>", "microphone_muted": false, "joined_at": "2026-10-20T18:03:12Z"}
  ]
}
```

- **Cuándo se manda:**
  - al suscribirse;
  - cuando alguien entra o sale del canal (webhooks de LiveKit `participant_joined`, `participant_left`, `room_finished`, `track_published` y `track_unpublished`);
  - en una reconciliación cada 30 s, por si se perdió algún webhook.
- **Siempre es la lista completa** del canal. Un canal vacío es `"participants": []`.
- **`microphone_muted`:** silenciar el micrófono no genera webhook, así que fuera de la sala ese dato puede tardar hasta la próxima reconciliación. Dentro de la sala, el cliente usa los eventos de LiveKit, que son instantáneos.
- **Los nombres no viajan:** el cliente los resuelve con `POST /api/v1/auth/users/batch`.

### Pérdida de acceso a un servidor

```json
{"type": "voice.access_revoked", "server_id": "<uuid>"}
```

- **Cuándo se manda:** cuando el usuario pierde el acceso a un servidor mientras tiene la conexión abierta. Hoy, al recibir el evento `servers.member.banned` ([eventos](eventos.md#serversmemberbanned)). La decisión está en el [ADR 0007](adr/0007-revocacion-de-acceso-por-servidor.md).
- **La conexión no se cierra:** el usuario sigue suscripto a los canales de sus otros servidores. El 4403 queda para la pérdida de acceso global (suspensión).
- **Qué hace voz:** da de baja las suscripciones de esa conexión a los canales de ese servidor y olvida el acceso que tenía en caché. Un `subscribe` posterior a uno de esos canales responde un `error` 403.
- **Qué hace el cliente:** deja de mostrar el servidor, sale del canal de voz si estaba en uno de ese servidor y le avisa al usuario.
- **No se garantiza la entrega:** si el socket estaba caído en ese momento, el aviso se pierde (Pub/Sub no retiene mensajes). El cliente se entera igual por el 403 de la próxima llamada HTTP al servidor.

## Mensajes

Recurso: canal de texto (`channel_id`). Se suscribe a un canal quien tiene acceso a él: **el mismo chequeo con servidores que en HTTP** (el `subscribe` se autoriza con la misma regla que el `GET` del historial, [ADR 0006](adr/0006-tiempo-real-websocket-por-servicio.md)). Si no hay acceso, el `subscribe` responde un `error` 403 y **no cierra** el socket: el usuario sigue suscripto a los canales de sus otros servidores. La decisión está en el [ADR 0009](adr/0009-tiempo-real-de-mensajes.md).

```json
{
  "type": "messages.created",
  "channel_id": "<uuid>",
  "message": {
    "id": "<uuid>",
    "channel_id": "<uuid>",
    "server_id": "<uuid>",
    "author_id": "<uuid>",
    "content": "<texto>",
    "mentions": ["<uuid>", "..."],
    "created_at": "2026-10-20T18:03:12Z"
  }
}
```

- **Cuándo se manda:** cuando se crea un mensaje en un canal al que la conexión está suscripta. Se publica **después** de que la transacción de base de datos del mensaje commitea, para no anunciar un mensaje que todavía podría abortar.
- **Es incremental, no un snapshot:** a diferencia de `voice.participants`, cada `messages.created` es un mensaje nuevo, no el estado completo del canal. Por eso el modelo genérico de reconexión —"al reconectar repito las suscripciones y recibo un snapshot completo"— **no** alcanza para mensajes: resuscribirse no reenvía lo que pasó mientras el socket estaba caído.
- **Recuperación tras una desconexión:** al reconectar, el cliente **vuelve a pedir el historial del canal por HTTP** y lo mergea por `id` con lo que ya tenía, para recuperar los mensajes que se perdió durante el corte (enunciado, historia 16 "Historial y reconexión", CA 2: *reconexión sin pérdida de mensajes*). Redis Pub/Sub **no retiene** mensajes, así que la recuperación se apoya en el refetch del historial, no en el bus.
- **Trazabilidad:** el frame lleva el `trace_id` de la traza del `POST` que creó el mensaje. El `traceparent` de ese `POST` viaja por el Pub/Sub entre instancias, y la que reparte el frame continúa esa traza ([Trazabilidad](#trazabilidad)).
- **Los nombres no viajan:** el cliente resuelve los autores y los mencionados con `POST /api/v1/auth/users/batch`.
- Hay un límite de suscripciones por conexión (50, como en voz). Pasarlo responde un `error` 429 para los recursos que sobran.

### Servidor suspendido

```json
{"type": "error", "code": 423, "detail": "Este servidor está suspendido.", "channel_id": "<uuid>"}
```

- **Cuándo se manda:** cuando un `subscribe` apunta a un canal de un servidor **suspendido**. El endpoint interno de mensajes mapea la suspensión a **423** (ver [ADR 0009](adr/0009-tiempo-real-de-mensajes.md)), a diferencia de voz, que la trata como un 403.
- **No cierra el socket:** igual que cualquier otro `error`. El 4403 queda para la pérdida de acceso global.
- **Qué hace el cliente:** lo trata igual que el 423 de HTTP, mostrando el estado "servidor suspendido".

### Pérdida de acceso a un servidor (reservado, **no implementado** en esta historia)

```json
{"type": "messages.access_revoked", "server_id": "<uuid>"}
```

- **Estado:** el tipo de frame queda **reservado por contrato**, pero mensajes **todavía no lo emite**. La revocación de acceso en vivo sobre un socket ya abierto —el esquema de revocación por servidor que usa voz ([ADR 0007](adr/0007-revocacion-de-acceso-por-servidor.md))— está **fuera de alcance de esta historia** y queda **pendiente**.
- **Mientras tanto, mensajes no corta la entrega en un socket abierto:** cuando el usuario pierde el acceso a un servidor (baneo, suspensión), se entera por el **403/423 de la próxima llamada HTTP** (enviar o pedir historial) y al **reconectar** (un `subscribe` a un canal sin acceso responde un `error` 403/423). No hay aviso en vivo.
- **Cuando se implemente:** mensajes consumirá `servers.member.banned`, `servers.server.suspended` y `auth.user.suspended`, dará de baja las suscripciones de esa conexión a los canales de ese servidor y recién ahí emitirá este frame (sin cerrar el socket; el 4403 queda para la pérdida de acceso global). La entrega seguirá siendo best effort: si el socket estaba caído, el aviso se pierde (Pub/Sub no retiene) y se resuelve igual por el 403/423 de la próxima llamada HTTP.
