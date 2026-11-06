"""Valida los JSON extraídos: campos obligatorios, sumas de líneas y cuadre de totales."""
import json, os, re, sys

carpeta = sys.argv[1]
CLIENTE = "B54583356"
TOL = 0.05  # céntimos de redondeo


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def revisar(d):
    avisos = []
    for k in ("tipo", "proveedor", "cif", "numero_documento", "fecha", "total"):
        if d.get(k) in (None, ""):
            avisos.append(f"falta {k}")
    cif = (d.get("cif") or "").upper().replace("-", "").replace(" ", "")
    if cif == CLIENTE:
        avisos.append("cif es el del CLIENTE")
    if d.get("fecha") and not re.fullmatch(r"20\d\d-\d\d-\d\d", d["fecha"]):
        avisos.append(f"fecha rara {d['fecha']}")
    prods = d.get("productos") or []
    if not prods:
        avisos.append("sin productos")
    suma = round(sum(num(p.get("total")) or 0 for p in prods), 2)
    sub, iva, re_, tot = (num(d.get(k)) for k in ("subtotal", "iva", "recargo_equivalencia", "total"))
    des = d.get("desglose_iva") or []
    if iva is None and des:
        iva = round(sum(num(x.get("cuota")) or 0 for x in des), 2)
    if sub is None and des:
        sub = round(sum(num(x.get("base")) or 0 for x in des), 2)
    irpf = num(d.get("retencion_irpf")) or 0
    if sub is not None and prods and abs(suma - sub) > max(TOL, 0.002 * abs(sub)):
        avisos.append(f"líneas suman {suma} ≠ base {sub} (dif {round(suma - sub, 2)})")
    if sub is not None and iva is not None and tot is not None:
        calc = round(sub + iva + (re_ or 0) - irpf, 2)
        if abs(calc - tot) > TOL:
            avisos.append(f"base+IVA(+RE)={calc} ≠ total {tot}")
    for p in prods:
        c, pu, t = num(p.get("cantidad")), num(p.get("precio_unitario")), num(p.get("total"))
        q = num(p.get("peso_kg")) if p.get("base_precio") == "por_kg" and p.get("peso_kg") else c
        if q and pu is not None and t is not None and abs(q * pu - t) > max(0.05, 0.02 * abs(t)) and not p.get("bonificada"):
            # puede haber descuento por línea; solo aviso informativo
            avisos.append(f"línea '{p.get('nombre','')[:30]}': {q}×{pu}≠{t}")
    return suma, avisos


filas = []
for f in sorted(os.listdir(carpeta)):
    if not f.endswith(".json"):
        continue
    try:
        datos = json.load(open(os.path.join(carpeta, f), encoding="utf-8"))
    except Exception as e:
        filas.append((f, "-", 0, None, ["JSON inválido: " + str(e)[:60]], 0))
        continue
    docs = datos if isinstance(datos, list) else [datos]
    for d in docs:
        suma, av = revisar(d)
        graves = [a for a in av if not a.startswith("línea '")]
        filas.append((f, d.get("numero_documento"), len(d.get("productos") or []), d.get("total"), av, len(d.get("dudas") or [])))

ok = sum(1 for r in filas if not [a for a in r[4] if not a.startswith("línea '")])
print(f"documentos: {len(filas)}  cuadran: {ok}  a revisar: {len(filas) - ok}\n")
for f, n, np_, tot, av, du in filas:
    graves = [a for a in av if not a.startswith("línea '")]
    lineas = [a for a in av if a.startswith("línea '")]
    estado = "OK " if not graves else "REV"
    print(f"{estado} {f:12} nº {str(n)[:18]:18} {np_:4} líneas  total {tot}  dudas:{du}")
    for a in graves:
        print("      ·", a)
    if lineas:
        print(f"      · {len(lineas)} líneas con cantidad×precio≠importe (¿descuentos?) p. ej. {lineas[0]}")
