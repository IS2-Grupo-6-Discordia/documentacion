# ADR 0003: Consulta síncrona de voz a servidores para validar el acceso a un canal

- **Fecha:** 2026-10-06

## Contexto

Para entrar a un canal de voz, el microservicio tiene que conocer en el momento del pedido:
- si el canal existe y es de voz
- si el usuario es miembro del servidor del canal
- si su rol le da el permiso de conexión (CA 2: "Dado que un miembro no tiene permiso de conexión sobre un canal de voz… el sistema no se lo permite").

Todos esos datos son de **servidores**: canales, membresías, baneos, roles y el bitmask de permisos, donde ya existe `CONNECT_VOICE` (bit 8, incluido en `DEFAULT_ROLE_PERMISSIONS`).

## Decisión

En `POST /api/v1/voice/channels/{channel_id}/join`, voz **consulta a servidores de forma síncrona** antes de emitir el token de LiveKit:

```
GET /internal/voice/channels/{channel_id}/access?user_id={uuid}

200 { "channel": { "id": "...", "server_id": "...", "type": "voice" }, "can_connect": true }
404 el canal no existe
403 el usuario no es miembro del servidor (o está baneado)
409 el canal no es de voz
```

- **El join exige `CONNECT_VOICE`.** Servidores calcula el permiso con su lógica actual (`effective_permissions` / `has_permission`, donde `ADMINISTRATOR` implica todo). **Voz nunca replica la lógica de roles**: solo usa la respuesta.
- La misma consulta protege el listado de participantes de un canal: solo se ven canales a los que el usuario tiene acceso.
- **Seguridad:** las rutas `/internal/*` no se publican en el gateway. Se protegen con un **secreto propio del par voz → servidores**, distinto del secreto del gateway. El nombre del header está pendiente.
- **Contrato:** el endpoint se documenta en el OpenAPI de servidores. El `user_id` va por query porque lo manda voz, un servicio de confianza, que lo toma de `X-User-Id`; el usuario final nunca elige ese valor.
- **Resiliencia:** timeout corto por intento, reintentos con backoff solo ante fallos transitorios y circuit breaker. Los parámetros se documentan en un ADR propio cuando se implemente.

## Alternativas descartadas

- **Réplica local de permisos en voz, alimentada por eventos** (`servers.member_roles.changed`, `servers.channel.deleted`, …): evita la llamada síncrona, pero obliga a voz a tener base de datos y a reimplementar el cálculo de permisos. Duplicar esa lógica es la fuente más probable de bugs de seguridad, y servidores todavía no emite eventos.
- **Que el cliente mande los permisos o el JWT los incluya:** el JWT lo emite autenticación y solo trae el rol global (`user`/`staff`), no los roles por servidor. Confiar en lo que manda el cliente no es aceptable.
- **Validar en el gateway:** KrakenD CE no puede consultar a servidores para decidir; agregar esa lógica en el gateway la saca del servicio que la conoce.
- **Dejar entrar a cualquier miembro, sin chequear el permiso:** contradice el CA 2 de la historia de unirse a un canal de voz.

## Consecuencias

- **El join depende de que servidores esté disponible.** Si servidores está caído, el join falla con un error claro, pero el resto de voz sigue funcionando: los que ya están conectados siguen hablando, porque la media va directo a LiveKit.
- **Cold starts de Render:** voz dormido más servidores dormido superan el timeout global del gateway (3000 ms). La ruta del join necesita un **override de timeout** en el gateway, y los reintentos de voz tienen que entrar en ese presupuesto.
- **El permiso se chequea solo al entrar.** Si a alguien conectado le quitan `CONNECT_VOICE`, lo banean o lo suspenden, la desconexión llega por eventos ([ADR 0001](0001-bus-de-eventos-redis-streams.md)), no por esta consulta.
- **Dependencias con servidores:** el endpoint interno, el secreto propio y que los servidores nuevos tengan un rol por defecto (sin él, solo el dueño tiene permisos en un servidor recién creado). Hasta que existan, voz usa un fake de la interfaz.
