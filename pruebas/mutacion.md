# Mutation testing en mensajes

Análisis de mutación sobre `microservicio-mensajes`, el requisito optativo de Testing del enunciado. Se corrió el 26/11/2026 sobre `develop`.

## Resultado

| Corrida | Mutantes | Muertos | Sobrevivientes | Mutation score |
|---|---:|---:|---:|---:|
| `develop` al 26/11 | 155 | 128 | 27 | **82,6 %** |
| Con los tests nuevos de [mensajes#40](https://github.com/IS2-Grupo-6-Discordia/microservicio-mensajes/pull/40) | 155 | 130 | 25 | **83,9 %** |

De los 25 sobrevivientes que quedan, **20 no cambian el comportamiento del servicio**: 19 tocan solo campos de logs y uno, un ajuste de rendimiento. Si se descuentan, el score sobre los mutantes que sí cambian el comportamiento es de **130 de 135 (96,3 %)**. Los 5 restantes cambian el texto de un mensaje de error sin cambiar su código HTTP.

Por archivo, en la corrida con los tests nuevos:

| Archivo | Mutantes | Muertos | Sobrevivientes | Qué sobrevive |
|---|---:|---:|---:|---|
| `app/services/word_filter.py` | 9 | 9 | 0 | — |
| `app/services/message_service.py` | 114 | 96 | 18 | 13 de logs, 4 textos de error y 1 de rendimiento |
| `app/events/handlers.py` | 32 | 25 | 7 | 6 de logs y 1 texto de error |

## Qué se mutó y por qué

Un mutante es una copia del código con un cambio chico: un `and` por `or`, un `True` por `False`, un `+` por `-`, un texto alterado. Por cada mutante se corre toda la suite. Si algún test falla, el mutante **muere**: los tests detectan ese error. Si todos pasan, **sobrevive**: el código está roto y ningún test se da cuenta. El score es la proporción de mutantes muertos, y mide la calidad de los tests mejor que la cobertura, que solo dice qué líneas se ejecutan.

Se eligió **mensajes** porque es el núcleo del producto (el chat en tiempo real) y porque su suite no necesita base de datos real (`mongomock` y `fakeredis`): corre en 12 segundos, y con 155 mutantes el análisis completo tarda unos 15 minutos. Dentro del servicio, se mutaron los tres módulos con más lógica de negocio propia:

- `app/services/message_service.py`: enviar, listar, editar y borrar mensajes, con los permisos, el silencio (HU 60), las menciones (HU 7) y el filtro de palabras (HU 63).
- `app/services/word_filter.py`: la normalización y la comparación de palabras prohibidas.
- `app/events/handlers.py`: las reacciones a los eventos del bus (baneo, expulsión, suspensión y eliminación de servidores).

El resto (rutas, cliente de servidores, tiempo real) es sobre todo integración y ya lo cubren los tests de API.

## Mutantes sobrevivientes

### Huecos reales, ya cubiertos

Eran los dos únicos sobrevivientes que cambiaban el comportamiento. [mensajes#40](https://github.com/IS2-Grupo-6-Discordia/microservicio-mensajes/pull/40) agrega un test para cada uno y los dos mueren.

**Silencio vencido al editar** (`message_service.py`, `edit`):

```diff
-        if access.is_muted() and access.muted_until is not None:
+        if access.is_muted() or access.muted_until is not None:
```

Con `or`, un miembro con un silencio ya vencido (`muted_until` en el pasado) no podría editar sus mensajes. Había un test de silencio vencido para enviar, pero no para editar. Test nuevo: `test_expired_mute_does_not_block_edit`.

**Mensajes guardados antes de las menciones** (`message_service.py`, `_to_out`):

```diff
-        mention_everyone=bool(document.get("mention_everyone", False)),
+        mention_everyone=bool(document.get("mention_everyone", True)),
```

Los mensajes guardados antes de la HU 7 no tienen los campos de menciones en Mongo. Con el mutante, todos se leerían como si mencionaran a todo el servidor. Ningún test leía un documento sin esos campos. Test nuevo: `test_message_stored_before_mentions_reads_without_them`.

### Textos de error (5)

El mutante agrega caracteres a un mensaje de error, por ejemplo:

```diff
-            raise ChannelAccessForbidden("No podés enviar mensajes en este canal.")
+            raise ChannelAccessForbidden("XXNo podés enviar mensajes en este canal.XX")
```

Los tests verifican el código HTTP (403, 404, 422) pero no el texto exacto de estos cinco mensajes: el de mencionar a todo el servidor sin permiso, el de no poder enviar en el canal (al enviar y al editar), el del canal que no pertenece al servidor y el de un evento sin un campo obligatorio. Los mensajes que el cliente muestra con información concreta (silencio con su fecha de fin y palabra prohibida) sí se verifican. Se dejan así: un cambio de texto no rompe ningún flujo, y fijar cada texto en un test haría frágil la suite ante cambios de redacción.

### Campos de logs (19)

Cambian el nombre de un evento de log o de uno de sus campos, por ejemplo:

```diff
-        logger.info("message.edited", extra={"message_id": out.id, "channel_id": str(channel_id)})
+        logger.info("message.edited", extra={"XXmessage_idXX": out.id, "channel_id": str(channel_id)})
```

La suite no verifica el contenido de estos logs de negocio, solo los de la configuración de logging y observabilidad (`test_logging.py`, `test_observability.py`). El comportamiento visible del servicio no cambia. Un error así se vería al buscar en Grafana, no en un test. Incluye el de `by_moderator` en el log de borrado (`not is_author` por `is_author`), que solo invierte un campo informativo del log; la auditoría del borrado por un moderador sí se prueba (`test_moderator_deletion_is_recorded_in_servidores_audit_log`).

### Rendimiento (1)

```diff
-        await self._servidores.channel_access(channel_id, user_id, for_read=True)
+        await self._servidores.channel_access(channel_id, user_id, for_read=False)
```

`for_read=True` usa un presupuesto de tiempo más corto y la caché de acceso al leer el historial (mensajes#32). Con `False` el resultado es el mismo y solo cambia cuánto se espera a servidores, así que es un mutante equivalente desde el punto de vista funcional.

## Cómo repetirlo

En una copia de `microservicio-mensajes` (mutmut modifica los archivos en el lugar y deja una caché `.mutmut-cache`):

```bash
sed -i '/^addopts/d' pytest.ini   # sin cobertura: mutmut corre la suite 155 veces
docker run --rm -e PYTHONDONTWRITEBYTECODE=1 -v "$PWD":/w -w /w python:3.12-slim bash -c '
  pip install -q -r requirements-dev.txt mutmut==2.5.1 &&
  mutmut run \
    --paths-to-mutate app/services/message_service.py,app/services/word_filter.py,app/events/handlers.py \
    --tests-dir tests \
    --runner "sh -c \"python -m pytest -x -q -p no:cacheprovider || exit 1\"" &&
  mutmut results'
```

Para ver un sobreviviente: `mutmut show <id>`.

**Ojo con el runner.** mutmut 2 da un mutante por sobreviviente cuando el comando de tests sale con cualquier código distinto de 1. Si el mutante rompe la sintaxis, pytest no llega a cargar los tests y sale con 4, así que sin el `|| exit 1` esos mutantes se cuentan como sobrevivientes aunque los tests fallen. En la primera corrida, sin ese ajuste, el score daba 125/155 (80,6 %) con 3 sobrevivientes falsos.

Se usó mutmut 2.5.1 y no la versión 3: mutmut 3 copia a una carpeta aparte solo los archivos mutados, y con el paquete `app` de mensajes no encontraba el resto de los módulos al cargar los tests.

No está en el CI: el enunciado no lo pide, y correrlo en cada push sumaría unos 15 minutos.
