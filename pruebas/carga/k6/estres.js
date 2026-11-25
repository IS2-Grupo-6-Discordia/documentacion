// Estrés: sube por escalones hasta romper, para encontrar el punto en que la latencia o los
// errores se disparan. Mismo comportamiento que carga.js pero con un mensaje cada ~3 s.
// Escalones de 2 minutos: 50, 100, 200, 300 y 400 usuarios.
//
// Con más VUs que usuarios en el seed, los tokens se reutilizan (un mismo usuario con varias
// sesiones abiertas, como quien tiene varias pestañas).
//
// Conviene guardar la serie temporal para ubicar el escalón donde se rompe:
//   k6 run --summary-export salidas/estres-resumen.json --out csv=salidas/estres.csv.gz k6/estres.js
import { prepararDatos, sesionChat } from "./lib/sesion.js";

const seed = JSON.parse(open("../salidas/seed.json"));
const ESCALONES = (__ENV.ESCALONES || "50,100,200,300,400").split(",").map(Number);
const DURACION_ESCALON = __ENV.DURACION_ESCALON || "2m";

const stages = [];
ESCALONES.forEach((target) => {
  stages.push({ duration: "30s", target });
  stages.push({ duration: DURACION_ESCALON, target });
});
stages.push({ duration: "30s", target: 0 });

export const options = {
  setupTimeout: "5m",
  scenarios: {
    estres: { executor: "ramping-vus", startVUs: 0, stages, gracefulRampDown: "40s" },
  },
  // Los umbrales no cortan la prueba (salvo un colapso total): sirven para marcar en el resumen
  // qué objetivo se dejó de cumplir.
  thresholds: {
    "http_req_duration{scenario:estres}": ["p(95)<500"],
    "http_req_failed{scenario:estres}": [
      "rate<0.01",
      { threshold: "rate<0.5", abortOnFail: true, delayAbortEval: "1m" },
    ],
    entrega_ms: ["p(95)<1000"],
    entrega_propia_ok: ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  return prepararDatos(seed, Math.max(...ESCALONES));
}

export default function (data) {
  sesionChat(data, { sesionMs: 45000, intervaloMs: 3000, paginarCada: 5 });
}
