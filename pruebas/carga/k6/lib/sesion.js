// Una sesión de chat realista de un usuario, compartida por los escenarios smoke/carga/estrés:
//
//   1. abre el canal: pide la primera página del historial;
//   2. pide un ticket y abre el WebSocket contra una instancia de mensajes (alternando entre las
//      de WS_URLS) y se suscribe a su canal;
//   3. durante SESION_MS manda un mensaje cada ~INTERVALO_MS y cada tanto pagina hacia atrás en
//      el historial (como quien scrollea);
//   4. cierra el socket. La iteración siguiente es una sesión nueva (ticket nuevo).
//
// Métrica clave: entrega_ms, la latencia de punta a punta de un mensaje (desde que el emisor
// hace el POST hasta que cada receptor recibe el messages.created por el socket). El emisor
// escribe su Date.now() en el contenido; como todos los VUs corren en la misma máquina, el reloj
// es el mismo y la resta es válida.
import http from "k6/http";
import { check } from "k6";
import { WebSocket } from "k6/websockets";
import { Counter, Rate, Trend } from "k6/metrics";
import { setInterval, setTimeout, clearInterval } from "k6/timers";
import { API, WS_URLS, PASSWORD } from "./config.js";
import { authHeaders, historial, loginMasivo, pedirTicket } from "./api.js";

export const entregaMs = new Trend("entrega_ms", true);
export const entregaPropiaOk = new Rate("entrega_propia_ok");
export const wsConexionMs = new Trend("ws_conexion_ms", true);
export const wsErrores = new Counter("ws_errores");
export const wsFramesError = new Counter("ws_frames_error");
export const mensajesEnviados = new Counter("mensajes_enviados");
export const mensajesRecibidos = new Counter("mensajes_recibidos");

const PREFIJO = "carga|";
// Margen para dar por perdido un mensaje propio que nunca volvió por el socket.
const ESPERA_FINAL_MS = 3000;
// El subscribe no tiene ack: se espera un poco antes de empezar a mandar para no contar como
// "perdido" un mensaje que salió antes de que la suscripción quedara registrada.
const ESPERA_SUSCRIPCION_MS = 1000;

// Para setup(): loguea a los usuarios que va a usar la prueba (de a tandas, por el costo de
// bcrypt) y devuelve lo que necesitan los VUs. Los tokens duran JWT_EXPIRE_MINUTES (120 en el
// entorno de carga), más que cualquier escenario.
export function prepararDatos(seed, cantidad) {
  const n = Math.min(cantidad, seed.emails.length);
  if (n < cantidad) {
    console.warn(`hay ${seed.emails.length} usuarios en el seed y se pidieron ${cantidad}: se reutilizan`);
  }
  return {
    server_id: seed.server_id,
    channel_ids: seed.channel_ids,
    tokens: loginMasivo(seed.emails.slice(0, n)),
  };
}

function jitter(ms) {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

export function sesionChat(data, { sesionMs, intervaloMs, paginarCada = 5 }) {
  const idx = __VU - 1;
  const token = data.tokens[idx % data.tokens.length];
  const channelId = data.channel_ids[idx % data.channel_ids.length];
  const wsBase = WS_URLS[idx % WS_URLS.length];
  const instancia = `mensajes-${(idx % WS_URLS.length) + 1}`;
  const yo = `${__VU}-${__ITER}`;

  // 1. Abrir el canal: primera página del historial.
  const primera = historial(token, channelId);
  check(primera, { "historial 200": (r) => r.status === 200 });
  let cursor = ultimoCursor(primera);

  // 2. Ticket + WebSocket.
  const t = pedirTicket(token);
  if (!check(t, { "ticket 200": (r) => r.status === 200 })) {
    return;
  }
  const url = `${wsBase}?ticket=${encodeURIComponent(t.json("ticket"))}`;
  const pendientes = new Map(); // seq -> enviado (ms)
  let seq = 0;
  let envio = null;
  const inicio = Date.now();
  const ws = new WebSocket(url);

  ws.onopen = () => {
    wsConexionMs.add(Date.now() - inicio, { instancia });
    ws.send(JSON.stringify({ type: "subscribe", channel_ids: [channelId] }));

    setTimeout(() => {
      envio = setInterval(() => {
        seq += 1;
        const ahora = Date.now();
        pendientes.set(String(seq), ahora);
        mensajesEnviados.add(1);
        // asyncRequest: un POST bloqueante frenaría el event loop del VU y los frames que le
        // llegan mientras tanto se medirían tarde.
        http
          .asyncRequest(
            "POST",
            `${API}/channels/${channelId}/messages`,
            JSON.stringify({ server_id: data.server_id, content: `${PREFIJO}${yo}|${seq}|${ahora}` }),
            { headers: authHeaders(token), tags: { name: "POST /channels/{id}/messages" } },
          )
          .then((r) => check(r, { "mensaje 201": (x) => x.status === 201 }));

        if (paginarCada > 0 && seq % paginarCada === 0 && cursor) {
          const q = `before=${encodeURIComponent(cursor.before)}&before_id=${cursor.beforeId}`;
          http
            .asyncRequest("GET", `${API}/channels/${channelId}/messages?limit=50&${q}`, null, {
              headers: authHeaders(token),
              tags: { name: "GET /channels/{id}/messages (paginado)" },
            })
            .then((r) => {
              check(r, { "historial paginado 200": (x) => x.status === 200 });
              cursor = ultimoCursor(r) || cursor;
            });
        }
      }, jitter(intervaloMs));
    }, ESPERA_SUSCRIPCION_MS);

    setTimeout(() => {
      if (envio) clearInterval(envio);
      setTimeout(() => {
        pendientes.forEach(() => entregaPropiaOk.add(false, { instancia }));
        pendientes.clear();
        ws.close();
      }, ESPERA_FINAL_MS);
    }, sesionMs);
  };

  ws.onmessage = (e) => {
    const ahora = Date.now();
    let frame;
    try {
      frame = JSON.parse(e.data);
    } catch (_) {
      return;
    }
    if (frame.type === "error") {
      wsFramesError.add(1, { code: String(frame.code) });
      return;
    }
    if (frame.type !== "messages.created" || !frame.message) return;
    const content = frame.message.content || "";
    if (!content.startsWith(PREFIJO)) return;

    const [autor, s, enviado] = content.slice(PREFIJO.length).split("|");
    mensajesRecibidos.add(1);
    entregaMs.add(ahora - Number(enviado), { instancia });
    if (autor === yo && pendientes.has(s)) {
      pendientes.delete(s);
      entregaPropiaOk.add(true, { instancia });
    }
  };

  ws.onerror = (e) => {
    wsErrores.add(1, { instancia });
    console.warn(`ws ${instancia} VU ${__VU}: ${e.error}`);
  };
}

// Cursor compuesto (before + before_id) para pedir la página anterior a la más vieja recibida.
function ultimoCursor(res) {
  if (res.status !== 200) return null;
  const items = res.json();
  if (!Array.isArray(items) || items.length === 0) return null;
  // La API devuelve el lote en orden cronológico o inverso según la versión: tomamos el más viejo.
  const masViejo = items.reduce((a, b) => (a.created_at <= b.created_at ? a : b));
  return { before: masViejo.created_at, beforeId: masViejo.id };
}
