# ADR 0010: Health checks `/livez` y `/readyz`

- **Fecha:** 2026-11-05

## Contexto

El enunciado (sección *Monitoreo*) pide que cada servicio exponga dos endpoints con semántica distinta:

- **`/livez`:** el proceso está vivo. Solo verificaciones locales, sin base de datos ni servicios externos.
- **`/readyz`:** el servicio puede operar. Verifica las dependencias críticas.

No pueden compartir lógica y no se acepta un único `/health` genérico. Además, la historia optativa de incidentes del backoffice asocia los servicios afectados a los que exponen health checks.

El enunciado no dice qué cuenta como **dependencia crítica**. Cada servicio tiene dependencias distintas:

| Servicio | Base de datos | Redis | Otros |
|---|---|---|---|
| autenticación | Postgres | Relay del outbox | — |
| servidores | Postgres | Relay del outbox | — |
| mensajes | MongoDB | Tickets del WebSocket y Pub/Sub entre instancias | Consulta síncrona a servidores ([ADR 0009](0009-tiempo-real-de-mensajes.md)) |
| voz | — ([ADR 0004](0004-voz-sin-base-de-datos.md)) | Tickets, Pub/Sub de presencia y consumidor de eventos | LiveKit Cloud ([ADR 0002](0002-voz-con-livekit.md)) y consulta síncrona a servidores ([ADR 0003](0003-voz-consulta-sincrona-a-servidores.md)) |
| gateway (KrakenD CE 2.6) | — | — | El JWKS de autenticación, para validar los JWT |

Hay otros condicionantes:
- **Render plan free:** los servicios se duermen sin tráfico y tardan de 30 a 60 s en despertar. Render puede usar un *Health Check Path* para decidir si un deploy salió bien y si reinicia el servicio.
- **Despertar desde el navegador:** los frontends llaman a cada servicio al abrir la app (`wake.ts`) para que la primera acción no espere un cold start. El `fetch` es `no-cors`, así que cualquier respuesta, incluso un 404, cuenta como "despierto".
- **Estado de partida:** servidores y voz ya tenían `/livez` y `/readyz`. Autenticación tenía un `/health` genérico, mensajes tenía `/health` y `/readyz`, y el gateway solo tenía el `/__health` propio de KrakenD.

## Decisión

### `/livez`: nunca consulta nada

Responde `200 {"status": "ok"}` sin tocar ninguna dependencia. En el gateway es el health check propio de KrakenD, expuesto en `/livez` con `router.health_path` (`/__health` deja de existir).

### `/readyz`: solo las dependencias propias del servicio

Un servicio es "ready" si puede cumplir su funcionalidad principal con lo que **él mismo** administra. **Nunca consulta a otro servicio de Discordia.** Si lo hiciera, cada chequeo despertaría servicios dormidos en Render, y el cold start de uno dejaría a otros "no ready" sin que les pase nada. La caída de otro servicio ya se maneja en el camino de cada request, con timeouts, reintentos y circuit breaker que fallan cerrado con 503 ([ADR 0005](0005-voz-resiliencia-ante-servidores.md), [ADR 0009](0009-tiempo-real-de-mensajes.md)).

| Servicio | `/readyz` chequea | No chequea, y por qué |
|---|---|---|
| autenticación | Postgres (`SELECT 1`) | **Redis:** solo lo usa el relay del outbox, que reintenta. Su caída no impide ningún login |
| servidores | Postgres (`SELECT 1`) | **Redis:** mismo motivo |
| mensajes | MongoDB (`ping`) | **Redis:** sin él se siguen enviando y leyendo mensajes. El reparto en vivo es best effort y el cliente pasa al polling ([ADR 0009](0009-tiempo-real-de-mensajes.md)). **Servidores:** es otro servicio |
| voz | LiveKit (un `ListRooms` filtrado, que valida conexión y credenciales) y Redis (`PING`) | **Servidores:** es otro servicio. Acá Redis **sí** es crítico: sin él no hay tickets, presencia ni revocación de acceso |
| gateway | El JWKS de autenticación | Los demás backends: el gateway puede rutear aunque uno esté caído |

**El gateway es la única excepción a "no consultar otros servicios".** El JWKS es parte de su funcionalidad principal: sin las claves no puede validar ningún JWT y rechaza todas las rutas protegidas.

