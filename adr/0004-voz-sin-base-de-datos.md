# ADR 0004: Voz sin base de datos (LiveKit como fuente de verdad)

- **Fecha:** 2026-10-06

## Contexto

Voz necesita saber quién está conectado a cada canal y en qué salas está un usuario para sacarlo cuando lo banean o suspenden.

Ese estado es **efímero**: dura lo que dura la conexión y no hay que conservarlo. LiveKit ([ADR 0002](0002-voz-con-livekit.md)) ya sabe qué participantes hay en cada sala, y su API permite listarlos.

## Decisión

El microservicio de voz **no tiene base de datos**. LiveKit es la fuente de verdad de quién está en cada sala:

- **Participantes de un canal:** `ListParticipants` de la sala `ch:<channel_id>` en el momento de leer.
- **Salas de un usuario** (cambio de canal y desconexión por eventos): se recorren las salas con `ListRooms` + `ListParticipants`. La identidad en LiveKit es el `user_id`.
- **Salas de un servidor:** el `server_id` va en la metadata de la sala.
- **Webhooks de LiveKit:** solo sirven como disparador (logs y, más adelante, publicar eventos). Nada correcto depende de ellos, porque con voz dormido en Render se pueden perder.
- **Idempotencia de los eventos sin tabla de procesados:** todas las reacciones de voz son idempotentes por naturaleza (sacar a alguien que no está o borrar una sala que no existe no hace nada), así que no hace falta guardar ids de eventos.

## Alternativas descartadas

- **Postgres propio**: permitiría consultas baratas, pero duplicaría el estado de LiveKit y habría que mantenerlo sincronizado con webhooks, que se pierden si voz duerme.
- **Redis como caché de presencia:** más liviano, pero tiene el mismo problema de sincronización y gasta cuota de Upstash en cada cambio. Se reconsidera si el costo de consultar a LiveKit se vuelve un problema.

## Consecuencias

- **Sin migraciones ni base que operar.** El servicio arranca solo con variables de entorno.
- **Buscar las salas de un usuario cuesta O(salas):** una llamada por sala. Riesgo aceptable por la escala del proyecto. En la práctica el cliente se desconecta antes de unirse a otro canal; voz lo garantiza igual.
- **Un token emitido no significa que el usuario se conectó:** el estado lo confirma LiveKit.
- **Desorden de eventos:** un `auth.user.suspended` viejo que llega después de un `auth.user.reactivated` desconecta una vez a un usuario ya reactivado, que puede volver a entrar. Se acepta y no requiere comparar `occurred_at`.
- **Se reabre si una historia pide persistir algo de voz**, por ejemplo el silenciamiento temporal.