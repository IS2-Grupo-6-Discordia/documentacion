# Catálogo de eventos

Este es el único catálogo de eventos del sistema. La decisión de tecnología está en [ADR 0001](adr/0001-bus-de-eventos-redis-streams.md). Cada servicio, además, lista en su `agents/integraciones.md` qué emite y qué consume.

## Sobre

Todo evento viaja con el mismo sobre ([JSON Schema](eventos/sobre.schema.json)):

```json
{
  "id": "6f1c2a9e-0b7d-4c3e-9a51-2d8f3e4b5c6a",
  "type": "auth.user.suspended",
  "occurred_at": "2026-10-06T18:03:12.123456+00:00",
  "source": "autenticacion",
  "data": { "user_id": "…", "suspended_by": "…" }
}
```

- `type`: `<dominio>.<entidad>.<accion>`, en inglés y en pasado.
- `occurred_at`: cuándo ocurrió el hecho, no cuándo se publicó.
- **Cambios en `data`:** agregar campos es compatible y los consumidores deben ignorar los que no conocen. Quitar o cambiar el significado de un campo requiere un **tipo nuevo**, por ejemplo `auth.user.suspended_v2`, y avisar a los consumidores.

## Convenciones de Redis Streams

| Qué | Convención |
|---|---|
| Stream | `discordia:events:<dominio>`, uno por servicio emisor (`auth`, `servers`, `messages`, `voice`) |
| Entrada | Un único campo `envelope` con el sobre serializado en JSON |
| Retención | `XADD … MAXLEN ~ 100000` |
| Consumer group | Uno por servicio consumidor, con el nombre del servicio (`voz`, `mensajes`, …). Se crea con `XGROUP CREATE <stream> <grupo> $ MKSTREAM` |
| Consumer | Uno por instancia (por ejemplo, hostname o id de instancia de Render) |

## Reglas para emisores

1. **Outbox:** el evento se inserta en la tabla `outbox_events` del servicio, dentro de la misma transacción que el cambio de negocio. Nunca se hace `XADD` directo desde el request.
2. Un **relay** en segundo plano publica los pendientes en orden de `occurred_at` y los marca publicados. Si Redis falla, reintenta con backoff. Puede generar duplicados.
3. Se emite solo ante una **transición real** de estado. Por ejemplo, suspender a alguien que ya está suspendido no emite nada.

## Reglas para consumidores

1. Leer con `XREADGROUP GROUP <grupo> <consumer> BLOCK <ms> STREAMS <stream> >`. El timeout tiene que ser largo, porque cada comando cuesta cuota en el proveedor gestionado.
2. Procesar y recién después `XACK`.
3. **Idempotencia:** deduplicar por `id` (tabla de procesados o `SET` de Redis con TTL). Procesar el mismo evento dos veces no puede tener efectos distintos de procesarlo una vez.
4. **Desorden:** no asumir orden entre streams. Decidir según el estado actual o según `occurred_at`. Por ejemplo, ignorar un `suspended` más viejo que el último `reactivated` visto.
5. **Errores:**
   - *Transitorio* (dependencia caída, timeout): no hacer ACK. El evento queda pendiente y se reintenta. Al arrancar, y cada tanto, reclamar pendientes viejos con `XAUTOCLAIM`.
   - *Permanente* (sobre inválido, tipo desconocido, entidad que ya no existe): loguear con el `id` y hacer ACK, para no bloquear el stream.
6. Ignorar los tipos que el servicio no maneja (hacer ACK sin efecto).

## Eventos

### `auth.user.suspended`

Un staff suspendió una cuenta a nivel plataforma (historia 29).

- **Emisor:** autenticación (`discordia:events:auth`).
- **Consumidores:**
  - voz (grupo `voz`): desconecta al usuario de todas las salas de voz (`RemoveParticipant`). No deduplica por `id` ni compara `occurred_at`: sacar de una sala a alguien que ya no está es un no-op, así que procesar el evento dos veces tiene el mismo efecto que una. Si un `suspended` viejo llega después de un `reactivated`, el usuario queda desconectado una vez y puede volver a entrar. Detalle en `agents/integraciones.md` de voz;
  - mensajes (previsto): cierra sus conexiones en tiempo real.
- **`data`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `user_id` | UUID | Usuario suspendido |
| `suspended_by` | UUID | Staff que suspendió |

### `auth.user.reactivated`

Un staff reactivó una cuenta suspendida.

- **Emisor:** autenticación (`discordia:events:auth`).
- **Consumidores:**
  - voz (grupo `voz`): ACK sin efecto. Voz no guarda estado: el usuario reactivado vuelve a entrar con un join normal.

  Sirve para resolver el desorden respecto de `auth.user.suspended`.
- **`data`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `user_id` | UUID | Usuario reactivado |

### `servers.member.banned`

Un miembro con permiso de moderación baneó a un usuario de un servidor (historia 25). El usuario deja de ser miembro, si lo era, y no puede volver a unirse mientras el baneo siga activo.

- **Emisor:** servidores (`discordia:events:servers`). Banear a alguien que ya está baneado no emite nada.
- **Consumidores:**
  - voz (grupo `voz`): saca al usuario de las salas de voz **de ese servidor** (`RemoveParticipant`) y le avisa por WebSocket con `voice.access_revoked` ([ADR 0007](adr/0007-revocacion-de-acceso-por-servidor.md)). Las salas de otros servidores no se tocan. No deduplica por `id`: sacar de una sala a alguien que ya no está es un no-op. Si un `banned` viejo llega después de un `unbanned`, el usuario queda desconectado una vez y, como ya no es miembro, igual tiene que volver a unirse con una invitación;
  - mensajes (previsto): deja de entregarle los mensajes de ese servidor;
  - auditoría (prevista, historia optativa): registra la acción de moderación.
- **`data`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `server_id` | UUID | Servidor del que se lo baneó |
| `user_id` | UUID | Usuario baneado |
| `banned_by` | UUID | Miembro que baneó |

El motivo del baneo no viaja en el evento: se consulta en servidores (`GET /api/v1/servers/{server_id}/bans`).

### `servers.member.unbanned`

Un miembro con permiso de moderación revocó el baneo de un usuario (historia 26). El usuario puede volver a unirse con una invitación válida; la membresía **no** se restaura sola.

- **Emisor:** servidores (`discordia:events:servers`).
- **Consumidores:**
  - voz (grupo `voz`): ACK sin efecto. Voz no guarda estado: el usuario vuelve a entrar con un join normal cuando sea miembro otra vez.

  Sirve para resolver el desorden respecto de `servers.member.banned`.
- **`data`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `server_id` | UUID | Servidor |
| `user_id` | UUID | Usuario al que se le revocó el baneo |
| `unbanned_by` | UUID | Miembro que revocó el baneo |
