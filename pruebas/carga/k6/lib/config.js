// Configuración común de los scripts. Todo se puede pisar con variables de entorno de k6
// (k6 run -e GATEWAY_URL=... script.js).

// Gateway del entorno de carga (entorno/docker-compose.yml publica el 8080 interno en 18080).
export const GATEWAY_URL = __ENV.GATEWAY_URL || "http://localhost:18080";
export const API = `${GATEWAY_URL}/api/v1`;

// KrakenD CE no hace proxy de WebSocket: el cliente abre el socket directo contra una instancia
// de mensajes. El ticket devuelve la URL de la instancia que lo emitió, pero como el ticket vive en
// el Redis compartido cualquier instancia lo canjea. Repartimos los VUs entre estas URLs para que
// la entrega tenga que cruzar de instancia por Redis Pub/Sub.
export const WS_URLS = (__ENV.WS_URLS || "ws://localhost:18083/ws,ws://localhost:18093/ws")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

// Contraseña de todos los usuarios sintéticos (cumple la política: mayúscula, minúscula, número).
export const PASSWORD = __ENV.PASSWORD || "Carga1234";

// Dominio de los mails sintéticos. No sirve uno reservado (.test, example.com): el validador de
// email del servicio los rechaza.
export const EMAIL_DOMAIN = __ENV.EMAIL_DOMAIN || "carga-discordia.com";

// Archivo que genera seed.js y leen los escenarios. Relativo a la carpeta desde la que se corre k6
// para la escritura (handleSummary) y relativo a este archivo para la lectura (open), por eso los
// scripts se corren siempre desde pruebas/carga/.
export const SEED_FILE = "salidas/seed.json";

export function emailDe(i) {
  return `carga-${String(i).padStart(4, "0")}@${EMAIL_DOMAIN}`;
}
