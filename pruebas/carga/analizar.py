#!/usr/bin/env python3
"""Resume la serie temporal de una corrida de k6 por ventanas de tiempo.

Lee la salida CSV de k6 (--out csv=salidas/X.csv.gz) y, opcionalmente, el CSV de entorno/stats.sh,
y escribe una tabla Markdown con, por ventana: usuarios virtuales, requests/s, p95 de cada
endpoint, tasa de error, p95 de entrega por WebSocket y la CPU de cada contenedor. Sirve para
ubicar el escalón en el que el sistema se rompe y qué servicio se satura en ese momento.

Uso (desde pruebas/carga/):
    python3 analizar.py salidas/estres.csv.gz --stats salidas/estres-stats.csv --ventana 30
Solo usa la biblioteca estándar.
"""

import argparse
import csv
import gzip
import math
from collections import defaultdict

ENDPOINTS = {
    "POST /channels/{id}/messages": "POST msg",
    "GET /channels/{id}/messages": "GET hist",
    "GET /channels/{id}/messages (paginado)": "GET pag",
    "POST /messages/realtime/ticket": "ticket",
    "POST /auth/login": "login",
}
CONTENEDORES = ["gateway", "autenticacion", "servidores", "mensajes-1", "mensajes-2", "mongo", "redis"]


def p95(valores):
    if not valores:
        return None
    s = sorted(valores)
    return s[min(len(s) - 1, math.ceil(0.95 * len(s)) - 1)]


def fmt(v, sufijo=""):
    return "-" if v is None else f"{v:.0f}{sufijo}"


def leer_k6(path, ventana):
    abrir = gzip.open if path.endswith(".gz") else open
    v = defaultdict(lambda: {
        "vus": 0, "reqs": 0, "fallidas": 0, "dur": defaultdict(list), "entrega": [], "perdidos": 0,
    })
    t0 = None
    with abrir(path, "rt", newline="") as f:
        for row in csv.DictReader(f):
            ts = int(row["timestamp"])
            # Las requests de setup() (logins previos) no tienen escenario: se descartan.
            if row["metric_name"].startswith("http_req") and not row.get("scenario"):
                continue
            if t0 is None:
                t0 = ts
            w = (ts - t0) // ventana
            b = v[w]
            nombre, valor = row["metric_name"], float(row["metric_value"])
            if nombre == "vus":
                b["vus"] = max(b["vus"], int(valor))
            elif nombre == "http_reqs":
                b["reqs"] += 1
            elif nombre == "http_req_failed" and valor == 1:
                b["fallidas"] += 1
            elif nombre == "http_req_duration":
                b["dur"][row.get("name", "")].append(valor)
            elif nombre == "entrega_ms":
                b["entrega"].append(valor)
            elif nombre == "entrega_propia_ok" and valor == 0:
                b["perdidos"] += 1
    return t0, v


def leer_stats(path, t0, ventana):
    cpu = defaultdict(lambda: defaultdict(list))
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            w = (int(row["timestamp"]) - t0) // ventana
            try:
                cpu[w][row["contenedor"]].append(float(row["cpu_pct"]))
            except ValueError:
                pass
    return cpu


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("k6_csv")
    ap.add_argument("--stats")
    ap.add_argument("--ventana", type=int, default=30, help="segundos por fila")
    args = ap.parse_args()

    t0, ventanas = leer_k6(args.k6_csv, args.ventana)
    cpu = leer_stats(args.stats, t0, args.ventana) if args.stats else {}

    cols = ["t (s)", "VUs", "req/s", "err %"] + list(ENDPOINTS.values()) + ["entrega p95", "perdidos"]
    if cpu:
        cols += [f"CPU {c}" for c in CONTENEDORES]
    print("| " + " | ".join(cols) + " |")
    print("|" + "---|" * len(cols))
    for w in sorted(ventanas):
        b = ventanas[w]
        fila = [
            str(w * args.ventana),
            str(b["vus"]),
            f"{b['reqs'] / args.ventana:.1f}",
            f"{100 * b['fallidas'] / b['reqs']:.1f}" if b["reqs"] else "-",
        ]
        fila += [fmt(p95(b["dur"].get(n, [])), " ms") for n in ENDPOINTS]
        fila += [fmt(p95(b["entrega"]), " ms"), str(b["perdidos"])]
        if cpu:
            fila += [
                fmt(max(cpu[w][c]) if cpu.get(w, {}).get(c) else None, "%") for c in CONTENEDORES
            ]
        print("| " + " | ".join(fila) + " |")


if __name__ == "__main__":
    main()
