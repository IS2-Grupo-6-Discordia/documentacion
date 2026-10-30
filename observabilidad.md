# Observabilidad y trazabilidad

Contrato común de logs y trazas de todos los servicios, incluido mensajes. La decisión está en el [ADR 0008](adr/0008-trazabilidad-con-opentelemetry-y-grafana-cloud.md).

## Ids

| Id | Qué es | Dónde nace | Cómo viaja |
|---|---|---|---|
| `trace_id` | Identifica la traza completa: todo lo que pasó por una acción del usuario, en todos los servicios | En el cliente (o en el primer servicio, si el pedido llega sin `traceparent`) | `traceparent` (W3C Trace Context) |
| `span_id` | Identifica un tramo dentro de la traza: un request, una consulta, un evento procesado | En cada servicio, lo genera OpenTelemetry | `traceparent` |
| `request_id` | Id corto y legible de un pedido HTTP, para soporte y para buscar en los logs | En el cliente (o en el primer servicio) | `X-Request-Id` |

## HTTP

- **`traceparent` y `tracestate`:** formato [W3C Trace Context](https://www.w3.org/TR/trace-context/), por ejemplo `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`. Si llega, el span del servicio es hijo de ese contexto. Si no, el servicio empieza una traza nueva.
- **`X-Request-Id`:**
  - Si llega uno de 1 a 128 caracteres imprimibles, se reusa. Si no llega o no cumple, se genera un UUID v4.
  - **Siempre** se devuelve en la respuesta, también en los errores.
  - Se reenvía en toda llamada a otro servicio.
- **Llamadas entre servicios:** el cliente HTTP instrumentado inyecta `traceparent` solo. `X-Request-Id` se reenvía a mano.
- **Gateway:** reenvía los tres headers a todos los backends. El CORS los permite y expone `X-Request-Id`, así el navegador puede leerlo. No aparece como span: el exporter de KrakenD CE no puede autenticarse contra Grafana Cloud.
- **Navegador:** el cliente genera los dos headers en cada pedido, con flags `01` (muestreado). Si el pedido se reintenta (por ejemplo, después de renovar el token), mantiene el mismo `X-Request-Id`.

## Eventos

- El sobre lleva un campo **opcional** `traceparent` ([`eventos.md`](eventos.md#sobre)).
- **Emisor:** lo completa al construir el sobre, con el contexto del request que originó el cambio. Queda guardado en el outbox junto con el resto del sobre.
- **Relay:** abre un span `publish <stream>` como hijo de ese contexto.
- **Consumidor:** abre un span `process <type>` como hijo del `traceparent` del sobre. Si no viene o es inválido, empieza una traza nueva y lo procesa igual: **nunca** se descarta un evento por su contexto de traza.

## Tiempo real

Ver [`tiempo-real.md`](tiempo-real.md#trazabilidad). En resumen:
- el `traceparent` va en la URL del WebSocket;
- el cliente puede mandar un `request_id` en cada frame;
- el servidor manda `trace_id` en los frames que emite y devuelve el `request_id` en los `error`.

Dentro de un servicio, lo que se reparte entre instancias por Redis Pub/Sub también lleva el `traceparent` de lo que lo originó.

## Logs

Una línea por evento, en JSON, por stdout.

### Campos

| Campo | Obligatorio | Contenido |
|---|---|---|
| `time` | Sí | RFC 3339 en UTC |
| `level` | Sí | `DEBUG`, `INFO`, `WARNING`/`WARN` o `ERROR` |
| `logger` | Sí | Componente que loguea, por ejemplo `app.services.ban_service` o `voz.http` |
| `message` | Sí | Qué pasó, en castellano o en inglés, sin datos personales |
| `service` | Sí | `autenticacion`, `servidores`, `mensajes` o `voz` (igual que `OTEL_SERVICE_NAME`) |
| `trace_id`, `span_id` | Si hay un span activo | En hexa, como en `traceparent` |
| `request_id` | Si la línea es parte de un pedido HTTP o de un frame con `request_id` | El valor de `X-Request-Id` |
| `user_id` | Si se conoce | UUID del usuario que originó la acción |
| `exc_info` | Si hay una excepción | El traceback |
| otros | No | Ids del dominio (`server_id`, `channel_id`, `event_id`, `event_type`, …), duración, status |

### Niveles

El nivel se configura con `LOG_LEVEL` (default `INFO`).

| Nivel | Cuándo | Ejemplos |
|---|---|---|
| `ERROR` | Una falla impide cumplir la funcionalidad | 5xx, la base no responde, un evento que no se puede procesar |
| `WARN` | Una condición anómala que no impide la funcionalidad básica | Un reintento hacia otro servicio, el circuit breaker abierto, un 4xx sospechoso (muchos 403 seguidos) |
| `INFO` | Una acción del usuario o del sistema, que tiene que quedar en el historial | Una línea de acceso por request, crear un servidor, banear, suspender, unirse a voz, publicar o consumir un evento |
| `DEBUG` | El contexto técnico para diagnosticar sin leer el código | Parámetros de una consulta, el payload de un evento sin datos personales, decisiones internas |

**Línea de acceso:** cada request HTTP deja un `INFO` con `method`, `path` (la plantilla de la ruta, no la URL con query), `status` y `duration_ms`. Se excluyen `/livez` y `/readyz`.

### Qué no se loguea nunca

- Contraseñas, tokens (JWT, refresh, recupero), tickets de WebSocket ni la URL completa con el ticket.
- El header `Authorization`, `X-Service-Secret` ni ningún secreto.
- Emails, nombres reales ni el contenido de los mensajes.
- Bodies completos de requests o de respuestas.

Para identificar a alguien se usa el `user_id`. Lo mismo vale para los atributos de los spans.

## Variables de entorno

Se usan las [variables estándar de OpenTelemetry](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/), sin nombres propios:

| Variable | Ejemplo | Notas |
|---|---|---|
| `OTEL_SERVICE_NAME` | `servidores` | Mismo valor que el campo `service` de los logs |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `https://otlp-gateway-<zona>.grafana.net/otlp` (Grafana Cloud), `http://otel-lgtm:4318` (local) | Sin esta variable no se exporta nada, pero los ids se siguen generando y logueando |
| `OTEL_EXPORTER_OTLP_HEADERS` | `Authorization=Basic <base64(instance_id:token)>` | **Secreto**: se carga en Render, nunca en el repo |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | Si la cuota del plan gratuito no alcanza, pasar a `parentbased_traceidratio` |
| `OTEL_SDK_DISABLED` | `true` | En los tests |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARN` o `ERROR` |

## Spans

- **Nombres:** los que pone la instrumentación (`GET /api/v1/servers/{server_id}`, `SELECT discordia`, …). Los spans a mano siguen la forma `<verbo> <objeto>`: `publish discordia:events:servers`, `process servers.member.banned`, `ws.subscribe`.
- **Atributos propios:** `discordia.user_id` y los ids de dominio (`discordia.server_id`, `discordia.channel_id`, `discordia.event_id`). Nunca datos personales.
- **Errores:** el span queda con status `ERROR` y registra la excepción. Los 4xx no son errores del span.

## Cómo seguir una acción

1. Del cliente: el código que muestra en un error 5xx son los primeros 8 caracteres del `request_id`.
2. En los logs: buscar el `request_id` que empieza con ese código. La línea trae el `trace_id`.
3. En Grafana (Tempo): abrir la traza por `trace_id`, que muestra todos los servicios y tramos que tocó la acción, con sus tiempos.
