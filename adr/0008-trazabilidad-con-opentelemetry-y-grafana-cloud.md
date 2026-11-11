# ADR 0008: Trazabilidad distribuida con OpenTelemetry y Grafana Cloud

- **Fecha:** 2026-10-27

## Contexto

El enunciado pide un sistema de observabilidad (APM o equivalente) en cada servicio y log estructurado con niveles configurables. Además valora la **trazabilidad distribuida**: un trace/correlation ID propagado entre servicios, incluyendo las conexiones en tiempo real.

Una acción del usuario hoy cruza varios procesos:
- **HTTP:** cliente → gateway (KrakenD) → servicio, y a veces servicio → servicio (voz → servidores).
- **Eventos:** servicio → outbox → relay → Redis Streams → consumidor ([ADR 0001](0001-bus-de-eventos-redis-streams.md)).
- **Tiempo real:** cliente ↔ WebSocket del servicio, y Redis Pub/Sub entre las instancias ([ADR 0006](0006-tiempo-real-websocket-por-servicio.md)).

Los condicionantes son:
- **Stacks distintos:** Python/FastAPI (autenticación, servidores y, en principio, mensajes) y Go (voz).
- **Render plan free:** no hay lugar para correr un backend de trazas propio ni un collector aparte sin pagar otro servicio.
- **Datos personales:** el enunciado prohíbe exponer datos sensibles en los logs.
- **Estado de partida:** voz ya genera y reenvía `X-Request-Id`. Nadie más propaga nada.

## Decisión

### OpenTelemetry en cada servicio, con W3C Trace Context

- Cada backend usa el SDK de OpenTelemetry de su lenguaje e instrumenta el servidor HTTP, los clientes HTTP, la base de datos y Redis.
- El contexto viaja con los headers estándar **`traceparent`** y **`tracestate`**.
- **`X-Request-Id`** se mantiene como id corto y legible para soporte. Se reusa si llega, se genera si no, y se devuelve siempre en la respuesta.
- Los frontends no cargan el SDK. Generan un `traceparent` y un `X-Request-Id` por pedido, así la traza nace en el cliente.

### El contexto también viaja por eventos y WebSocket

- **Eventos:** el sobre suma un campo opcional `traceparent` ([`eventos.md`](../eventos.md#sobre)). Se captura al construir el sobre, dentro del request, así que queda guardado en el outbox y sobrevive al relay.
- **WebSocket:** el navegador no puede mandar headers en el upgrade. El `traceparent` va como query param y los frames llevan ids opcionales ([`tiempo-real.md`](../tiempo-real.md#trazabilidad)).

### Export por OTLP a Grafana Cloud

- Cada servicio exporta directo por OTLP/HTTP al endpoint de Grafana Cloud, sin collector propio. La autenticación va en `OTEL_EXPORTER_OTLP_HEADERS`, cargada como secreto en Render.
- Las trazas van a Tempo.
- Los logs siguen saliendo por stdout en JSON con `trace_id`. Mandarlos también a Loki por OTLP es un paso posterior.
- En local se usa la imagen `grafana/otel-lgtm`, que trae el collector, Tempo, Loki y Grafana en un contenedor.
- Si no hay endpoint configurado, no se exporta nada, pero los ids se siguen generando y logueando.

El contrato completo (campos de log, niveles, variables y qué no se loguea) está en [`observabilidad.md`](../observabilidad.md).

## Alternativas descartadas

- **Solo un correlation id (`X-Request-Id`) en los logs:** es lo más simple y ya existe en voz. Pero no es un APM: no muestra tiempos por tramo ni dónde se cortó una cadena, y no cumple "sistema de observabilidad".
- **Honeycomb (free):** muy bueno para trazas y también habla OTLP, así que cambiar después cuesta solo una variable. Se descarta porque los logs y las métricas quedarían en otro lado. Grafana Cloud junta trazas, logs y métricas en un mismo plan gratuito.
- **Jaeger propio:** sirve en local, pero en producción sería un servicio más en Render que se duerme y pierde datos sin disco. No tiene logs ni métricas.
- **Un collector OTel propio delante de Grafana:** permitiría muestreo y filtros centralizados, pero es otro servicio que desplegar y mantener despierto. Con el volumen del proyecto no hace falta.
- **El SDK de OTel en el navegador:** suma peso al bundle y exige exponer el endpoint de Grafana a los navegadores, con su CORS y su credencial. Alcanza con que el cliente genere el `traceparent`.
- **Un header propio (`X-Trace-Id`) en vez de W3C:** obliga a escribir la propagación a mano en cada librería. `traceparent` es el estándar que ya entienden OTel, KrakenD y Grafana.

## Consecuencias

- **Cierra la decisión D12** (backend de observabilidad para todo el sistema) y desbloquea el paso B11 de voz.
- **Cada servicio suma dependencias de OTel** y un módulo de observabilidad. En Python es el mismo módulo copiado en cada repo, sin librería compartida.
- **El gateway** tiene que reenviar `traceparent`, `tracestate` y `X-Request-Id`, permitirlos en el CORS y exponer `X-Request-Id`. Si el exporter de KrakenD CE no admite el header de autenticación de Grafana Cloud, el gateway solo propaga y no aparece como span propio.
- **El sobre de eventos** cambia de forma compatible (un campo opcional). Hay que actualizar las copias del schema en los tests de contrato.
- **Cuota del plan gratuito:** se excluyen de las trazas `/livez` y `/readyz`, que son la mayor parte del tráfico en reposo. Si la cuota no alcanza, se baja el muestreo con `OTEL_TRACES_SAMPLER`.
- **Soporte:** el cliente muestra el `X-Request-Id` en los errores 5xx, así un reporte de usuario lleva directo a los logs y a la traza.
- **mensajes** nace siguiendo este contrato.
