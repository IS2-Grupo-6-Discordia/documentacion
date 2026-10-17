# ADR 0005: Resiliencia de voz ante servidores (timeouts, reintentos y circuit breaker)

- **Fecha:** 2026-10-17

## Contexto

Según el [ADR 0003](0003-voz-consulta-sincrona-a-servidores.md), en cada join voz le pregunta a servidores si el usuario puede entrar al canal:

```
GET /internal/voice/channels/{channel_id}/access?user_id={uuid}
X-Service-Secret: <secreto del par voz → servidores>
```

Ese ADR dejó para después los parámetros de resiliencia. Los condicionantes son:
- **Servidores corre en Render (plan free):** se duerme sin tráfico y tarda entre 30 y 60 s en despertar. Además puede tener errores pasajeros (502/503 durante un deploy).
- **El join es interactivo:** el usuario está esperando para hablar. Una espera larga es peor que un error claro con la opción de reintentar.
- **El gateway corta la ruta a los 3000 ms** si no tiene un override, y todo lo que haga voz tiene que entrar en ese tiempo.
- **No todas las respuestas son fallos:** un 403, 404 o 409 es una respuesta definitiva de servidores, no un problema de disponibilidad. Reintentarlas no cambia el resultado y castiga a servidores sin motivo.

## Decisión

El cliente HTTP de voz (`internal/clients/servidores`) aplica tres mecanismos.

### Timeouts

- **Por intento: 2 s** (`SERVIDORES_TIMEOUT`). El endpoint solo consulta la base, así que 2 s sobra cuando servidores está despierto.
- **Total por consulta: 5 s**, incluidos todos los intentos y las esperas entre ellos. Es el máximo que el grupo acepta que espere un usuario en un join.

### Reintentos

- **Hasta 3 intentos** dentro del tope total.
- **Backoff exponencial con jitter:** antes del segundo intento espera entre 50 y 100 ms, y antes del tercero entre 100 y 200 ms. El jitter evita que varias instancias reintenten todas a la vez.
- **Solo se reintentan los fallos de disponibilidad:** 5xx, timeout o error de red.
- **No se reintentan:**
  - 403, 404 y 409: son respuestas definitivas.
  - 401: el secreto está mal configurado (ver abajo).
  - 400, 422, un 3xx o un 200 que no cumple el contrato: son bugs de un lado o del otro.
- Si quien llamó cancela el pedido (el cliente se fue), se cortan los reintentos.
- Se implementan a mano (unas 30 líneas): el criterio es específico y así no se suma otra dependencia.

### Circuit breaker

