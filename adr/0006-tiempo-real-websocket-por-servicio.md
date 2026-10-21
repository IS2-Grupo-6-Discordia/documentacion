# ADR 0006: Tiempo real con WebSocket por servicio y ticket emitido por el gateway

- **Fecha:** 2026-10-20

## Contexto

Varias historias necesitan que el servidor le avise al cliente sin que este pregunte:
- **Historia 20 (voz):** la lista de participantes de cada canal de voz se actualiza sin recargar (CA 2).
- **Historia 15 y siguientes (mensajes):** los mensajes se entregan en tiempo real. El enunciado recomienda WebSockets, con reconexión, y pide pub/sub entre las instancias del servicio de mensajes.

Los condicionantes son:
- **KrakenD CE no proxea WebSocket.** Es una función de la edición Enterprise. El gateway solo sirve para HTTP.
- **El enunciado pide un punto único de entrada** que valide los tokens de sesión, y que cualquier excepción se justifique con la misma rigurosidad.
- **Ya hay un precedente:** el audio de voz no pasa por el gateway. El cliente pide por el gateway un token de LiveKit y se conecta directo a LiveKit ([ADR 0002](0002-voz-con-livekit.md)).
- **El navegador no puede mandar `Authorization` en un WebSocket.** La credencial tiene que viajar en la URL o en el primer mensaje.
- **Render (plan free):** los servicios se duermen sin tráfico y cortan las conexiones inactivas.

## Decisión

### Cada servicio mantiene sus propios WebSocket

El servicio dueño del dato también es dueño de la conexión en vivo: voz para la presencia en los canales de voz y mensajes para los mensajes. Los dos usan **el mismo contrato** ([`tiempo-real.md`](../tiempo-real.md)), así que el cliente tiene un solo componente de conexión que reutiliza con cada servicio.

Cada servicio reparte los cambios entre sus instancias con Redis Pub/Sub, sobre el mismo Redis del bus de eventos ([ADR 0001](0001-bus-de-eventos-redis-streams.md)).

### Ticket por el gateway, WebSocket directo al servicio

1. El cliente pide un ticket **por el gateway**, con su JWT. Por ejemplo, `POST /api/v1/voice/realtime/ticket`. KrakenD valida el JWT como en cualquier ruta protegida y propaga `X-User-Id`.
2. El servicio responde `{url, ticket, expires_in}`. El ticket es opaco, de un solo uso y vive 30 s. Lo guarda en Redis asociado al `user_id`.
3. El cliente abre `wss://<url>?ticket=<ticket>` **directo contra el servicio**. El servicio canjea el ticket (lo borra al leerlo) y la conexión queda asociada a ese usuario.

Así el JWT se sigue validando en un solo lugar (el gateway), y sin pasar por él no se puede abrir ningún WebSocket. El ticket en la URL no es un problema aunque quede en un log: sirve una sola vez y expira en 30 s.

### El servicio autoriza cada suscripción

Que el ticket sea válido solo dice **quién** es el usuario. Cada vez que el cliente se suscribe a un recurso (un canal de voz, un canal de texto), el servicio comprueba el acceso con la misma regla que usa en HTTP.

## Alternativas descartadas

- **Único origen con `/api` para HTTP y `/ws` para WebSocket:** Caddy o nginx delante de KrakenD, en el mismo contenedor del gateway. Cumple el punto único de entrada al pie de la letra, pero hay que correr dos procesos en el contenedor de Render, suma un salto en cada request y el JWT igual tendría que validarse en otro lugar (el proxy no lo hace). **Queda abierto para más adelante:** como la URL del WebSocket viaja en la respuesta del ticket, pasar a esta opción no cambia el cliente.
- **Un servicio de tiempo real compartido:** una sola conexión por cliente, con voz y mensajes publicando en Redis. Suma un repo y un deploy, y ese servicio tendría que saber qué puede ver cada usuario de cada dominio. Además, el enunciado espera que las instancias de mensajes se comuniquen entre sí, lo que supone que los sockets viven en mensajes.
- **Validar el JWT en cada servicio:** cada uno tendría que bajar el JWKS y repetir la validación de KrakenD (issuer, algoritmo, expiración). Es justo lo que el gateway evita.
- **El JWT en la URL del WebSocket:** un access token de varios minutos podría quedar en logs de proxies o de Render, y servir para cualquier ruta.
- **Polling:** cumple "sin recargar" en voz, pero no la entrega en tiempo real de mensajes que pide el enunciado. Queda solo como respaldo del cliente si el WebSocket no conecta.
- **Server-Sent Events:** solo van del servidor al cliente, y el cliente igual necesita suscribirse y desuscribirse. Tampoco tienen buen soporte en React Native.

## Consecuencias

- **Excepción documentada al punto único de entrada:** los WebSocket no pasan por KrakenD. El gateway sigue controlando quién puede abrir uno, porque los tickets solo se obtienen a través de él.
- **Rate limiting:** el gateway limita los pedidos de ticket. Cada servicio limita además las conexiones por usuario y las suscripciones por conexión.
- **CORS no aplica a WebSocket:** cada servicio valida el header `Origin` contra la misma lista de orígenes que el gateway, para evitar *cross-site WebSocket hijacking*.
- **Revocación:** el permiso se comprueba al suscribirse. Si se pierde después (baneo, suspensión), el servicio tiene que cerrar el socket al recibir el evento correspondiente. Hasta entonces, el usuario sigue recibiendo actualizaciones de lo que ya estaba viendo. Para la pérdida de acceso a **un** servidor (baneo), el socket no se cierra: ver [ADR 0007](0007-revocacion-de-acceso-por-servidor.md).
- **Render:** el servicio manda un ping cada 25 s para que Render no corte la conexión por inactividad. Un socket abierto también mantiene despierto al servicio.
- **Cada servicio publica su propia URL de WebSocket** (por ejemplo, `REALTIME_PUBLIC_URL` en voz). Si se pasa a un único origen, solo cambia esa variable.
