# Informe de pruebas de carga y estrés

Corridas del 25/11/2026 sobre `main` de cada servicio. Los scripts, el entorno y las
instrucciones para repetirlas están en el [TEST](tests.md); las tablas completas y los
resúmenes de k6, en [`resultados/`](resultados/).

## Resumen

- **Uso normal (100 usuarios):** el sistema sobra. Con 100 usuarios chateando a la vez (~15
  mensajes/s y ~270 entregas/s por WebSocket), el p95 de enviar y leer mensajes es de ~55 ms y el
  de entrega en tiempo real de 52 ms. No hubo errores ni mensajes perdidos.
- **Quiebre:** el sistema se rompe entre **200 y 300 usuarios** (~60 mensajes/s). Con 200, la
  latencia sube a ~900 ms; con 300, la mitad de los envíos falla.
- **El cuello de botella es `microservicio-servidores`:** cada mensaje enviado le consulta permisos
  y el servicio corre en un solo proceso de Python, así que no puede usar más de un núcleo de CPU.
  Cuando se satura, el circuit breaker de mensajes se abre y empieza a rechazar envíos con 503. El
  sistema degrada como se diseñó (no se cae, falla rápido y se recupera solo), pero el usuario ve
  errores.
- **Acción medida: servidores con 4 procesos.** Con 200 usuarios, el p95 del envío baja de 889 ms a
  112 ms y la mediana, de 566 ms a 38 ms. Con 300 usuarios, los errores bajan del 47% al 3%. El
  cuello pasa a ser la CPU de la propia máquina de prueba.
- **Login:** aguanta ~10 logins/s. Por encima se encola sin límite hasta que el gateway corta a
  los 15 s, y entonces fallan todos juntos en lugar de rechazarse rápido unos pocos.
- **Mongo y Redis no fueron cuello de botella** en ningún escenario.

## 1. Objetivo y alcance

El enunciado pide un sistema escalable y con tiempo real. Las preguntas que responde la prueba son:

1. ¿Cumple el sistema con objetivos razonables de latencia y errores con un uso realista?
2. ¿Dónde se rompe, y qué componente lo limita?
3. ¿Qué cambio mueve ese límite, y cuánto?

La prueba cubre los flujos centrales del chat:

- login;
- apertura de un canal con su historial;
- paginación hacia atrás;
- envío de mensajes;
- conexión por WebSocket con ticket;
- suscripción y entrega en tiempo real.

Voz (LiveKit) queda fuera: su carga la maneja LiveKit Cloud y no nuestro código.

### Objetivos (umbrales de k6)

| Métrica | Objetivo |
|---|---|
| p95 de cualquier request del escenario | < 500 ms |
| p95 de envío (`POST`) y de historial (`GET`) | < 500 ms |
| p95 de entrega por WebSocket (de punta a punta) | < 1 s |
| Tasa de error HTTP | < 1% |
| Mensajes propios que vuelven por el socket | > 99% |
| p95 del login | < 1 s |

## 2. Entorno

**Por qué en local y no contra el deploy:** en el plan gratuito de Render los servicios hibernan,
tienen una fracción de CPU y limitan las ráfagas. Lo que se mediría serían esos límites, no
nuestro código. Además se gastarían las cuotas gratuitas de Atlas, Upstash y Grafana Cloud.

| | |
|---|---|
| Máquina | Notebook Intel i7-7700HQ (4 núcleos / 8 hilos), 16 GB de RAM, Linux |
| Herramientas | Docker 28.1.1, k6 v2.3.0, en la misma máquina que el sistema |
| Versiones probadas | `main` de cada servicio: gateway `0b38583`, autenticación `99c9752`, servidores `5ebc080`, mensajes `df94da9` |
| Topología | Gateway (KrakenD), autenticación, servidores, **2 instancias de mensajes**, Postgres ×2, Mongo, Redis |
| Datos | 200 usuarios, 1 servidor con 5 canales y 1000 mensajes por canal, todo creado por la API (`seed.js`) |

**Diferencias con el compose de desarrollo:**

