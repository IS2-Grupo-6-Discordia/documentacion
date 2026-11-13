# ADR 0013: Trazas y logs en el backoffice, a través de autenticación

- **Fecha:** 2026-11-13

## Contexto

Las trazas y los logs de los servicios se guardan en Grafana Cloud (Tempo y Loki), según el [ADR 0008](0008-trazabilidad-con-opentelemetry-y-grafana-cloud.md). Para verlas hay que entrar a Grafana con un usuario propio. El staff quiere verlas desde el backoffice:

- las últimas trazas;
- la cascada de una traza, con sus logs;
- los logs de cada servicio;
- la traza que corresponde al código de un error que vio un usuario.

El enunciado no lo pide: es una mejora opcional.

Hay dos restricciones:

- **El token de Grafana no puede llegar al navegador.** Con él cualquiera podría leer todos los datos del stack.
- **La cuota del plan gratuito.** Mirar los datos no agrega ingesta, que es lo que mide la cuota de 50 GB, pero cada consulta pasa por el límite de uso de Grafana y despierta un servicio de Render que puede estar dormido.

## Decisión

### Autenticación hace de proxy de solo lectura

```
Backoffice → Gateway → autenticación (/api/v1/auth/admin/observability/*) → Grafana Cloud (Tempo y Loki)
```

- Va en **autenticación** porque ya tiene la parte de admin, con `require_staff_role` y `require_internal_secret`. En el gateway, las rutas exigen el rol `staff` en el JWT.
- El **token** es de una *access policy* con solo `traces:read` y `logs:read`. Vive como secreto en Render (`OBSERVABILITY_READ_TOKEN`), junto con las URLs de consulta y los ids de instancia de Tempo y Loki. Nunca sale del servicio ni aparece en los logs.
- **Sin esas variables, los endpoints responden `503`** y el resto del servicio no cambia. En local la función queda apagada.

### Endpoints

Todos son `GET`, solo para staff:

| Ruta | Qué devuelve | Fuente |
|---|---|---|
| `/traces?service=&errors_only=&min_duration_ms=&range=` | Hasta 20 trazas, de la más nueva a la más vieja | Búsqueda de Tempo (TraceQL) |
| `/traces/{trace_id}` | Los spans con su servicio, offset, duración y error, y los logs con ese `trace_id` | Tempo y Loki |
| `/logs?service=&level=&range=` | Hasta 100 líneas, de la más nueva a la más vieja | Loki (LogQL) |
| `/codes/{code}` | La traza del request cuyo `request_id` empieza con el código, en las últimas 24 horas | Loki |

### Las consultas las arma el backend

El backoffice nunca manda TraceQL ni LogQL. Cada filtro se valida antes de llegar a la consulta:

- `service` es uno de `autenticacion`, `servidores`, `mensajes` o `voz`.
- `range` es `15m`, `1h`, `6h` o `24h`.
- `level` es `info`, `warn` o `error`.
- `trace_id` son 32 caracteres hexadecimales, y `code`, de 8 a 36 caracteres hexadecimales.

Con OTLP, Loki guarda el servicio como el label `service_name`. El nivel (`severity_text`), el `trace_id` y el `request_id` van como *structured metadata*, y se filtran después del selector: `{service_name="servidores"} | trace_id="…"`. El nivel se compara sin distinguir mayúsculas y acepta `WARN` (Go) y `WARNING` (Python).

### Cuidar la cuota

- **Sin autorefresco.** La pantalla consulta cuando cambia un filtro o cuando se toca "Actualizar".
- **Rangos acotados y `limit` chicos:** 20 trazas, 100 líneas, 24 horas como máximo.
- **Caché en memoria** en autenticación: 30 segundos para las búsquedas y 10 minutos para el detalle de una traza, que casi no cambia. Una traza que todavía no llegó no se cachea.
- **Rate limit en el gateway:** 30 consultas por minuto por IP en cada ruta. Pasado eso, `429`.

### Errores

- `502` si Grafana no responde, o responde con `401`, `403`, `429` o `5xx`. Se loguea un warning con la fuente y el status.
- `503` si la función no está configurada.
- `404` si Tempo no tiene la traza: todavía no llegó o tiene más de 14 días.

## Alternativas descartadas

- **Iframe de Grafana:** Grafana Cloud no permite acceso anónimo, y el login dentro de un iframe suele fallar.
- **Links directos a Grafana Explore:** son mucho más simples, pero el staff necesita un usuario de Grafana y no ve los datos dentro del backoffice.
- **Mandar el token al backoffice y consultar desde el navegador:** expone el token. Además, Grafana Cloud no habilita CORS para eso.
- **Un servicio nuevo para el proxy:** sería otro servicio en Render para cuatro endpoints de lectura.
- **Aceptar TraceQL o LogQL libre:** permitiría consultas caras o que lean más de lo que muestra la pantalla.

## Consecuencias

- **El gateway no aparece en las trazas**, porque no genera spans propios. Mensajes queda vacío hasta que despliegue a `main`.
- **La caché es por instancia y se pierde al reiniciar.** Con una sola instancia en Render alcanza.
- **Los `user_id` quedan visibles para el staff**, que ya los ve en el resto del backoffice. Las reglas de [`observabilidad.md`](../observabilidad.md#qué-no-se-loguea-nunca) no cambian, así que los logs siguen sin contraseñas, tokens ni contenido de mensajes.
- **Si cambia un nombre de servicio** (`OTEL_SERVICE_NAME`), hay que sumarlo a la lista de servicios de autenticación y del backoffice.
