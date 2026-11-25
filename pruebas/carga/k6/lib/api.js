// Llamadas a la API pública (siempre a través del gateway, como el cliente real).
import http from "k6/http";
import { check } from "k6";
import { API, PASSWORD } from "./config.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

export function authHeaders(token) {
  return { ...JSON_HEADERS, Authorization: `Bearer ${token}` };
}

// Cada request lleva un tag "name" estable (sin ids) para que el resumen de k6 agrupe por endpoint.
function params(token, name, extra = {}) {
  return { headers: token ? authHeaders(token) : JSON_HEADERS, tags: { name }, ...extra };
}

// 409 = el mail ya estaba registrado (corrida anterior del seed): no cuenta como error.
export function registrarRequest(email, nombre) {
  return [
    "POST",
    `${API}/auth/users`,
    JSON.stringify({ name: nombre, email, password: PASSWORD }),
    params(null, "POST /auth/users", { responseCallback: http.expectedStatuses(201, 409) }),
  ];
}

export function loginRequest(email) {
  return [
    "POST",
    `${API}/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    params(null, "POST /auth/login"),
  ];
}

export function login(email) {
  const [method, url, body, p] = loginRequest(email);
  const res = http.request(method, url, body, p);
  check(res, { "login 200": (r) => r.status === 200 });
  return res.status === 200 ? res.json("access_token") : null;
}

// Loguea a muchos usuarios en tandas paralelas (bcrypt es caro: de a uno tardaría minutos).
export function loginMasivo(emails, tanda = 20) {
  const tokens = [];
  for (let i = 0; i < emails.length; i += tanda) {
    const lote = emails.slice(i, i + tanda);
    const respuestas = http.batch(lote.map((e) => loginRequest(e)));
    respuestas.forEach((r, j) => {
      if (r.status !== 200) {
        throw new Error(`login de ${lote[j]} falló: ${r.status} ${r.body}`);
      }
      tokens.push(r.json("access_token"));
    });
  }
  return tokens;
}

export function crearServidor(token, nombre) {
  // Multipart: el endpoint acepta un ícono opcional, así que el nombre va como campo de formulario.
  return http.post(`${API}/servers`, { name: nombre }, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { name: "POST /servers" },
  });
}

export function crearCanal(token, serverId, nombre) {
  return http.post(
    `${API}/servers/${serverId}/channels`,
    JSON.stringify({ name: nombre, type: "text" }),
    params(token, "POST /servers/{id}/channels"),
  );
}

export function crearInvitacion(token, serverId) {
  return http.post(`${API}/servers/${serverId}/invites`, "{}", params(token, "POST /servers/{id}/invites"));
}

export function unirseRequest(token, code) {
  return ["POST", `${API}/invites/${code}/join`, "{}", params(token, "POST /invites/{code}/join")];
}

export function enviarMensajeRequest(token, serverId, channelId, content) {
  return [
    "POST",
    `${API}/channels/${channelId}/messages`,
    JSON.stringify({ server_id: serverId, content }),
    params(token, "POST /channels/{id}/messages"),
  ];
}

export function enviarMensaje(token, serverId, channelId, content) {
  const [method, url, body, p] = enviarMensajeRequest(token, serverId, channelId, content);
  return http.request(method, url, body, p);
}

export function historial(token, channelId, { limit = 50, before, beforeId } = {}) {
  let url = `${API}/channels/${channelId}/messages?limit=${limit}`;
  if (before) {
    url += `&before=${encodeURIComponent(before)}`;
    if (beforeId) url += `&before_id=${beforeId}`;
  }
  return http.get(url, params(token, "GET /channels/{id}/messages"));
}

export function pedirTicket(token) {
  return http.post(`${API}/messages/realtime/ticket`, null, params(token, "POST /messages/realtime/ticket"));
}