- Se corren las imágenes como en el deploy, sin `--reload` ni código montado como volumen.
- Los rate limits del gateway están altos, porque todo el tráfico de k6 sale de una sola IP.
- Los tokens duran 120 minutos, para que no venzan durante una corrida.

### Cómo se mide la entrega en tiempo real

Cada usuario virtual hace sesiones de chat de 45–60 s:

1. abre el canal y pide su historial;
2. pide un ticket y abre el WebSocket;
3. se suscribe al canal;
4. manda un mensaje cada 3–5 s y cada tanto pagina hacia atrás.

Los usuarios se reparten entre las dos instancias de mensajes. El emisor escribe la hora de envío
en el contenido del mensaje, y cada receptor calcula `entrega_ms` cuando le llega el
`messages.created`. Como todo corre en la misma máquina, el reloj es el mismo. Que los receptores
de **las dos** instancias reciban todos los mensajes prueba el fan-out entre instancias por Redis
Pub/Sub.

## 3. Resultados

### 3.1 Carga sostenida: 100 usuarios durante 5 minutos

Pasa todos los umbrales con margen ([tabla por minuto](resultados/carga-100vus.md)).

| Métrica | Valor | Objetivo |
|---|---|---|
| p95 `POST` de mensaje | 50 ms (p99: 69 ms) | < 500 ms ✅ |
| p95 `GET` de historial | 49 ms (p99: 81 ms) | < 500 ms ✅ |
| p95 de entrega por WebSocket | 52 ms (p99: 71 ms) | < 1 s ✅ |
| p95 de apertura del WebSocket | 4 ms | — |
| Errores HTTP | 0 de 10.596 | < 1% ✅ |
| Mensajes propios recibidos | 7628 de 7628 | > 99% ✅ |
| Entregas por WebSocket | 140.318 (~270/s) | — |

### 3.2 Estrés: escalones de 50 a 400 usuarios

Cada escalón dura 2 minutos, con un mensaje cada ~3 s por usuario. La tabla toma solo las
mesetas, sin las rampas de subida ([1 proceso](resultados/estres-1worker.md),
[4 procesos](resultados/estres-4workers.md)).

**Servidores con 1 proceso** (como está hoy el Dockerfile):

| Usuarios | Envíos OK/s | `POST` p50 / p95 | p95 de entrega | Errores | Mensajes perdidos | CPU de servidores |
|---|---|---|---|---|---|---|
| 50 | 15 | 23 / 44 ms | 44 ms | 0% | 0% | 23% |
| 100 | 31 | 28 / 83 ms | 84 ms | 0% | 0% | 42% |
| **200** | **60** | **566 / 889 ms** | **890 ms** | 0% | 0% | **102%** |
| 300 | 44 | 599 / 6756 ms | 3,6 s | **47%** | 89% | 102% |
| 400 | 55 | 2,1 / 12,0 s | 11,8 s | **47%** | 71% | 100% |

**Servidores con 4 procesos** (`--workers 4`, sin otro cambio):

| Usuarios | Envíos OK/s | `POST` p50 / p95 | p95 de entrega | Errores | Mensajes perdidos | CPU de servidores |
|---|---|---|---|---|---|---|
| 50 | 16 | 22 / 39 ms | 39 ms | 0% | 0% | 23% |
| 100 | 30 | 26 / 62 ms | 63 ms | 0% | 0% | 53% |
| **200** | **61** | **38 / 112 ms** | **114 ms** | 0% | 0% | 114% |
| 300 | 69 | 6,0 / 12,6 s | 12,5 s | **2,7%** | 14% | 226% |
| 400 | 57 | 2,1 / 4,5 s | 5,0 s | 46% | 74% | 119% |

"Mensajes perdidos" es la proporción de mensajes propios que no volvieron por el socket. Incluye
los que el servidor rechazó con 503, que el cliente real reintentaría.

### 3.3 Ráfaga de login

La tasa de llegada sube por escalones y no espera a que el servicio responda, como en una ráfaga
real ([tabla](resultados/login.md)).

| Logins/s pedidos | p95 del login | Errores | CPU de autenticación |
|---|---|---|---|
| 5 | ~370 ms | 0% | ~160% |
| 10 | ~470 ms | 0% | ~320% |
| 20 | 9,5 s → 15 s | 1% → 15% | ~460% (saturado) |
| 30–40 | 15 s (timeout del gateway) | 50–90% | ~420–480% |

