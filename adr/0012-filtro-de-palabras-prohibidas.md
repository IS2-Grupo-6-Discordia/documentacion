# ADR 0012: Filtro de palabras prohibidas por servidor

- **Fecha:** 2026-11-13

## Contexto

La historia optativa 63 pide que cada servidor tenga una lista de palabras prohibidas:

- **CA 1:** si un miembro manda un mensaje con una palabra de la lista, el mensaje no se envía y se le dice por qué.
- **CA 2:** si un moderador agrega o quita una palabra, la lista nueva aplica desde el próximo mensaje.

Hay dos lugares posibles para la lista:

- en **mensajes**, que es el que recibe el texto;
- en **servidores**, que es el que sabe quién modera.

Los endpoints para administrarla son por servidor, y mensajes hoy solo puede preguntarle a servidores el acceso a un **canal** (`GET /internal/messages/channels/{id}/access`).

## Decisión

### La lista vive en servidores

- **Tabla `server_banned_words`:** una fila por `(server_id, word)`, con `created_by` y `created_at`. Se borra en cascada con el servidor.
- **Permiso:** se administra con `MODERATE_MEMBERS` (el de la [historia 60](0011-silenciar-temporalmente-a-un-miembro.md)). No hace falta un permiso nuevo. `ADMINISTRATOR` y el dueño lo tienen siempre.
- **Endpoints** (todos con `MODERATE_MEMBERS`, `403` si no lo tiene, y `423` si el servidor está suspendido):
  - `GET /api/v1/servers/{server_id}/banned-words` devuelve la lista, en orden alfabético.
  - `PUT /api/v1/servers/{server_id}/banned-words/{word}` agrega una palabra. Es idempotente: devuelve `201` si la agregó y `200` si ya estaba.
  - `DELETE /api/v1/servers/{server_id}/banned-words/{word}` la quita: `204`, o `404` si no estaba.
- **Validación** (`422` si no se cumple): después de normalizar, tiene que ser **una sola palabra** (solo letras, números y `_`), de 1 a 50 caracteres. Hay un tope de **100 palabras** por servidor.
- **Auditoría:** `banned_word_added` y `banned_word_removed`, con la palabra en el detalle, en un grupo nuevo `words` del registro de auditoría.

### Normalización

Las palabras se comparan **sin distinguir mayúsculas ni tildes**: `casa` bloquea `casa`, `CASA`, `CaSa` y `cása`.

1. Se pasa a minúsculas con `casefold()`.
2. Se descompone con NFKD y se sacan los diacríticos (las marcas combinantes). La `ñ` también pierde su tilde y queda como `n`. Es una limitación aceptada.

La lista se guarda **ya normalizada**, así que mensajes solo tiene que normalizar el texto. Agregar `CÁSA` cuando ya está `casa` devuelve `200`.

### Acceso interno: `banned_words`

La consulta de acceso que mensajes ya hace en cada envío suma el campo `banned_words`, igual que se sumó `muted_until` en la historia 60:

```
GET /internal/messages/channels/{channel_id}/access?user_id={uuid}
200 { "channel": {…}, "can_send": true, …, "muted_until": null, "banned_words": ["casa", "perro"] }
```

Es un campo nuevo: si falta, mensajes lo toma como lista vacía. Reemplaza al `can_moderate` que se había acordado antes con quien mantiene mensajes, porque ya no hace falta.

### Mensajes: rechazar el envío y la edición

- Al **enviar** y al **editar**, mensajes normaliza el texto igual que servidores, lo parte en palabras con una regex Unicode (`\w+`) y compara cada una con la lista.
- La comparación es por **palabra completa**: `casa` no bloquea `casamiento`.
- Si alguna coincide, responde **`422`** sin guardar nada, con un detalle que dice la palabra (tal como está en la lista): `El mensaje contiene una palabra prohibida en este servidor: "casa".`
- La edición también se filtra. Si no, alguien podría mandar un mensaje limpio y después editarlo.
- **CA 2 sale solo:** mensajes lee la lista en cada envío, sin caché ni eventos. La lista nueva aplica desde el próximo mensaje.

### Logs

Nunca se loguean las palabras ni el texto rechazado, solo ids y cuántas palabras tiene la lista.

## Alternativas descartadas

- **La lista en mensajes (en MongoDB):** los endpoints para administrarla son por servidor, y para chequear `MODERATE_MEMBERS` mensajes habría necesitado una consulta interna nueva de permisos de servidor. Además, la lista y el permiso quedarían en servicios distintos.
- **Un evento `servers.banned_words.updated` y una caché en mensajes:** agrega un consumidor y la posibilidad de que la caché quede vieja, y no ahorra nada: mensajes ya consulta a servidores en cada envío.
- **Buscar subcadenas en vez de palabras completas:** bloquea palabras inocentes que contienen a la prohibida (`casa` en `casamiento`).
- **Reemplazar la palabra por asteriscos en vez de rechazar el mensaje:** la historia pide que el mensaje no se envíe y que se informe el motivo.

## Consecuencias

- **El contrato de `ChannelAccess` suma un campo.** Los consumidores que no lo conozcan lo ignoran.
- **La respuesta del acceso crece con la lista.** El tope de 100 palabras de hasta 50 caracteres la mantiene chica.
- **Variantes con otros caracteres** (`c4sa`, `c a s a`, `caaasa`) no se bloquean. El filtro es por lista exacta, no por similitud.
