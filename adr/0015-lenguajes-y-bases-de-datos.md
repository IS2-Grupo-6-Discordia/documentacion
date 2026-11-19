# ADR 0015: Lenguajes y bases de datos de cada servicio

- **Fecha:** 2026-11-19 (registra decisiones tomadas entre septiembre y octubre de 2026)

## Contexto

El enunciado (sección *Tecnologías*) deja libre el lenguaje, pero exige:

- **Al menos dos microservicios en lenguajes distintos.** La cátedra sugiere Python, Node.js o Go.
- **Al menos dos tecnologías de base de datos:** una relacional (SQL) y una no relacional (NoSQL).
- **Bases de datos independientes por servicio** (sección *Componentes*).
- **Justificar en la documentación** qué tecnología usa cada servicio.

Cada servicio tiene datos y cargas distintas:

| Servicio | Qué guarda | Cómo se consulta |
|---|---|---|
| autenticación | Cuentas, perfiles, refresh tokens, tokens de recupero, 2FA, outbox | Por id o email, con unicidad estricta |
| servidores | Servidores, canales, categorías, roles, miembros, overwrites, baneos, silencios, invitaciones, reportes, auditoría, outbox | Joins para calcular permisos efectivos (miembro → roles → overwrites del canal) |
| mensajes | Mensajes, estado de lectura, preferencias de notificación, silencios replicados | Por canal y fecha, paginado por cursor, con mucho volumen y solo agregando |
| voz | Nada propio: LiveKit es la fuente de verdad de quién está en cada sala ([ADR 0004](0004-voz-sin-base-de-datos.md)) | Presencia y tickets en Redis |

Otros condicionantes:

- **Presupuesto cero:** cada base tiene que tener un plan gestionado gratuito.
- **Render plan free:** 512 MB de RAM por servicio, y los servicios se duermen sin tráfico.
- **Contratos con OpenAPI** como fuente de verdad (sección *Testing*), preferentemente autogenerados.
- **El plan inicial** ([`arquitectura/arquitectura.html`](../arquitectura/arquitectura.html), 2026-09-08) ponía mensajes y voz en Go y la autenticación en Firebase. Las dos cosas cambiaron: Firebase se descartó en septiembre (`gateway/agents/decisiones.md`) y mensajes se implementó en Python a fines de octubre.

## Decisión

### Por servicio

| Servicio | Lenguaje y framework | Base de datos | Producción |
|---|---|---|---|
| autenticación | Python 3.12, FastAPI, SQLAlchemy async + asyncpg, Alembic | PostgreSQL | Supabase (schema y usuario propios) |
| servidores | Python 3.12, FastAPI, SQLAlchemy async + asyncpg, Alembic | PostgreSQL | Supabase (schema y usuario propios) |
| mensajes | Python 3.12, FastAPI, Motor | MongoDB | MongoDB Atlas, plan gratuito |
| voz | Go, chi, oapi-codegen, `log/slog`, SDK de LiveKit | Ninguna (ADR 0004) | — |
| gateway | KrakenD CE 2.6, sin código propio ([ADR 0014](0014-api-gateway-con-krakend.md)) | — | — |

Redis (Upstash en producción) no es la base de ningún servicio: es el bus de eventos, el Pub/Sub entre instancias y el lugar de los tickets y la presencia ([ADR 0001](0001-bus-de-eventos-redis-streams.md)).

Los tres clientes (mobile, web y backoffice) se escriben en **TypeScript con React Native y Expo**, y NativeWind para los estilos. La app mobile y el cliente web son una sola base de código (React Native Web). El backoffice usa el mismo stack en un repo aparte.

### Por qué Python en autenticación, servidores y mensajes

- **Son servicios de reglas de negocio:** validaciones, permisos y moderación. Su carga es de I/O (base, Redis, otros servicios), donde `asyncio` alcanza.
- **FastAPI genera el OpenAPI** desde el código (`/docs`) y Pydantic valida requests y responses con los mismos modelos. El contrato no se puede desincronizar del código.
- **Los tres comparten la misma estructura:** configuración, logs JSON, `request_id`, OpenTelemetry, `X-Internal-Secret` y el relay del outbox. Lo que se resuelve en uno se copia al otro.
- **Mensajes en Python y no en Go, como decía el plan inicial:** el requisito de dos lenguajes ya lo cubre voz, y mensajes reusa el esqueleto de los otros dos. Su trabajo pesado (repartir cada mensaje a muchas conexiones) se escala con instancias, porque el reparto entre ellas pasa por Redis Pub/Sub ([ADR 0009](0009-tiempo-real-de-mensajes.md)) y no depende de la concurrencia de un solo proceso.

### Por qué Go en voz

