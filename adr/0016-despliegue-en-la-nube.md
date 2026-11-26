# ADR 0016: Despliegue en la nube

- **Fecha:** 2026-11-25 (registra decisiones tomadas entre septiembre y noviembre de 2026)

## Contexto

El enunciado (sección *Despliegue en la Nube*) pide desplegar los servicios en una PaaS, un orquestador de contenedores gestionado o un cloud provider, y justificar la elección en un ADR. Además exige:

- **Un plan gratuito o de bajo costo vigente.** La cátedra compara proveedores en su [guía de Cloud Computing](https://ingenieria-del-software-2.github.io/blog/2026-09-07-cloud-computing/) (precios revisados al 7 de septiembre de 2026).
- **Un entorno de producción reproducible.**
- **Deploy automático desde el pipeline de CI/CD**, desde la rama principal o por tags.
- **Archivos multimedia en un servicio de objetos externo**, nunca en la base ni en el disco del servidor.
- **Un APK** para la app mobile.

Lo que hay que desplegar:

| Pieza | Qué es |
|---|---|
| gateway | KrakenD CE en Docker ([ADR 0014](0014-api-gateway-con-krakend.md)) |
| autenticación, servidores, mensajes | FastAPI en Docker, cada uno con su base ([ADR 0015](0015-lenguajes-y-bases-de-datos.md)) |
| voz | Go en Docker, sin base ([ADR 0004](0004-voz-sin-base-de-datos.md)) |
| Bases | Dos PostgreSQL y un MongoDB |
| Redis | Bus de eventos, Pub/Sub entre instancias, tickets y presencia ([ADR 0001](0001-bus-de-eventos-redis-streams.md)) |
| Media server de voz | WebRTC, que necesita UDP ([ADR 0002](0002-voz-con-livekit.md)) |
| cliente web y backoffice | Exports estáticos de Expo (SPA) |
| app Android | APK compilada con EAS |

Otros condicionantes:

- **Presupuesto cero:** nada que pida tarjeta para seguir andando después de una prueba, ni que cobre por request.
- **Equipo de varias personas sin experiencia operando infraestructura**, con entregas cada 3 o 4 semanas. Cada hora que se va en operar servidores no va a las historias.
- **Siete repos independientes**, cada uno con su CI en GitHub Actions.

## Decisión

Usamos **Render** para todo lo que es un contenedor, y un **proveedor gestionado con plan gratuito** para cada pieza con estado o que Render no puede correr. No hay infraestructura propia: ni VMs ni clusters.

### Dónde corre cada pieza

| Pieza | Proveedor y plan | Por qué |
|---|---|---|
| gateway y los 4 servicios | **Render**, servicio web Docker, plan free | Despliega el `Dockerfile` de cada repo tal cual, con TLS y dominio `onrender.com`. Se conecta a GitHub y puede esperar al CI antes de desplegar |
| PostgreSQL de autenticación y servidores | **Supabase**, plan free, un proyecto con un schema y un usuario por servicio ([ADR 0015](0015-lenguajes-y-bases-de-datos.md)) | Postgres gestionado y gratuito sin vencimiento. El de Render vence a los 30 días |
| MongoDB de mensajes | **MongoDB Atlas**, plan gratuito | El MongoDB gestionado de referencia, con plan gratuito permanente |
| Redis | **Upstash**, plan free, con eviction desactivado ([ADR 0001](0001-bus-de-eventos-redis-streams.md)) | Redis persistente con TLS. El Key Value gratuito de Render no persiste, y el bus no puede perder eventos |
| Voz (media server y TURN) | **LiveKit Cloud**, plan Build ([ADR 0002](0002-voz-con-livekit.md)) | Render no acepta UDP |
| Avatares e íconos de servidor | **Cloudflare R2** | Almacenamiento de objetos compatible con S3, sin costo de egreso |
| Email de recupero y verificación | **Brevo**, por su API HTTPS | Render bloquea el SMTP saliente, así que `smtplib` no sirve |
| Trazas y logs | **Grafana Cloud**, plan free ([ADR 0008](0008-trazabilidad-con-opentelemetry-y-grafana-cloud.md)) | No hay lugar en Render free para un backend de observabilidad propio |
| cliente web (producción) | **Vercel**, plan Hobby | Hosting estático con integración con GitHub |
| cliente web (`develop`) | **Cloudflare Pages** | Entorno de prueba de `develop`, separado de producción |
| backoffice | **Cloudflare Pages** | Hosting estático gratuito con integración con GitHub |
| APK de Android | **EAS Build** (Expo), plan gratuito, publicada como Release de GitHub | Compila en la nube, sin Android SDK en el CI |

### CD

| Pieza | Cuándo despliega | Qué lo frena |
|---|---|---|
| gateway y los 4 servicios | Cada merge a `main` | Render tiene el Auto-Deploy en *After CI Checks Pass*: espera a que pasen los checks de GitHub del commit y no despliega si alguno falla |
| Migraciones de autenticación y servidores | En cada deploy, antes de levantar uvicorn (`alembic upgrade head` en el `Dockerfile`) | Si la migración falla, el contenedor no arranca y Render mantiene la versión anterior |
| cliente web | Cada merge a `main` (Vercel) y cada push a `develop` (Cloudflare Pages) | El build de la plataforma. Si Cloudflare Pages no toma un push, el workflow `cloudflare-deploy-respaldo.yml` dispara su deploy hook |
| backoffice | Cada merge a `main` (Cloudflare Pages), con el mismo respaldo | El build de la plataforma |
| APK | Cada merge a `main` que no sea solo de documentación (`apk-release.yml`) | El build de EAS |

### Configuración y secretos

- **No hay `render.yaml`:** cada servicio se configura desde el panel de Render. La configuración de cada uno (runtime, rama, health check, Auto-Deploy, puerto y variables) está documentada en la sección *Deploy (Render) y CD* del README de su repo, que es la referencia para recrear el entorno.
- **Los secretos viven en el panel de cada proveedor** y nunca en un repo: las URLs de las bases y de Redis, las claves de R2, LiveKit, Brevo y Grafana, los secretos internos entre servicios y la clave de firma de los JWT. Cada repo documenta los suyos en su `.env.example`.
- **Las URLs de los frontends se fijan al compilar** (`EXPO_PUBLIC_API_URL`), en la variable de la plataforma o en el perfil de `eas.json` para la APK.

## Alternativas descartadas

Las condiciones de los planes son las de la guía de la cátedra (7 de septiembre de 2026).

- **Kubernetes gestionado (GKE, EKS, AKS):** el enunciado lo plantea como alternativa avanzada. El free tier de GKE solo cubre el fee de gestión de un cluster, no los nodos ni la red, y en AKS y EKS también se pagan los nodos. Además, operar un cluster (manifiestos, ingress, certificados, secretos) le quita tiempo a las historias sin aportar nada que Render no dé. La misma guía aconseja no subir a Kubernetes "porque sí".
- **Un cloud provider con créditos (GCP, AWS, Azure):** GCP da USD 300 por 90 días, AWS un Free Plan de hasta 6 meses que al vencer cierra la cuenta, y Azure USD 200 por 30 días (o USD 100 por 12 meses con Azure for Students). Todos dependen de créditos que se terminan, la mayoría pide una cuenta de facturación, y armar redes, balanceadores y certificados a mano es más trabajo que en una PaaS.
- **Una VM propia con Docker Compose (e2-micro de GCP o B1s de Azure):** permitiría correr todo junto, incluido un LiveKit propio con UDP. Pero una e2-micro no alcanza para siete contenedores y tres bases, y quedan a cargo del equipo el sistema operativo, los parches, los backups y el TLS.
- **Railway:** después de la prueba de 30 días queda en USD 1 de crédito por mes, que no alcanza para cinco servicios. Sus bases son templates sin gestión.
- **Fly.io:** la prueba gratuita dura 7 días o 2 horas de VM, y después se paga por uso. Tiene autostop y regiones, pero no un plan gratuito permanente.
- **PostgreSQL de Render:** vence a los 30 días, con 14 de gracia, y no tiene backups. Habría que recrear la base todos los meses.
- **Key Value de Render en lugar de Upstash:** 25 MB, sin persistencia. Un reinicio borraría los streams con eventos sin consumir.
- **MongoDB y Redis en contenedores de Render:** el plan free no tiene disco persistente, así que cada deploy o reinicio borraría los datos.
- **Un SFU propio para la voz:** necesita UDP y TURN, que Render no da. Ver el [ADR 0002](0002-voz-con-livekit.md).
- **SMTP directo para el email:** Render bloquea el puerto saliente.
- **Imágenes en la base o en el disco del servicio:** el enunciado lo prohíbe, y el disco de Render free se pierde en cada deploy.

## Consecuencias

- **Costo cero**, a cambio de los límites de cada plan gratuito.
- **Cold starts:** Render duerme los servicios tras 15 minutos sin tráfico y tardan de 30 a 60 s en despertar. Eso explica decisiones de otros ADRs: el override de timeout del gateway ([ADR 0014](0014-api-gateway-con-krakend.md)), los reintentos y el circuit breaker hacia servidores ([ADR 0005](0005-voz-resiliencia-ante-servidores.md)), el bus que retiene eventos para un consumidor dormido ([ADR 0001](0001-bus-de-eventos-redis-streams.md)) y los health checks que no despiertan a otros servicios ([ADR 0010](0010-health-checks-livez-y-readyz.md)).
- **512 MB y una fracción de CPU por servicio:** KrakenD usa unos 430 MB ([ADR 0008](0008-trazabilidad-con-opentelemetry-y-grafana-cloud.md)), y las [pruebas de carga](../pruebas/carga/informe.md) muestran que servidores con 4 workers usa unos 410 MB. Escalar con más procesos no entra en el plan free: hay que optimizar el código o pagar un plan mayor.
- **Una sola instancia por servicio:** las migraciones corren al arrancar, lo que solo es seguro con una instancia. Para escalar horizontalmente hay que moverlas a un paso previo al deploy.
- **Reproducibilidad por documentación, no por código:** sin `render.yaml`, recrear producción es seguir los READMEs y cargar los secretos a mano en cada panel. Un error en el panel no se ve en ningún PR. Un Blueprint de Render lo resolvería para la parte de Render.
- **Once proveedores con su panel, sus secretos y sus avisos:** Render, Supabase, Atlas, Upstash, LiveKit Cloud, Cloudflare (R2 y Pages), Vercel, Brevo, Grafana Cloud, Expo y GitHub. Rotar un secreto compartido, como `REDIS_URL`, implica tocar varios servicios.
- **Planes que se pausan o archivan por inactividad:** Supabase pausa los proyectos sin uso y Upstash archiva las bases tras 30 días sin actividad. Si el proyecto queda parado, hay que reactivarlos antes de una demo o de la corrección.
- **Sin backups en los planes gratuitos de Supabase.** Perder la base de autenticación o de servidores es perder los datos.
- **Latencia entre proveedores:** cada request a una base o a Redis sale de Render hacia otro proveedor. Hay que mantener las regiones cerca (Upstash, por ejemplo, no permite cambiar la región primaria).
- **Salida sin reescribir código:** todo se configura por variables de entorno y cada servicio es un `Dockerfile` estándar. Cambiar de PaaS o de proveedor de base es cambiar URLs y secretos, no código.