### Respuesta

- **Listo:** `200`.
- **No listo:** `503` con un `detail` genérico. El motivo va al log (Warn), no a la respuesta, para no exponer qué dependencia falló.
- **El gateway devuelve `500`, no `503`:** KrakenD CE no permite elegir el status cuando falla el backend. Igual es un error, que es lo que mira cualquier monitor.
- **Sin caché en los servicios Python:** sus chequeos son un `SELECT 1` o un `ping`, que son baratos. **Voz cachea el resultado 5 s** y corta a los 2 s, porque le pega a una API externa (LiveKit). **El gateway** marca la respuesta con `Cache-Control: max-age=1`, porque KrakenD no deja anular el `cache_ttl` global.
- **Ni trazas ni línea de acceso:** se llaman cada pocos segundos y gastarían cuota de Grafana Cloud sin aportar nada ([`observabilidad.md`](../observabilidad.md)).

### Quién usa cada uno

- **Render (*Health Check Path*): `/livez`.** Si Render usara `/readyz`, una dependencia caída (LiveKit, la base) haría que reiniciara el servicio, y reiniciar no la arregla.
- **Despertar desde los frontends:** `/livez`. Alcanza con que el proceso arranque. Las URLs de servidores siguen pidiendo `/readyz` a propósito, porque así también se abre la conexión a la base.
- **Monitoreo e incidentes del backoffice:** `/readyz`, que es el que dice si el servicio puede atender.

### `/health`

Se elimina. Mientras el *Health Check Path* de Render siga en `/health`, queda como alias **deprecated** de `/livez` en autenticación y mensajes, porque borrarlo antes haría fallar el deploy. Se borra en un PR aparte, cuando Render apunte a `/livez`.

## Alternativas descartadas

- **Un `/readyz` que chequea todo, incluidos los otros servicios:** muestra el estado de punta a punta, pero en Render free despierta a todos los servicios en cada chequeo y encadena los cold starts: un servicio dormido deja a los demás "no ready". El estado de punta a punta es tarea del monitoreo (el backoffice puede consultar el `/readyz` de cada servicio), no del health check de uno.
- **Redis como crítico en todos los servicios, para uniformar:** dejaría a autenticación y servidores "no ready" por algo que no les impide funcionar, porque el outbox reintenta solo. La uniformidad está en el criterio ("lo que impide la funcionalidad principal"), no en la lista.
- **Gateway sin `/readyz`:** es lo más simple, pero el enunciado pide los dos endpoints en cada servicio, y el gateway sí tiene una dependencia que lo deja inutilizable.
- **`/readyz` del gateway como agregación de los `/readyz` de los backends:** KrakenD CE devuelve `200` con respuesta parcial cuando falla uno de varios backends, así que no se puede convertir en `503` sin plugins. Además tendría los mismos problemas que la primera alternativa.
- **Render con `/readyz`:** detecta dependencias caídas, pero responde con un reinicio que no las arregla, y puede dejar al servicio reiniciándose en loop mientras dura la caída.
- **Seguir con `/health`:** el enunciado lo prohíbe explícitamente.

## Consecuencias

- **Un `/readyz` en `200` no garantiza que funcione todo.** Mensajes puede estar "ready" con servidores caído y responder 503 en cada `GET` o `POST`. Es intencional: el `/readyz` habla del servicio y no de sus vecinos.
- **El backoffice puede armar el estado de la plataforma** consultando el `/readyz` de cada servicio (la historia optativa de incidentes), y ve qué servicio falla sin que uno arrastre a otro.
- **Cada dependencia nueva obliga a decidir si es crítica** y, si lo es, a sumarla al `/readyz` de ese servicio y a la tabla de este ADR.
- **Pasos operativos:**
  - cambiar el *Health Check Path* de Render a `/livez` en cada servicio. Según `internal/health/readiness.go`, voz hoy lo tiene en `/readyz`;
  - en el gateway, si Render usa `/__health`, dejarlo vacío, desplegar y después poner `/livez`, porque el gateway viejo no tiene `/livez` y el nuevo ya no tiene `/__health`;
  - después, borrar `/health` en autenticación y mensajes.
