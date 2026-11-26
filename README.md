# Documentación de Discordia

Documentación transversal de Discordia: el enunciado, la arquitectura, las decisiones de diseño (ADRs) y los contratos que comparten todos los servicios. Lo propio de cada servicio (endpoints, variables, cómo levantarlo) está en el README de su repo.

Este repo no tiene código ni setup, salvo las pruebas de carga en [`pruebas/carga/`](pruebas/carga/): se lee en GitHub. Las ramas salen de `develop` y los PRs van a `develop`.

## Contenido

| Archivo | Qué tiene |
|---|---|
| [`enunciado.md`](enunciado.md) | Enunciado del TP: historias obligatorias y optativas, y requisitos no funcionales |
| [`arquitectura/arquitectura.html`](arquitectura/arquitectura.html) | Mapa del sistema: clientes, gateway, servicios, bases, bus de eventos y servicios externos. Se ve descargándolo y abriéndolo en el navegador |
| [`eventos.md`](eventos.md) | Catálogo único de eventos entre servicios: sobre, convenciones, quién emite y quién consume cada uno |
| [`eventos/sobre.schema.json`](eventos/sobre.schema.json) | JSON Schema del sobre de eventos. Los tests de contrato de cada servicio usan una copia |
| [`tiempo-real.md`](tiempo-real.md) | Contrato común de los WebSocket: ticket, frames, cierre y reconexión |
| [`observabilidad.md`](observabilidad.md) | Contrato de logs y trazas: headers, campos de log, niveles y variables `OTEL_*` |
| [`pruebas/carga/tests.md`](pruebas/carga/tests.md) | Pruebas de carga y estrés con k6: entorno aislado, datos de prueba, escenarios y cómo correrlos y analizarlos |
| [`pruebas/carga/informe.md`](pruebas/carga/informe.md) | Informe de las pruebas de carga y estrés: latencias, errores, throughput, cuellos de botella y acciones |

## UX y diseño

| Recurso | Qué tiene |
|---|---|
| [Figma: prototipos y sistema de diseño](https://www.figma.com/design/YV4I8KiDbfm8lBaauL7dx5) | Página **Sistema de diseño** (variables, estilos de texto y componentes) y página **Prototipos** con el cliente web, la app mobile y el backoffice. [Ver el prototipo navegable](https://www.figma.com/proto/YV4I8KiDbfm8lBaauL7dx5?node-id=4-7&starting-point-node-id=4-7) |
| [`ux/sistema-de-diseno.md`](ux/sistema-de-diseno.md) | Sistema de diseño: tokens alineados con `tailwind.config.ts`, componentes y reglas de uso |
| [`ux/decisiones-ux.md`](ux/decisiones-ux.md) | Decisiones de UX (UX-01 a UX-14): cómo se ve, cómo se navega y por qué |

## Decisiones de arquitectura (ADRs)

Cada ADR tiene contexto, decisión, alternativas descartadas y consecuencias.

| ADR | Decisión |
|---|---|
| [0001](adr/0001-bus-de-eventos-redis-streams.md) | Bus de eventos único con Redis Streams |
| [0002](adr/0002-voz-con-livekit.md) | Voz con LiveKit (local en desarrollo, LiveKit Cloud desplegado) |
| [0003](adr/0003-voz-consulta-sincrona-a-servidores.md) | Consulta síncrona de voz a servidores para validar el acceso a un canal |
| [0004](adr/0004-voz-sin-base-de-datos.md) | Voz sin base de datos (LiveKit como fuente de verdad) |
| [0005](adr/0005-voz-resiliencia-ante-servidores.md) | Resiliencia de voz ante servidores (timeouts, reintentos y circuit breaker) |
| [0006](adr/0006-tiempo-real-websocket-por-servicio.md) | Tiempo real con WebSocket por servicio y ticket emitido por el gateway |
| [0007](adr/0007-revocacion-de-acceso-por-servidor.md) | Revocación de acceso por servidor en voz (baneo) |
| [0008](adr/0008-trazabilidad-con-opentelemetry-y-grafana-cloud.md) | Trazabilidad distribuida con OpenTelemetry y Grafana Cloud |
| [0009](adr/0009-tiempo-real-de-mensajes.md) | Tiempo real de mensajes |
| [0010](adr/0010-health-checks-livez-y-readyz.md) | Health checks `/livez` y `/readyz` |
| [0011](adr/0011-silenciar-temporalmente-a-un-miembro.md) | Silenciar temporalmente a un miembro (texto y voz) |
| [0012](adr/0012-filtro-de-palabras-prohibidas.md) | Filtro de palabras prohibidas por servidor |
| [0013](adr/0013-observabilidad-en-el-backoffice.md) | Trazas y logs en el backoffice, a través de autenticación |
| [0014](adr/0014-api-gateway-con-krakend.md) | API Gateway con KrakenD CE |
| [0015](adr/0015-lenguajes-y-bases-de-datos.md) | Lenguajes y bases de datos de cada servicio |
| [0016](adr/0016-despliegue-en-la-nube.md) | Despliegue en la nube: Render, Supabase, Atlas, Upstash, LiveKit Cloud, Vercel y Cloudflare |

Un ADR nuevo lleva el número siguiente y el mismo formato. Si una decisión cambia, se agrega una sección "Actualización" con la fecha al ADR original, sin borrar lo anterior (ver el ADR 0008).

## Repos

| Repo | Qué es |
|---|---|
| [`root`](https://github.com/IS2-Grupo-6-Discordia/root) | Submódulos de todos los repos y entorno local completo (`make up`) |
| [`gateway`](https://github.com/IS2-Grupo-6-Discordia/gateway) | API Gateway (KrakenD) |
| [`microservicio-autenticacion`](https://github.com/IS2-Grupo-6-Discordia/microservicio-autenticacion) | Cuentas, sesiones, 2FA y perfiles (Python, PostgreSQL) |
| [`microservicio-servidores`](https://github.com/IS2-Grupo-6-Discordia/microservicio-servidores) | Servidores, canales, roles, miembros y moderación (Python, PostgreSQL) |
| [`microservicio-mensajes`](https://github.com/IS2-Grupo-6-Discordia/microservicio-mensajes) | Mensajes, menciones y notificaciones (Python, MongoDB) |
| [`microservicio-canales-de-voz`](https://github.com/IS2-Grupo-6-Discordia/microservicio-canales-de-voz) | Canales de voz y llamadas 1 a 1 (Go, LiveKit) |
| [`discordia-frontend`](https://github.com/IS2-Grupo-6-Discordia/discordia-frontend) | Cliente web y app de Android (Expo) |
| [`discordia-backoffice`](https://github.com/IS2-Grupo-6-Discordia/discordia-backoffice) | Backoffice del staff (Expo) |

## Backlog

Las historias y las tareas técnicas son los issues de este repo, organizados en los tableros del project: Historias Obligatorias y Historias Optativas. Cada PR de los otros repos referencia su issue con `IS2-Grupo-6-Discordia/documentacion#N`.
