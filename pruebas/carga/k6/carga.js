// Carga: uso realista sostenido. Sube a VUS usuarios en 2 minutos, los mantiene MESETA y baja.
// Cada usuario hace sesiones de chat de 60 s (ver lib/sesion.js) y manda un mensaje cada ~5 s.
// Con 100 usuarios en 5 canales: ~20 mensajes/s entrantes y ~400 entregas/s por WebSocket
// (cada mensaje le llega a los ~20 suscriptos de su canal).
//
// Correr desde pruebas/carga/:
//   k6 run --summary-export salidas/carga-resumen.json k6/carga.js
//   k6 run -e VUS=150 -e MESETA=10m k6/carga.js
import { prepararDatos, sesionChat } from "./lib/sesion.js";

const seed = JSON.parse(open("../salidas/seed.json"));
const VUS = Number(__ENV.VUS || 100);
const MESETA = __ENV.MESETA || "5m";

export const options = {
  setupTimeout: "5m",
  scenarios: {
    carga: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: VUS },
        { duration: MESETA, target: VUS },
        { duration: "1m", target: 0 },
      ],
      // Una sesión dura ~64 s: se la deja terminar al bajar en vez de cortarla.
      gracefulRampDown: "70s",
    },
  },
  // Umbrales filtrados por escenario: así no cuentan los logins de setup() (bcrypt), que se
  // miden aparte en login.js.
  thresholds: {
    "http_req_duration{scenario:carga}": ["p(95)<500"],
    "http_req_duration{scenario:carga,name:POST /channels/{id}/messages}": ["p(95)<500"],
    "http_req_duration{scenario:carga,name:GET /channels/{id}/messages}": ["p(95)<500"],
    "http_req_failed{scenario:carga}": ["rate<0.01"],
    entrega_ms: ["p(95)<1000"],
    entrega_propia_ok: ["rate>0.99"],
    ws_errores: ["count==0"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  return prepararDatos(seed, VUS);
}

export default function (data) {
  sesionChat(data, { sesionMs: 60000, intervaloMs: 5000, paginarCada: 4 });
}
