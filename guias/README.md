# Guías de usuario

| Guía | Para quién | PDF |
|---|---|---|
| Guía de usuario | Quien usa Discordia en el navegador o en Android: cuenta, servidores, chat, voz, roles y moderación | [`guia-de-usuario.pdf`](guia-de-usuario.pdf) |
| Guía del backoffice | El staff de la plataforma: usuarios, servidores, reportes, expedientes, métricas y observabilidad | [`guia-del-backoffice.pdf`](guia-del-backoffice.pdf) |

Los PDF se leen directo en GitHub. Usan el sistema de diseño de las apps ([`ux/sistema-de-diseno.md`](../ux/sistema-de-diseno.md)): los mismos colores, radios, tipografía y la marca "D".

## Cómo actualizarlas

La fuente de cada PDF es un HTML en [`fuente/`](fuente/), con los estilos compartidos en `fuente/estilos.css`. Para cambiar una guía, se edita su HTML y se vuelve a generar el PDF con Chrome:

```bash
cd guias
google-chrome --headless=new --no-pdf-header-footer --virtual-time-budget=8000 \
  --print-to-pdf="$PWD/guia-de-usuario.pdf" "file://$PWD/fuente/app.html"
google-chrome --headless=new --no-pdf-header-footer --virtual-time-budget=8000 \
  --print-to-pdf="$PWD/guia-del-backoffice.pdf" "file://$PWD/fuente/backoffice.html"
```

La tipografía (Inter) se descarga de Google Fonts al generar; sin conexión se usa Roboto. Si cambia una pantalla o un texto de la app, hay que actualizar la guía en el mismo PR.