Con [`sony/gobreaker`](https://github.com/sony/gobreaker) v2:
- **Se abre** después de **5 consultas fallidas seguidas**. Cuenta consultas, no intentos: una consulta con sus 3 intentos fallidos es un solo fallo.
- **Queda abierto 30 s.** Mientras tanto, voz responde enseguida sin llamar a servidores.
- **Half-open:** pasado ese tiempo deja pasar **una** consulta de prueba. Si sale bien, se cierra; si falla, vuelve a abrirse otros 30 s.
- **Qué cuenta como fallo:**
  - Fallo: solo los 5xx, timeouts y errores de red, una vez agotados los reintentos.
  - Éxito: 403, 404 y 409, porque muestran que servidores responde.
  - No cuentan para ningún lado: el 401, una respuesta inválida y un pedido cancelado, porque no dicen nada sobre la disponibilidad de servidores.
- El breaker es **por instancia** de voz, en memoria. No hace falta compartirlo.

### Errores hacia el cliente de voz

| Situación | Respuesta de voz |
|---|---|
| Servidores responde 404 / 409 / 403 | 404 / 409 / 403 (sin cambios) |
| 200 con `can_connect: false` (miembro sin `CONNECT_VOICE`) | 403 |
| 5xx, timeout o error de red, agotados los reintentos | **503** "El servicio de voz no está disponible en este momento. Reintentar en unos segundos." |
| Breaker abierto | **503**, enseguida |
| Servidores responde **401** | **500**, logueado en `error` sin el secreto |
| Otro status o un 200 que no cumple el contrato | 500 |

**Por qué 500 para el 401:** un 401 solo puede significar que `SERVIDORES_SERVICE_SECRET` de voz no coincide con `SERVICE_SECRET_VOZ` de servidores. No es culpa del usuario y reintentar no lo arregla, así que no corresponde un 503 (que invita a reintentar). Tampoco puede llegar tal cual al cliente: un 401 le diría a la app que la sesión expiró y la mandaría a loguearse de nuevo. Como 500, se ve enseguida en los logs como un error de configuración.

**Por qué el mensaje del 503 no distingue servidores de LiveKit:** al usuario le da lo mismo cuál de los dos falló. En los logs sí se distingue.

### Otros detalles

- **Sin redirecciones:** el cliente no sigue los 3xx, porque Go reenviaría `X-Service-Secret` al host nuevo.
- **Correlación:** se reenvía `X-Request-Id`. Hoy servidores no lo lee, pero queda listo para cuando lo haga, y para OpenTelemetry (paso B11).
- **Logs:** se registran el status, la latencia, el número de intento y los cambios de estado del breaker. Nunca el secreto.

## Alternativas descartadas

- **Sin reintentos (solo timeout):** cualquier 502 pasajero, por ejemplo durante un deploy de servidores, haría fallar un join que un segundo intento habría resuelto.
- **3 intentos de 2 s sin tope total:** en el peor caso, unos 6,7 s de espera. El grupo eligió un tope de 5 s.
- **Reintentar también ante 4xx:** un 403 o un 404 no cambian al reintentar. Solo agregan latencia y carga.
- **`hashicorp/go-retryablehttp`:** es una dependencia con criterios de reintento propios que habría que ajustar. Ya se evitó en el webhook de LiveKit (ver `agents/decisiones.md` de voz).
- **Circuit breaker escrito a mano:** el half-open con concurrencia es fácil de hacer mal. `gobreaker` es chico, muy usado y no trae dependencias en runtime.
- **Contar intentos en el breaker, en lugar de consultas:** abriría después de unos 2 joins fallidos, demasiado sensible para un servicio que se duerme.
- **Breaker compartido entre instancias (en Redis):** agrega complejidad y una dependencia más en el camino del join a cambio de poco: con una o dos instancias, cada una aprende sola en unas pocas consultas.

## Consecuencias

- **Peor caso de un join:** unos 5 s si servidores no responde; casi 0 s con el breaker abierto.
- **Gateway:** la ruta del join necesita un **override de timeout** mayor que 5 s más lo que tarde LiveKit (por ejemplo, 15 s, como `POST /api/v1/servers`). Si no, KrakenD corta a los 3000 ms antes de que voz termine de reintentar. Se configura en el paso B10, en `gateway/partials/voz.tmpl`.
- **Cold start de servidores:** el primer join después de que servidores se durmió probablemente responda 503, porque servidores tarda más que el tope de 5 s en despertar. Si se repiten, el breaker se abre y los joins fallan rápido durante unos 30 s. Se considera aceptable: el usuario recibe un error claro y puede reintentar. La forma de evitarlo es mantener servidores despierto (un ping periódico), que se decide aparte.
- **El 503 es reintentable:** conviene que la app lo trate así, por ejemplo reintentando una vez. Queda pendiente agregar `Retry-After` al 503 en el OpenAPI de voz.
- **Dependencia nueva en voz:** `github.com/sony/gobreaker/v2`.
- **Si cambian los tiempos de servidores** (por ejemplo, un plan pago sin cold start), estos parámetros se revisan. Están todos en `servidores.DefaultHTTPConfig`, salvo el timeout por intento, que viene de `SERVIDORES_TIMEOUT`.
