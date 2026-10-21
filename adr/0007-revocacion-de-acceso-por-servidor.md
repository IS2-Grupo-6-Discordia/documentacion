# ADR 0007: Revocación de acceso por servidor en voz (baneo)

- **Fecha:** 2026-10-21

## Contexto

Las historias 25 (banear miembro) y 26 (revocar baneo) hacen que un usuario pierda el acceso a **un** servidor mientras puede seguir conectado a otros. El enunciado pide que la desconexión en Voz y Mensajes sea una reacción asíncrona a un evento de moderación ([ADR 0001](0001-bus-de-eventos-redis-streams.md)), así que servidores emite `servers.member.banned` ([eventos](../eventos.md#serversmemberbanned)) y voz reacciona.

Hay dos efectos a resolver en voz:

1. **Audio:** sacar al usuario de las salas de LiveKit de ese servidor, pero no de las de otros.
2. **Tiempo real:** el [ADR 0006](0006-tiempo-real-websocket-por-servicio.md) comprueba el acceso al suscribirse y prevé cerrar el socket al perderlo. Pero:
   - el cierre 4403 significa "no reconectar hasta que cambie la sesión". Usarlo por un baneo dejaría al usuario sin presencia en **todos** sus servidores;
   - voz cachea por un rato las respuestas de acceso de servidores, así que sin hacer nada el baneado seguiría viendo la presencia de ese servidor;
   - el consumer group entrega cada evento a **una** instancia de voz, y el socket del usuario puede estar en otra.

## Decisión

- **Audio:** voz busca las salas del usuario cuya metadata tiene el `server_id` del evento (la metadata la escribe voz al crear la sala, [ADR 0004](0004-voz-sin-base-de-datos.md)) y lo saca solo de esas. Sigue sin base de datos.
- **Tiempo real:**
  1. La instancia que consume el evento publica `{user_id, server_id}` en el canal de Redis Pub/Sub `voz:realtime:access`, igual que hace con los cambios de presencia.
  2. Cada instancia, para cada conexión de ese usuario:
     - le manda `{"type": "voice.access_revoked", "server_id": "<uuid>"}` ([contrato](../tiempo-real.md#pérdida-de-acceso-a-un-servidor));
     - da de baja sus suscripciones a canales de ese servidor;
     - olvida el acceso cacheado del usuario, para que el próximo `subscribe` vuelva a consultar a servidores.
  3. **No cierra el socket.** La suspensión (pérdida de acceso global) sigue usando el 4403 del ADR 0006.
- **Respaldo en el cliente:** el aviso por WebSocket es *best effort*. Si una llamada HTTP al servidor responde 403 o 404, el cliente hace la misma limpieza que con `voice.access_revoked`.
- `servers.member.unbanned` no tiene efecto en voz: el usuario vuelve con un join normal cuando sea miembro de nuevo.

## Alternativas descartadas

- **Cerrar el socket con 4403:** el cliente dejaría de reconectar y perdería la presencia de sus otros servidores.
- **Cerrar con un código que pida reconectar:** al reconectar, el cliente repetiría las suscripciones y, con el acceso en caché, el baneado volvería a recibir la presencia del servidor. Además no le dice al cliente qué pasó.
- **Que el evento traiga los `channel_ids` del servidor:** acopla a servidores con el estado de voz, y un canal creado después del evento quedaría afuera.
- **Que voz le pregunte a servidores por los canales del servidor:** es una llamada sincrónica entre servicios, que el enunciado pide evitar si no es imprescindible. La metadata de la sala ya alcanza.
- **Un canal de notificaciones propio del cliente:** no existe todavía, y sumarlo es más alcance que el de estas historias.

## Consecuencias

- Modifica la consecuencia "Revocación" del ADR 0006 para el caso de un servidor. La suspensión no cambia.
- El aviso puede perderse si el socket estaba caído: Pub/Sub no retiene mensajes. El cliente lo cubre con el 403 en HTTP.
- Encontrar las salas de un usuario en un servidor cuesta O(salas), igual que hoy al cambiar de canal o al suspender ([ADR 0004](0004-voz-sin-base-de-datos.md)).
- Cada instancia de voz suma una suscripción Pub/Sub (`voz:realtime:access`) sobre el mismo Redis, sin costo de comandos mientras no haya baneos.
- Mensajes, cuando tenga WebSocket, puede aplicar el mismo esquema con su propio tipo de mensaje.