## 4. Cuellos de botella

### 4.1 `microservicio-servidores` limita todo el sistema

**Evidencia:**

- Con 1 proceso, la CPU de servidores se clava en ~100% (un núcleo entero) justo en el escalón
  donde la latencia salta de 83 ms a 889 ms (200 usuarios).
- Al mismo tiempo, su Postgres promedia ~13% de CPU, las instancias de mensajes ~50% y Mongo y
  Redis tienen margen. El límite es el proceso de Python de servidores, no la base.

**Causa:**

- Cada `POST` de mensaje y cada suscripción por WebSocket le preguntan a servidores, por HTTP, si
  el usuario puede escribir o leer en ese canal (`/internal/messages/channels/{id}/access`).
- Esa consulta hace **8 queries seguidas** con el ORM (`message_access_service.py`): canal, ban,
  membresía, servidor, roles, overwrites, silencio y palabras prohibidas. El costo dominante es
  la CPU de Python armando y procesando esas queries.
- Con un solo proceso de uvicorn, ese trabajo no puede usar más de un núcleo.
- El historial (`GET`) ya tiene un caché de 10 s para la decisión de acceso. El envío (`POST`)
  pregunta siempre.

**Cómo se propaga:**

1. Las respuestas de servidores pasan los 2 s del timeout del cliente de mensajes.
2. Tras 5 fallas seguidas, el circuit breaker de mensajes se abre (ADR 0005).
3. Con el breaker abierto, mensajes rechaza con 503 sin llamar a servidores: 16.737 envíos y 1211
   suscripciones rechazados en la corrida con 1 proceso.

Es el comportamiento diseñado: el servicio de mensajes no se cae ni acumula requests colgadas, y
se recupera solo cuando la carga baja: en la bajada final, los errores caen a 1,4%. Pero el usuario
ve errores, y el cliente cae a polling.

### 4.2 El login no tiene contrapresión

**Evidencia:** el p95 pasa de ~470 ms a 15 s apenas la tasa supera los ~10 logins/s.
Autenticación llega a ~450% de CPU (bcrypt corre en hilos y usa varios núcleos) y sus requests se
encolan.

**Causa:** el hash de contraseña (bcrypt_sha256, cost 12) cuesta ~0,3 s de CPU por login. Es
caro **a propósito**, para frenar la fuerza bruta, y está bien que lo sea. El problema es que no
hay límite de concurrencia: pasada la capacidad, cada login nuevo espera detrás de todos los
anteriores hasta el timeout de 15 s del gateway, y fallan todos.

En producción lo mitiga el rate limit del gateway (10 logins por minuto por IP), pero ese límite
no protege contra muchas IPs a la vez, por ejemplo todos los usuarios reconectando después de un
corte.

### 4.3 Hallazgos menores

- **Reparto desparejo entre instancias de mensajes.** El gateway alcanza a las dos instancias por
  el mismo nombre, pero reutiliza conexiones, así que una recibe más `POST` que la otra (hasta el
  doble de CPU). No afecta la entrega, porque el fan-out por Redis llega a las dos, pero
  desperdicia capacidad.
