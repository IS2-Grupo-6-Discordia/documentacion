// Smoke: 2 usuarios, una sesión corta cada uno, uno conectado a cada instancia de mensajes.
// No mide rendimiento: valida que el flujo completo (login, historial, ticket, WebSocket,
// suscripción, POST y entrega en tiempo real entre instancias) funcione antes de cargar.
//
// Correr desde pruebas/carga/:  k6 run k6/smoke.js
import { prepararDatos, sesionChat } from "./lib/sesion.js";

const seed = JSON.parse(open("../salidas/seed.json"));

export const options = {
  scenarios: {
    smoke: { executor: "per-vu-iterations", vus: 2, iterations: 1, maxDuration: "1m" },
  },
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate==0"],
    entrega_propia_ok: ["rate==1"],
    ws_errores: ["count==0"],
    ws_frames_error: ["count==0"],
  },
};

export function setup() {
  // Los dos VUs en el mismo canal, para que cada uno reciba también lo que manda el otro.
  const datos = prepararDatos(seed, 2);
  datos.channel_ids = [seed.channel_ids[0]];
  return datos;
}

export default function (data) {
  sesionChat(data, { sesionMs: 15000, intervaloMs: 2000, paginarCada: 3 });
}
