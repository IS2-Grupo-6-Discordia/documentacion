# ADR 0014: API Gateway con KrakenD CE

- **Fecha:** 2026-11-19 (registra una decisión tomada el 2026-09-08, al crear el repo `gateway`)

## Contexto

El enunciado (sección *Componentes*) pide un **API Gateway como punto único de entrada**, que centralice tres cosas: el enrutamiento hacia los servicios backend, la validación de los tokens de sesión y el rate limiting. Su diseño se justifica en un ADR.

Lo que tiene que atender:

- **Cuatro backends:** autenticación, servidores y mensajes (Python) y voz (Go), cada uno con su URL en Render.
- **Tres clientes:** la app mobile, el cliente web y el backoffice. Todos son navegadores o apps que necesitan CORS y la misma API.
- **Tokens propios:** autenticación emite JWT RS256 con `sub` y `role`, y publica sus claves en `GET /api/v1/auth/.well-known/jwks.json`. Se descartó Firebase Auth porque no permite cumplir los requisitos de contraseñas, tokens de recupero y rol en el JWT (`gateway/agents/decisiones.md`).
- **Rate limiting:** el enunciado lo pide en login y recupero, por IP y por cuenta.

Hay otros condicionantes:

- **Render plan free:** 512 MB de RAM por servicio, se duerme sin tráfico y tarda de 30 a 60 s en despertar.
- **Presupuesto cero:** nada que cobre por request ni por instancia.
- **Equipo de varias personas tocando rutas a la vez:** cada historia suma endpoints, y hoy son 127.

## Decisión

Usamos **KrakenD Community Edition 2.6**, desplegado como un servicio Docker más en Render. Es un gateway declarativo: todo su comportamiento sale de la configuración, sin código propio.

### Configuración

- **`krakend.tmpl` + `partials/<servicio>.tmpl`** con la *Flexible Config* de KrakenD. La raíz define lo global y cada partial define las rutas de un servicio. Así cada persona toca el archivo de su servicio sin conflictos de merge.
- **Todos los valores sensibles o que cambian por entorno vienen de variables:** URLs de los backends (`MS_*_URL`), secretos internos, orígenes de CORS y límites de rate.
- **Versión fija:** la misma imagen `devopsfaith/krakend:2.6` en el `Dockerfile` y en el CI, nunca `:latest`.
- **CI:** `krakend check --lint` sobre la configuración resuelta en cada PR y en cada push a `main`.

### Responsabilidades

| Qué | Cómo |
|---|---|
| Enrutamiento | Prefijos `/api/v1/auth`, `/api/v1/servers`, `/api/v1/channels`, `/api/v1/messages`, `/api/v1/voice`, `/api/v1/admin`, etc., cada uno hacia el `host` de su servicio |
| Validación del JWT | `auth/validator` contra el JWKS de autenticación, con el JWKS cacheado 15 minutos (`shared_cache_duration: 900`) |
| Identidad hacia el backend | `propagate_claims`: `sub` → `X-User-Id` y `role` → `X-User-Role`. Pisa cualquier valor que mande el cliente |
| Rutas de staff | `roles_key: "role"` y `roles: ["staff"]` en las rutas del backoffice |
| Confianza gateway → servicio | `X-Internal-Secret`, uno distinto por servicio (`INTERNAL_SECRET_<SERVICIO>`), inyectado con `modifier/martian`. Los servicios rechazan cualquier request sin él |
| Rate limiting | Global por instancia (`qos/ratelimit/service`, `GLOBAL_RATE_LIMIT`) y por IP en cada ruta (`qos/ratelimit/router`, `strategy: ip`): `PUBLIC_RATE_LIMIT` en las rutas públicas como login y recupero, y `WRITE_RATE_LIMIT` en las escrituras |
| Seguridad HTTP | CORS con hasta 3 orígenes por variable, HSTS, `X-Frame-Options: DENY`, `nosniff` y `Referrer-Policy` |
| Timeouts | 3000 ms global, con override de 15000 ms en las rutas que pueden encontrar un backend dormido o que encadenan reintentos (login, crear servidor, join de voz, [ADR 0005](0005-voz-resiliencia-ante-servidores.md)) |
| Health checks | `/livez` (el health check propio de KrakenD) y `/readyz` (el JWKS de autenticación), según el [ADR 0010](0010-health-checks-livez-y-readyz.md) |