- **Los 500 que se vieron los genera el gateway** cuando corta una request a los 15 s ("context
  deadline exceeded"), no los servicios.
- **El healthcheck de Mongo infla la CPU medida.** Lanza `mongosh` (un proceso Node) cada 5 s. En
  una medición de 20 s, el contenedor usaba 16% y `mongod` solo 2%. Por eso, en las tablas, la CPU
  de Mongo hay que leerla con cuidado. En el compose de carga se espació a 60 s.

### 4.4 Lo que no fue cuello de botella

- **Mongo:** las consultas de historial usan el índice `(channel_id, created_at)`. Con más de
  43.000 mensajes en la colección, el p95 de historial fue de ~165 ms con 200 usuarios.
- **Redis:** menos de 7% de CPU, mientras los usuarios recibían en promedio más de 1600 mensajes/s
  por WebSocket, todos distribuidos por Pub/Sub.
- **Gateway:** menos de 20% de CPU sostenida.
- **El WebSocket en sí:** abrirlo tarda unos pocos ms, y cuando servidores no está saturado no se
  perdió ningún mensaje.

## 5. Acciones

| # | Cuello | Acción | Estado | Impacto esperado | Dónde |
|---|---|---|---|---|---|
| 1 | Servidores | Correr varios procesos de uvicorn (`--workers N`, con N = CPUs de la instancia) | **Medida en el entorno de carga** (§3.2); falta aplicarla al deploy | Con 200 usuarios: p95 de 889 a 112 ms; errores con 300: de 47% a 3% | `Dockerfile` de servidores |
| 2 | Servidores | Caché corto (5–10 s) de la decisión de acceso de **escritura** en mensajes, igual al que ya existe para lectura | Propuesta | Elimina la mayoría de las consultas a servidores: un usuario que chatea manda varios mensajes al mismo canal en pocos segundos | `microservicio-mensajes`, cliente de servidores |
| 3 | Servidores | Bajar las 8 queries de la consulta de acceso a 1–2 (joins o una vista) | Propuesta | Menos CPU por consulta, con cualquier cantidad de procesos | `message_access_service.py` |
| 4 | Login | Limitar los hash simultáneos con un semáforo y responder 503 con `Retry-After` cuando se llena | Propuesta | Una ráfaga rechaza rápido el excedente en vez de hacer fallar a todos a los 15 s | `microservicio-autenticacion`, `core/security.py` |
| 5 | Mensajes | Varios procesos también en mensajes. Es seguro: tickets, Pub/Sub y bus de eventos ya están compartidos en Redis | Propuesta | Con servidores resuelto, mensajes es el próximo en saturar un núcleo (~90–100% con 300 usuarios) | `Dockerfile` de mensajes |
| 6 | Instancias de mensajes | Balanceo real entre instancias (un balanceador delante o el de la plataforma) | Propuesta | Usar la capacidad de todas las instancias | Infraestructura |

**Sobre el deploy actual:** el plan gratuito de Render da una fracción de CPU y 512 MB de RAM
por servicio. Servidores con 4 procesos usó ~410 MB en la prueba, así que la acción 1 solo rinde
en una instancia con al menos un núcleo entero, y ahí N se ajusta a sus CPUs y memoria. En el
plan gratuito, lo que más rinde son **las acciones 2 y 3**, porque reducen el trabajo en lugar de
repartirlo. La recomendación es aplicar primero la 2, que es la de menor esfuerzo y mayor
impacto, y dejar la 1 lista para cuando el plan lo permita.

**Seguridad de la acción 1:** el relay del outbox toma filas con `SKIP LOCKED` y el job de
silencios bloquea las filas que toca, así que varios procesos no publican eventos duplicados ni
se pisan. Por la misma razón, varias instancias de servidores también serían seguras.

## 6. Limitaciones

- **Una sola máquina.** k6 y todo el sistema compartieron 4 núcleos físicos. Con 4 procesos en
  servidores y 300 usuarios o más, los contenedores llegaron a sumar ~700% de CPU sobre 800%:
  pasado ese punto, el límite medido es la notebook, no un servicio. Los valores absolutos son de
  esta máquina; lo que se puede generalizar es la comparación entre corridas y qué componente se
  satura primero.
- **Sin latencia de red.** En el deploy hay que sumar la latencia entre servicios (Render,
  Upstash, Atlas) y la del cliente.
- **Datos acumulados.** La corrida con 4 procesos arrancó con más historial que la de 1 proceso
  (~43.000 mensajes contra ~13.000), porque las corridas anteriores agregaron mensajes. Como las
  consultas usan índice, no cambia la comparación, y en todo caso desfavorece a la corrida de 4
  procesos.
- **Un solo servidor de chat.** Todos los usuarios están en un servidor con 5 canales (~40
  suscriptos por canal con 200 usuarios). Es un caso exigente para el fan-out; muchos servidores
  chicos repartirían mejor la carga.
- **No se probó:** voz, subida de archivos, notificaciones y la recuperación tras la caída de una
  instancia de mensajes.
