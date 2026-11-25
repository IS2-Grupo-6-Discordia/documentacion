# Pruebas de carga y estrés (k6)

Scripts de k6 para los tests: login, historial, envío de mensajes y entrega en tiempo real por
WebSocket, con dos instancias de mensajes para probar el fan-out entre instancias por Redis
Pub/Sub. El informe con los resultados está en [`informe.md`](informe.md).

## Por qué en local y no contra el deploy

- **Render free:** los servicios hibernan y la plataforma limita las ráfagas, así que lo que se
  mediría serían esos límites y no nuestro sistema.
- **Cuotas:** se consumirían las cuotas gratuitas de Atlas, Upstash y Grafana Cloud.
- **Reproducibilidad:** en local la prueba se puede repetir y explicar.

## Requisitos

- Docker con Compose v2.
- k6 v1 o posterior (probado con v2.3.0). Si está instalado por snap, los scripts tienen que estar
  dentro del home del usuario.
- Los repos `gateway`, `microservicio-autenticacion`, `microservicio-servidores` y
  `microservicio-mensajes` en la versión a probar, todos dentro de una misma carpeta (`REPOS_DIR`).

## 1. Levantar el entorno

```bash
cd pruebas/carga/entorno
export REPOS_DIR=/ruta/a/la/carpeta/con/los/repos
./generar-env.sh                              # crea entorno/env/*.env (ignorados por git)
docker compose up -d --build
curl localhost:18083/readyz localhost:18093/readyz
```

El entorno es independiente del de desarrollo. Usa su propio proyecto (`discordia-carga`) y su
propia red, y las bases no publican puertos, así que puede correr al mismo tiempo que otro stack
local. Respecto del compose de desarrollo de cada servicio, cambia esto:

| Qué | Por qué |
|---|---|
| Sin `--reload` ni código montado como volumen | Se corre la imagen como en el deploy |
| Dos instancias de mensajes (`18083` y `18093`), con el mismo alias interno `mensajes` | Probar la entrega entre instancias |
| Rate limits del gateway en 100000 | Todo el tráfico de k6 sale de una sola IP |
| `JWT_EXPIRE_MINUTES=120` | Que ningún token venza en medio de una corrida |
| R2 y Brevo con valores de relleno | La prueba no sube archivos ni manda mails |

Para medir servidores con varios procesos de uvicorn, como en el informe, hay que recrearlo:
`SERVIDORES_WORKERS=4 docker compose up -d servidores`. Por defecto usa 1 proceso, como el
Dockerfile.

Para bajarlo y borrar los datos: `docker compose down -v`.

## 2. Cargar datos

Desde `pruebas/carga/`:

```bash
k6 run seed.js
```

El seed crea, todo por la API:

- 200 usuarios;
- un servidor con 5 canales de texto;
- todos los usuarios como miembros, unidos por invitación;
- 1000 mensajes por canal.

Tarda unos 2 minutos. Los parámetros se cambian con `-e USUARIOS=...`, `-e CANALES=...` y
`-e MENSAJES_POR_CANAL=...`. Deja en `salidas/seed.json` los ids y los emails que usan los
escenarios; los tokens se piden en cada corrida.

## 3. Escenarios

Todos se corren desde `pruebas/carga/`.

| Script | Qué hace | Duración |
|---|---|---|
| `k6/smoke.js` | Dos usuarios en el mismo canal, cada uno conectado a una instancia distinta, durante unos 15 s. Valida el flujo completo y la entrega cruzada. Debe pasar antes de cargar. | ~20 s |
| `k6/carga.js` | Uso realista: sube a 100 usuarios (`-e VUS=...`), los mantiene 5 minutos (`-e MESETA=...`) y baja. Cada usuario manda un mensaje cada ~5 s. | ~9 min |
| `k6/estres.js` | Escalones de 2 minutos con 50, 100, 200, 300 y 400 usuarios (`-e ESCALONES=...`), con un mensaje cada ~3 s. Busca el punto de quiebre y se corta solo si los errores superan el 50%. | ~14 min |
| `k6/login.js` | Tasa de logins creciente: 5, 10, 20, 30 y 40 por segundo (`-e TASAS=...`). Mide el costo de bcrypt en autenticación. | ~5 min |

Para guardar el resumen y la serie temporal, y muestrear la CPU de cada contenedor en paralelo:

```bash
entorno/stats.sh salidas/estres-stats.csv &        # cortar con kill %1 al terminar
k6 run --summary-export salidas/estres-resumen.json --out csv=salidas/estres.csv.gz k6/estres.js
kill %1
python3 analizar.py salidas/estres.csv.gz --stats salidas/estres-stats.csv --ventana 30
```

`analizar.py` arma una tabla por ventana de tiempo con usuarios virtuales, requests por segundo,
tasa de error, p95 por endpoint, p95 de entrega y CPU de cada contenedor. Con eso se ve en qué
escalón se rompe el sistema y qué servicio se satura.

La CPU de `stats.sh` se mide en porcentaje de un núcleo: 100% es un núcleo entero. Un servicio de
Python con un solo proceso de uvicorn no puede pasar de ~100%.

En cada sesión de chat, el usuario:

1. abre el canal y pide la primera página del historial;
2. pide un ticket y abre el WebSocket. Los VUs se reparten entre las instancias;
3. se suscribe al canal;
4. manda un mensaje cada pocos segundos y, cada tanto, pagina el historial hacia atrás;
5. cierra el socket.

### Métricas propias

| Métrica | Qué mide |
|---|---|
| `entrega_ms` | Desde el POST del emisor hasta que cada receptor recibe `messages.created` por el socket. El emisor escribe su `Date.now()` en el contenido, y como todo corre en la misma máquina, el reloj es el mismo. |
| `entrega_propia_ok` | Proporción de mensajes propios que volvieron por el socket. Si falta alguno, se perdió en el camino. |
| `ws_conexion_ms` | Tiempo de apertura del WebSocket. |
| `ws_errores`, `ws_frames_error` | Errores del socket y frames de error del servidor. |
| `mensajes_enviados`, `mensajes_recibidos` | Conteos de mensajes enviados y recibidos. |