Rutas públicas, sin JWT: registro y su código de verificación, login (con y sin 2FA), login con Google, refresh, logout (revoca el refresh token del body), recupero de contraseña, confirmación de cambio de email y el JWKS. Todas son de autenticación y todas menos el JWKS tienen rate limit por IP. Todo lo demás exige un JWT válido. Una ruta nueva es protegida por defecto.

### Lo que no pasa por el gateway

- **WebSocket de tiempo real:** KrakenD CE no proxea WebSocket. El cliente pide por el gateway un ticket de un solo uso y se conecta directo al servicio ([ADR 0006](0006-tiempo-real-websocket-por-servicio.md)).
- **Audio y video:** van directo a LiveKit Cloud con un token emitido por voz ([ADR 0002](0002-voz-con-livekit.md)).
- **Llamadas entre servicios:** voz y mensajes consultan a servidores directo, con `X-Service-Secret` ([ADR 0003](0003-voz-consulta-sincrona-a-servidores.md)).

## Alternativas descartadas

- **Gateway propio en FastAPI o Express:** permitiría proxear WebSocket y elegir cada status, pero obliga a escribir, testear y mantener la validación de JWT, el cacheo del JWKS, el rate limiting y el proxy. Es otro servicio con lógica propia, y un error ahí es un hueco de seguridad para todo el sistema.
- **Kong OSS:** cubre lo mismo y más, pero es más pesado de operar en 512 MB y sus extensiones son plugins en Lua. Para lo que necesitamos, la configuración declarativa de KrakenD alcanza.
- **NGINX o Traefik como reverse proxy:** rutean bien y tienen rate limiting, pero la validación de JWT contra un JWKS no viene en las versiones libres o depende de plugins de terceros. Habría que sumar un servicio de auth delante (`auth_request` / `forwardAuth`), que es otra llamada por request.
- **Gateway gestionado de un cloud (AWS API Gateway, Google API Gateway):** saca la operación de encima, pero cobra por request fuera del free tier, ata a otro proveedor además de Render y suma latencia entre nubes.
- **Sin gateway, cada servicio valida el JWT:** el enunciado lo admite solo en casos excepcionales. Duplica la validación, el rate limiting y el CORS en dos lenguajes, y cada servicio queda expuesto a internet.
- **KrakenD Enterprise:** trae WebSocket y más, pero es pago.

## Consecuencias

- **Los servicios no validan JWT.** Confían en `X-User-Id` y `X-User-Role` solo si llega el `X-Internal-Secret` correcto. Un servicio que tome la identidad del path o del body rompe el contrato (`gateway/agents/seguridad.md`).
- **El access token sigue siendo válido hasta que vence**, aunque se haga logout: el gateway no tiene blocklist. Se mitiga con una vida corta (`JWT_EXPIRE_MINUTES`) y revocando el refresh token.
- **El rate limiting vive en la memoria de cada instancia.** Con una sola instancia en Render alcanza. Si el gateway escala a varias, el límite efectivo se multiplica por la cantidad de instancias.
- **El gateway limita por IP, no por cuenta.** En login la cuenta solo viaja en el body, que KrakenD no usa como clave. El límite por cuenta le toca a autenticación: ya lo tiene en el recupero y falta en el login.
- **El tiempo real se resuelve fuera del gateway** (ADR 0006), con un ticket emitido por el gateway para que siga siendo la única puerta de entrada.
- **Algunas limitaciones de KrakenD CE condicionan otros diseños:** no deja elegir el status de `/readyz` (devuelve 500 en vez de 503) ni convertir una respuesta parcial en error (ADR 0010).
- **Cold starts:** con el timeout de 3000 ms, cada ruta que despierta un backend necesita su override. Los frontends además despiertan a los servicios al abrir la app (`wake.ts`).
- **Cada historia nueva toca el gateway:** sumar la ruta al partial del servicio, con `auth/validator`, `input_headers` y el rate limit que corresponda.
- **Observabilidad:** el gateway loguea en JSON con nivel configurable y exporta trazas a través de un collector que corre en su mismo contenedor, porque KrakenD CE no puede autenticarse contra Grafana Cloud ([ADR 0008](0008-trazabilidad-con-opentelemetry-y-grafana-cloud.md), actualización del 2026-11-19).
- **Al subir de versión de KrakenD hay que volver a probar** que `propagate_claims` pisa los headers de identidad que manda el cliente. No está documentado explícitamente por KrakenD y se verificó a mano en la 2.6.
