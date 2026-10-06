# ADR 0002: Voz con LiveKit (local en desarrollo, LiveKit Cloud desplegado)

- **Fecha:** 2026-10-06

## Contexto

Se pide audio en tiempo real, el enunciado deja la tecnología a elección del grupo.

Restricciones:
- **Clientes:** la app es Expo / React Native (mobile) y web. El SDK elegido tiene que funcionar en los dos.
- **Backend:** el microservicio de voz se escribe en Go. Hace falta un SDK de servidor para emitir tokens y administrar salas (listar participantes, sacar a alguien).
- **Deploy:** los servicios corren en Render (plan gratuito), que **no acepta UDP** y duerme los servicios sin tráfico. Un media server propio no puede vivir ahí.
- **Presupuesto cero:** hace falta un plan gratuito que alcance para desarrollo y la demo.
- **Moderación:** banear y suspender tienen que desconectar al usuario de voz. 

## Decisión

Usamos **LiveKit** como SFU:

- **Plano de control** en el microservicio de voz (Go), con el SDK oficial `github.com/livekit/server-sdk-go/v2`: valida el acceso, emite tokens de vida corta, lista participantes y saca usuarios (`RemoveParticipant`).
- **Plano de media** en LiveKit: el cliente se conecta por WebRTC directo a LiveKit con el token. El audio **nunca** pasa por el microservicio de voz ni por el gateway.
- **Clientes:** `@livekit/react-native` + `@livekit/react-native-webrtc` + el plugin de Expo en mobile (requiere *development build*: LiveKit no funciona en Expo Go) y `livekit-client` en web.

**Entornos (híbrido):**

| Entorno | LiveKit | Por qué |
|---|---|---|
| Desarrollo y CI | `livekit/livekit-server --dev` en Docker, en el compose de voz | Sin cuenta, sin gastar minutos, reproducible en CI |
| Desplegado | **LiveKit Cloud, plan Build** (gratis, sin tarjeta) | Render no acepta UDP; LiveKit Cloud pone el media server y TURN |

El plan Build incluye 5.000 minutos de WebRTC por mes (repartido entre **todos** los participantes: 6 personas conectadas por 10 minutos gastan 60 minutos del plan), 100 conexiones concurrentes y 50 GB de transferencia. [Pricing](livekit.com/pricing).

## Alternativas descartadas

- **SFU propio:** control total, pero hay que escribir la señalización, operar TURN/STUN y exponer puertos UDP, que Render gratis no permite. No justifica asumir el riesgo de no llegar con los tiempos o que no funcione.
- **Daily.co:** WebRTC gestionado con 10.000 minutos gratis por mes. No tiene una versión que se pueda correr en local: desarrollo y CI dependerían de la cuenta y gastarían minutos, y los tests de integración necesitarían red y credenciales.
- **Agora:** 10.000 minutos combinados gratis por mes, pero tiene el mismo problema que Daily.co: sin servidor que se pueda correr en local para desarrollo y CI.
- **WebRTC peer-to-peer:** sin servidor de media, pero cada participante manda su audio a todos los demás. No escala más allá de pocos participantes y igual necesita señalización y TURN propios.

## Consecuencias

- **Sin código de señalización WebRTC propio:** el riesgo técnico se concentra en integrar SDKs, no en el transporte.
- **Mobile necesita development build:** el cliente deja de poder probarse con Expo Go para voz.
- **Dos URLs de LiveKit:** el servicio usa una para hablar con LiveKit (`LIVEKIT_API_URL`, por ejemplo `http://livekit:7880` dentro de Docker) y le devuelve otra al cliente (`LIVEKIT_PUBLIC_URL`). Desde un celular en local hay que usar la IP de la LAN.
- **Cuota de minutos:** 5 personas conectadas 1 hora gastan 300 de los 5.000 minutos. El cliente tiene que desconectarse al cerrar la app o la pestaña.
- **El token no revoca sesiones:** LiveKit valida el token solo al conectar. Para sacar a alguien hay que llamar a `RemoveParticipant`; por eso esas reacciones van por eventos ([ADR 0001](0001-bus-de-eventos-redis-streams.md)).
- **Historias optativas:** quedan abiertas para implementacion, las fuentes que puede publicar el token son configurables: micrófono por defecto, pero pantalla y cámara se pueden configurar. El indicador de quién habla y el mute local los da el SDK del cliente, y las salas se nombran `ch:<channel_id>`.
- **Dependencia de un proveedor:** si LiveKit Cloud cambia su plan gratuito, la salida es otro proveedor o LiveKit propio en un host con UDP. El código no cambia, porque LiveKit es open source y la API es la misma.
