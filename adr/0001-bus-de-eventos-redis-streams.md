# ADR 0001: Bus de eventos único con Redis Streams

- **Fecha:** 2026-10-06

## Contexto

El enunciado pide que la comunicación entre servicios backend sea **asíncrona por defecto**. Los consumidores tienen que ser idempotentes y el sistema tiene que tolerar mensajes duplicados o fuera de orden. Por ejemplo, al banear o suspender a alguien, voz y mensajes lo desconectan como reacción a un evento, no por una llamada sincrónica encadenada.

Mensajes, además, necesita pub/sub entre sus instancias.

Se acordó un **único mecanismo de eventos para todo el sistema**: mismo sobre, mismas garantías y un catálogo único ([`eventos.md`](../eventos.md)). 

Restricciones del entorno:
- Los servicios corren en Render (plan gratuito), que **duerme** los servicios sin tráfico. Un consumidor dormido no puede recibir nada en el momento, así que el bus tiene que **retener** los eventos hasta que vuelva.
- Hay servicios en Python (autenticación, servidores) y en Go (mensajes, voz). La tecnología tiene que tener buen cliente en los dos.
- Presupuesto cero: hace falta una opción gestionada con plan gratuito.

## Decisión

Usamos **Redis Streams** como bus de eventos único:

- **Un stream por dominio emisor:** `discordia:events:<dominio>`, por ejemplo `discordia:events:auth`.
- **Un consumer group por servicio consumidor:** `voz`, `mensajes`, etc. Cada grupo recibe todos los eventos del stream una vez, y sus instancias se reparten el trabajo.
- **Entrega al menos una vez:** el consumidor confirma con `XACK` recién después de procesar. Lo no confirmado queda pendiente y se reclama con `XAUTOCLAIM`.
- **Emisor con *transactional outbox*:** el evento se guarda en la base del servicio en la **misma transacción** que el cambio de negocio. Un *relay* en segundo plano lo publica con `XADD` y lo marca como publicado. Si Redis está caído, el cambio de negocio igual se confirma y el evento sale cuando vuelve.
- **Consumidores idempotentes:** deduplican por el `id` del evento y deciden según el estado actual, no según el orden de llegada.

El formato del sobre, las convenciones y las reglas del consumidor están en [`eventos.md`](../eventos.md). El JSON Schema del sobre está en [`eventos/sobre.schema.json`](../eventos/sobre.schema.json).

### Proveedor

En producción usamos **Upstash Redis** (plan gratuito):

- **Capacidad:** 256 MB de datos y 500 000 comandos por mes.
- **Región:** la misma que los servicios de Render, para minimizar la latencia. La región primaria de una base de Upstash no se puede cambiar: para moverla hay que crear otra y cambiar `REDIS_URL`.
- **Eviction:** **desactivado**. Con eviction activo, Upstash borraría claves al llenarse la memoria, incluidos streams con eventos todavía sin consumir.
- **Conexión:** `REDIS_URL` con esquema `rediss://` (TLS). Se carga en las variables de entorno de cada servicio en Render, nunca en el repo.

En desarrollo local se usa el Redis de `root/infra/docker-compose.yml`, en la red `discordia-net`.

Descartamos **Redis Cloud** (plan gratuito): sus 30 MB no alcanzan para un stream con el recorte por defecto (~100 000 eventos de unos 400 bytes, unos 40 MB).

### Código compartido

No hay librería compartida. Cada servicio tiene su propio módulo de eventos (Python: `app/events/`; Go: con `go-redis`) que implementa el contrato. Para que las copias no diverjan, cada servicio tiene un **test de contrato** que valida los sobres que emite contra una copia del JSON Schema.

Motivos:
- un paquete Python no les sirve a los servicios Go;
- instalar desde repos privados complica CI, Docker y Render;
- el mecanismo es poco código y el outbox necesita la sesión de base de cada servicio.

## Alternativas descartadas

- **Redis Pub/Sub:** no retiene mensajes. Si el consumidor está dormido o reiniciando, el evento se pierde. (Sí sirve para el *fan-out* efímero entre instancias de mensajes, que puede usar el mismo Redis.)
- **RabbitMQ (CloudAMQP):** colas durables y buen modelo de ruteo, pero suma una segunda pieza de infraestructura. Redis igual va a hacer falta para el pub/sub de mensajes y para el estado en vivo (presencia), así que con Redis alcanza una sola.
- **NATS JetStream:** liviano y con persistencia, pero casi no hay oferta gestionada gratuita.

## Consecuencias

- Cada emisor suma una tabla `outbox_events` y una tarea de fondo (relay). El relay solo corre mientras el emisor está despierto. Si está procesando la acción que genera el evento, lo está.
- Los streams se recortan con `XADD … MAXLEN ~ N`. Un consumer group que quede atrás más de `N` eventos los pierde. `N` se dimensiona con margen (100 000 por defecto).
- Puede haber **duplicados**: el relay puede publicar dos veces si se cae entre `XADD` y marcar el evento como publicado. Por eso la idempotencia del consumidor es obligatoria, no opcional.
- **Orden:** dentro de un stream, el orden es el de publicación. Entre streams distintos no hay orden garantizado.
- **Cuota de comandos:** en Upstash cada comando consume cuota.
  - Los emisores gastan poco: el relay revisa el outbox en Postgres y solo usa Redis para el `XADD` de cada evento.
  - Los consumidores tienen que usar `XREADGROUP … BLOCK` con timeouts largos (por ejemplo, 30 s ≈ 86 000 comandos por mes por consumidor siempre despierto) y no hacer *polling* agresivo.
- **Inactividad:** Upstash archiva las bases gratuitas tras al menos 30 días sin uso, con backup y avisos por mail. Si el proyecto queda parado ese tiempo, hay que restaurarla.