- **LiveKit tiene SDK de servidor oficial en Go** (`server-sdk-go`), para emitir tokens, crear salas, sacar participantes y verificar webhooks ([ADR 0002](0002-voz-con-livekit.md)).
- **Sostiene conexiones abiertas:** el WebSocket de presencia y las suscripciones a Redis corren en goroutines, que son baratas.
- **Un binario estático y chico**, que entra con margen en los 512 MB de Render y arranca rápido después de dormirse.
- **Cubre el requisito de dos lenguajes.**

### Por qué PostgreSQL en autenticación y servidores

- **Los datos son relacionales y con integridad fuerte:** un email único, un miembro por usuario y servidor, un rol asignado una sola vez. Las `UNIQUE` y las claves foráneas hacen idempotentes esas operaciones sin código extra, como sugiere el enunciado.
- **Los permisos se calculan con joins** entre miembros, roles y overwrites de canal.
- **El outbox necesita la misma transacción** que el cambio de negocio (ADR 0001), y Postgres la da sin vueltas.
- **Alembic versiona el esquema**, y cada deploy aplica las migraciones nuevas solo.

### Por qué MongoDB en mensajes

- **El acceso es casi siempre "los últimos N mensajes de un canal"**, con el índice `(channel_id, created_at)` y paginado por cursor. No hace falta ningún join: el autor se guarda por `user_id` y su perfil se pide en lote a autenticación (`/users/batch`).
- **El documento cambia de forma:** menciones de usuarios y de roles, edición, borrado lógico y, más adelante, adjuntos y reacciones. En Mongo se agregan campos sin migraciones.
- **Es la tabla de más volumen y solo crece**, y Mongo escala horizontalmente si hiciera falta.
- **Cubre el requisito de una base NoSQL.**

### Independencia de las bases

- **Ningún servicio lee las tablas o colecciones de otro.** Lo que necesita de otro dominio lo pide por API o lo recibe por eventos.
- **En local**, cada servicio tiene su propio contenedor de base (`discordia_auth`, `discordia_servidores`, `mongo`).
- **En producción**, autenticación y servidores comparten un proyecto de Supabase, pero cada uno con su schema y un usuario que solo tiene permisos sobre él (issue #86 de `documentacion`).

## Alternativas descartadas

- **Un solo lenguaje para todo el backend:** simplifica el CI y las convenciones, pero no cumple el requisito de dos lenguajes.
- **Mensajes en Go (plan inicial):** el reparto en vivo es más barato por proceso, pero obligaba a reescribir en Go todo lo que los servicios Python ya tenían resuelto. Con el reparto entre instancias por Redis, no era la parte que limitaba.
- **Node.js con TypeScript en el backend:** hubiera compartido lenguaje y tipos con los clientes. Se priorizó FastAPI por el OpenAPI autogenerado y la validación con Pydantic, y Go por el SDK de LiveKit.
- **PostgreSQL también para mensajes (con JSONB):** funciona y evita una tecnología más, pero deja sin cumplir el requisito de NoSQL. Además, el acceso de mensajes no usa nada relacional.
- **MongoDB para todo:** pierde las `UNIQUE` y claves foráneas que sostienen el modelo de permisos y la idempotencia de servidores.
- **Firebase Auth y Firestore:** era el plan inicial para la autenticación. Se descartó porque no permite cumplir los requisitos de contraseñas con BCrypt, tokens de recupero hasheados en la base propia y rol en el JWT.
- **Cassandra o ScyllaDB para mensajes:** están pensadas para el volumen de mensajes a gran escala, pero no tienen un plan gestionado gratuito que sirva y son demasiado para este volumen.
- **Una base Postgres compartida con todas las tablas juntas:** rompe la independencia de las bases. Por eso se usa un schema y un usuario por servicio.

## Consecuencias

- **Dos toolchains en el backend:** ruff y pytest en Python, golangci-lint y `go test` en Go, con su CI cada uno. Las convenciones transversales (logs, trazas, health checks, sobre de eventos) se definen en `documentacion` y se implementan dos veces.
- **No hay librería compartida entre servicios.** El código del bus se copia en cada uno y el contrato común vive en [`eventos.md`](../eventos.md) y [`eventos/sobre.schema.json`](../eventos/sobre.schema.json), que los tests validan.
- **Sin joins entre dominios:** mostrar el nombre del autor de un mensaje o de un miembro implica pedirlo en lote a autenticación.
- **Supabase es un punto común** de autenticación y servidores: si el proyecto cae, caen los dos, aunque sus schemas estén aislados.
- **Planes gratuitos con límites de almacenamiento**, hoy de unos 500 MB en Supabase y en Atlas. Hay que vigilarlos si crece el volumen de mensajes.
- **Este ADR reemplaza lo que dicen sobre lenguajes y datos** `arquitectura/arquitectura.html` y el contexto del ADR 0001, donde mensajes figura en Go. Hay que actualizar el diagrama de arquitectura.
