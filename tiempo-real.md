# Contrato de tiempo real (WebSocket)

Contrato común de los WebSocket de los servicios. La decisión está en el [ADR 0006](adr/0006-tiempo-real-websocket-por-servicio.md). Cada servicio documenta en su `agents/integraciones.md` los tipos de mensaje propios.

| Servicio | Pedido de ticket (por el gateway) | Mensajes |
|---|---|---|
| voz | `POST /api/v1/voice/realtime/ticket` | [Voz](#voz) |
| mensajes | Pendiente | Pendiente |

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

- **`code`:** usa la semántica de los status HTTP (400, 403, 404, 409, 429, 503). Un `error` **no cierra** la conexión.
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
