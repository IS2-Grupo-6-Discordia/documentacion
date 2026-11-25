// Ráfaga de login: cuántos logins por segundo aguanta autenticación. bcrypt es caro a propósito
// (frena la fuerza bruta), así que el login es el endpoint más pesado en CPU del sistema.
// Tasa de llegada creciente (no VUs fijos): la carga no baja aunque el servicio se ponga lento,
// que es lo que pasa en una ráfaga real (por ejemplo, todos entrando a la vez después de un corte).
//
//   k6 run --summary-export salidas/login-resumen.json --out csv=salidas/login.csv.gz k6/login.js
import http from "k6/http";
import { check } from "k6";
import { loginRequest } from "./lib/api.js";

const seed = JSON.parse(open("../salidas/seed.json"));
const TASAS = (__ENV.TASAS || "5,10,20,30,40").split(",").map(Number);

const stages = [];
TASAS.forEach((target) => {
  stages.push({ duration: "15s", target });
  stages.push({ duration: "45s", target });
});

export const options = {
  scenarios: {
    login: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages,
    },
  },
  thresholds: {
    "http_req_duration{name:POST /auth/login}": ["p(95)<1000"],
    http_req_failed: ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export default function () {
  // Rota entre todos los usuarios del seed: ninguno se acerca al bloqueo por cuenta, que además
  // solo cuenta intentos fallidos.
  const email = seed.emails[(__ITER + __VU * 7) % seed.emails.length];
  const [method, url, body, params] = loginRequest(email);
  const res = http.request(method, url, body, params);
  check(res, { "login 200": (r) => r.status === 200 });
}
