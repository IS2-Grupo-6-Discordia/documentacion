// Carga los datos iniciales de la prueba, todo por la API pública (sin tocar las bases):
//   - USUARIOS usuarios sintéticos (el registro no pide verificar el mail en el entorno de carga);
//   - un servidor del primer usuario, con CANALES canales de texto;
//   - todos los usuarios miembros por invitación;
//   - MENSAJES_POR_CANAL mensajes por canal, para que el historial tenga volumen real.
//
// Deja en salidas/seed.json lo que necesitan los escenarios (ids y emails, nunca tokens).
// Correr desde pruebas/carga/:
//   k6 run seed.js
//   k6 run -e USUARIOS=300 -e MENSAJES_POR_CANAL=2000 seed.js
import http from "k6/http";
import { check, fail } from "k6";
import { SEED_FILE, emailDe } from "./k6/lib/config.js";
import {
  crearCanal,
  crearInvitacion,
  crearServidor,
  enviarMensajeRequest,
  loginMasivo,
  registrarRequest,
  unirseRequest,
} from "./k6/lib/api.js";

const USUARIOS = Number(__ENV.USUARIOS || 200);
const CANALES = Number(__ENV.CANALES || 5);
const MENSAJES_POR_CANAL = Number(__ENV.MENSAJES_POR_CANAL || 1000);
const TANDA = Number(__ENV.TANDA || 25);

export const options = {
  // Todo pasa en setup(); la iteración no hace nada.
  vus: 1,
  iterations: 1,
  setupTimeout: "20m",
  // El seed no mide nada: no tiene sentido fallar por latencia.
  summaryTrendStats: ["avg", "p(95)", "max"],
};

function enTandas(items, armarRequest, esperado, descripcion) {
  for (let i = 0; i < items.length; i += TANDA) {
    const lote = items.slice(i, i + TANDA);
    const respuestas = http.batch(lote.map(armarRequest));
    respuestas.forEach((r, j) => {
      if (!esperado.includes(r.status)) {
        fail(`${descripcion} #${i + j} falló: ${r.status} ${r.body}`);
      }
    });
  }
}

export function setup() {
  const emails = Array.from({ length: USUARIOS }, (_, i) => emailDe(i + 1));

  // 1. Registro (409 = ya existía de una corrida anterior; se reutiliza).
  enTandas(emails, (email, k) => registrarRequest(email, `Carga ${k + 1}`), [201, 409], "registro");
  console.log(`usuarios listos: ${USUARIOS}`);

  const tokens = loginMasivo(emails, TANDA);
  const owner = tokens[0];

  // 2. Servidor y canales.
  const srv = crearServidor(owner, `Carga ${new Date().toISOString().slice(0, 16)}`);
  check(srv, { "servidor 201": (r) => r.status === 201 }) || fail(`servidor: ${srv.status} ${srv.body}`);
  const serverId = srv.json("id");
  const channelIds = [];
  for (let c = 1; c <= CANALES; c++) {
    const r = crearCanal(owner, serverId, `carga-${c}`);
    check(r, { "canal 201": (x) => x.status === 201 }) || fail(`canal: ${r.status} ${r.body}`);
    channelIds.push(r.json("id"));
  }

  // 3. Membresía por invitación (sin límite de usos ni vencimiento).
  const inv = crearInvitacion(owner, serverId);
  check(inv, { "invitación 201": (r) => r.status === 201 }) || fail(`invitación: ${inv.status} ${inv.body}`);
  const code = inv.json("code");
  enTandas(tokens.slice(1), (t) => unirseRequest(t, code), [200, 201], "unión al servidor");
  console.log(`servidor ${serverId}: ${CANALES} canales, ${USUARIOS} miembros`);

  // 4. Historial: los mensajes se reparten entre los usuarios para que no sean todos del mismo autor.
  const envios = [];
  channelIds.forEach((ch) => {
    for (let m = 0; m < MENSAJES_POR_CANAL; m++) {
      envios.push({ ch, autor: tokens[(m * 7 + envios.length) % tokens.length], m });
    }
  });
  enTandas(
    envios,
    (e) => enviarMensajeRequest(e.autor, serverId, e.ch, `historial ${e.m}: mensaje de relleno para la prueba de carga`),
    [201],
    "mensaje de historial",
  );
  console.log(`historial cargado: ${envios.length} mensajes`);

  return {
    generado: new Date().toISOString(),
    server_id: serverId,
    channel_ids: channelIds,
    emails,
  };
}

export default function () {}

export function handleSummary(data) {
  if (!data.setup_data) {
    return { stdout: "seed: setup no devolvió datos, no se escribe salidas/seed.json\n" };
  }
  return {
    [SEED_FILE]: JSON.stringify(data.setup_data, null, 2),
    stdout: `seed listo -> ${SEED_FILE}\n`,
  };
}
