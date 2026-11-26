# Extras

Funcionalidades que implementamos aunque el [enunciado](enunciado.md) no las pide: no están en los criterios de aceptación de ninguna historia, obligatoria u optativa, ni en los requisitos no funcionales. No suman puntos; las hicimos porque mejoraban el producto o resolvían un problema que apareció usándolo.

Lo que el enunciado sí pide, aunque se parezca a un extra, no está acá. Por ejemplo, el banner del servidor (historia "Administrar configuración del servidor"), los servidores en común del perfil público, el rate limiting, la validación del formato de las imágenes o las pruebas de carga.

## Resumen

| Extra | Dónde | Referencia |
|---|---|---|
| [Mi cuenta](#mi-cuenta) | Cliente web y app, autenticación | [frontend#55](https://github.com/IS2-Grupo-6-Discordia/discordia-frontend/pull/55), [frontend#56](https://github.com/IS2-Grupo-6-Discordia/discordia-frontend/pull/56), [autenticacion#21](https://github.com/IS2-Grupo-6-Discordia/microservicio-autenticacion/pull/21), issue #145 |
| [Verificación del email con un código](#verificación-del-email-con-un-código) | Cliente web y app, autenticación | [frontend#54](https://github.com/IS2-Grupo-6-Discordia/discordia-frontend/pull/54), [frontend#69](https://github.com/IS2-Grupo-6-Discordia/discordia-frontend/pull/69), [frontend#70](https://github.com/IS2-Grupo-6-Discordia/discordia-frontend/pull/70) |
| [Vincular y desvincular Google](#vincular-y-desvincular-google) | Cliente web y app, autenticación | [frontend#63](https://github.com/IS2-Grupo-6-Discordia/discordia-frontend/pull/63) |
| [Aviso de servidor despertando](#aviso-de-servidor-despertando) | Cliente web y app, backoffice | [frontend#47](https://github.com/IS2-Grupo-6-Discordia/discordia-frontend/pull/47) |
| [Llamadas al estilo Meet](#llamadas-al-estilo-meet) | Cliente web y app | [frontend#43](https://github.com/IS2-Grupo-6-Discordia/discordia-frontend/pull/43), [frontend#48](https://github.com/IS2-Grupo-6-Discordia/discordia-frontend/pull/48) |
| [Reportar servidores](#reportar-servidores) | Cliente web y app, servidores, backoffice | [frontend#58](https://github.com/IS2-Grupo-6-Discordia/discordia-frontend/pull/58), [servidores#28](https://github.com/IS2-Grupo-6-Discordia/microservicio-servidores/pull/28) |
| [Separadores por día en el chat](#separadores-por-día-en-el-chat) | Cliente web y app | [frontend#112](https://github.com/IS2-Grupo-6-Discordia/discordia-frontend/pull/112) |
| [Miembros agrupados por rol](#miembros-agrupados-por-rol) | Cliente web y app | [frontend#112](https://github.com/IS2-Grupo-6-Discordia/discordia-frontend/pull/112) |
| [Observabilidad en el backoffice](#observabilidad-en-el-backoffice) | Backoffice, autenticación | [backoffice#25](https://github.com/IS2-Grupo-6-Discordia/discordia-backoffice/pull/25), [ADR 0013](adr/0013-observabilidad-en-el-backoffice.md) |
| [Segundo factor para el staff](#segundo-factor-para-el-staff) | Backoffice | [backoffice#13](https://github.com/IS2-Grupo-6-Discordia/discordia-backoffice/pull/13) |
| [Mails con el diseño de la app](#mails-con-el-diseño-de-la-app) | Autenticación | commits `6809c3c` y `2f86ee6` |

## Cliente web y app

### Mi cuenta

**Qué es.** Una pantalla para gestionar la cuenta, separada del perfil público: cambiar la contraseña y el email en pasos guiados, y ver cuándo se cambió la contraseña por última vez.

**Por qué.** El enunciado pide editar el perfil (nombre, foto, descripción) y recuperar la contraseña, pero no cambiarla ni cambiar el email estando logueado. Sin esta pantalla, la única forma de cambiar la contraseña era el flujo de "olvidé mi contraseña".

**Dónde.** `discordia-frontend` (`app/(main)/account`) y `microservicio-autenticacion` (cambio de contraseña y email, `password_changed_at`).

### Verificación del email con un código

**Qué es.** Al registrarse se manda un código al email para confirmarlo. Mi cuenta marca si el email todavía no está verificado y permite verificarlo después.

**Por qué.** La historia de registro solo pide validar el formato del email. Verificarlo confirma que la persona tiene acceso a esa casilla, que es por donde llega el recupero de contraseña.

**Dónde.** `discordia-frontend` y `microservicio-autenticacion` (commit `586817e`).

### Vincular y desvincular Google

**Qué es.** Desde Mi cuenta se ve si la cuenta tiene Google vinculado, y se puede vincular o desvincular a mano.

**Por qué.** La historia de login federado solo pide vincular la cuenta automáticamente cuando el email coincide. Faltaba poder deshacerlo o vincular una cuenta de Google con otro email.

**Dónde.** `discordia-frontend` y `microservicio-autenticacion` (commit `d08ae69`).

### Aviso de servidor despertando

**Qué es.** Al abrir la app se despiertan los servicios en segundo plano. Si todavía están dormidos, el login muestra una barra de progreso y deja completar los datos mientras tanto. El backoffice usa el mismo mecanismo.

**Por qué.** En el plan gratuito de Render los servicios se duermen tras 15 minutos sin tráfico y la primera request puede tardar hasta un minuto. Sin aviso, el login parecía roto. Ver [UX-07](ux/decisiones-ux.md).

**Dónde.** `discordia-frontend` (`scripts/warmup.mjs`, `lib/api/wake.ts`) y `discordia-backoffice`.

### Llamadas al estilo Meet

**Qué es.** La pantalla de llamada tiene un selector de diseño (automático, mosaico, destacado y barra lateral), permite fijar a un participante, anima los cambios de diseño y reproduce un sonido cuando alguien entra.

**Por qué.** Las historias de voz piden ver a los participantes, el indicador de quién habla, compartir pantalla y video, pero no cómo organizarlos. Con cámara y pantalla compartida a la vez, la vista fija no alcanzaba.

**Dónde.** `discordia-frontend` (`components/VoiceStage.tsx`, `app/(main)/voice.tsx`). Las llamadas privadas usan la misma pantalla que los canales de voz.

### Reportar servidores

**Qué es.** Además de mensajes y usuarios, se puede reportar un servidor entero. El reporte llega al staff en el backoffice.

**Por qué.** La historia de reportes cubre mensajes y usuarios. Un servidor cuyo nombre, ícono o propósito es el problema no tenía forma de llegar al staff, que es quien puede suspenderlo.

**Dónde.** `discordia-frontend`, `microservicio-servidores` y `discordia-backoffice` (expediente del servidor).

### Separadores por día en el chat

**Qué es.** Antes del primer mensaje de cada día aparece una línea con el día: "Hoy", "Ayer" o la fecha completa.

**Por qué.** Los mensajes solo mostraban la hora, así que una conversación de varios días parecía de un solo día.

**Dónde.** `discordia-frontend` (`app/(main)/chat.tsx`, `daySeparatorLabel`).

### Miembros agrupados por rol

**Qué es.** El panel de miembros agrupa a cada persona bajo su rol más alto, en el orden de la jerarquía: primero el dueño, marcado con una estrella, después cada rol con su color, y al final los miembros sin rol propio. Los otros roles de cada persona se ven como etiquetas, y al lado de cada mensaje aparece el rol del autor.

**Por qué.** El panel solo distinguía al dueño del resto, así que no se veía quién era admin o moderador. La historia "Ver miembros por rol" es otra cosa: un listado para auditar, solo para quien administra roles. Este panel lo ve cualquier miembro, igual que en el backend cualquier miembro puede ver los roles de los demás.

**Dónde.** `discordia-frontend` (`app/(main)/chat.tsx`, `membersToRoleGroups`).

## Backoffice

### Observabilidad en el backoffice

**Qué es.** Una pantalla del backoffice para ver trazas y logs de toda la plataforma, y buscar por el código de error que ve el usuario.

**Por qué.** El enunciado pide observabilidad en cada servicio, pero no que el staff la consulte sin entrar a Grafana. Con el código que muestra un error se llega directo a la traza. Ver [ADR 0013](adr/0013-observabilidad-en-el-backoffice.md).

**Dónde.** `discordia-backoffice` y `microservicio-autenticacion` (proxy de solo lectura a Tempo y Loki).

### Segundo factor para el staff

**Qué es.** Si la cuenta de staff tiene 2FA activo, el backoffice pide el código al iniciar sesión.

**Por qué.** La historia de 2FA es para el usuario final en la app. Las cuentas de staff son las que más daño pueden hacer, así que el backoffice también respeta el segundo factor.

**Dónde.** `discordia-backoffice`.

## Backend

### Mails con el diseño de la app

**Qué es.** El mail de recupero de contraseña usa el diseño de la app (tema oscuro y color de acción teal) y se envía por la API HTTP de Brevo en lugar de SMTP.

**Por qué.** Es lo único de Discordia que el usuario ve fuera de la app, justo cuando no puede entrar. Con el mismo diseño se reconoce como propio.

**Dónde.** `microservicio-autenticacion` (commits `6809c3c` y `2f86ee6`).
