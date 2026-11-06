"""Valida la extracción de un lote: lote/<CIF>/salida/*.json  →  informe por proveedor + lote/INFORME.md

Comprobaciones duras (marcan la factura «a revisar»):
  · campos obligatorios, fecha válida, CIF ≠ cliente
  · suma de líneas + cargos del pie ≈ base imponible
  · base + IVA + R.E. − IRPF ≈ total
  · cuota de cada tipo ≈ base × tipo
  · duplicados (proveedor + número)
Avisos suaves (informativos):
  · cantidad × precio × (1 − dto) ≠ importe de la línea
  · precio fuera del rango visto en la ficha (×0,5 … ×2)
"""
import json, os, re, sys, collections

D, LOTE = sys.argv[1], sys.argv[2]
B = f"{D}/{LOTE}"
CLIENTE = "B54583356"
num = lambda v: v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def tol(x):
    return max(0.06, 0.003 * abs(x or 0))


def rangos_ficha(cif):
    p = f"{D}/fichas/{cif}.json"
    if not os.path.exists(p):
        return {}
    r = {}
    for pr in json.load(open(p, encoding="utf-8")).get("productos") or []:
        pre = pr.get("precio") or {}
        mn, mx = num(pre.get("min")), num(pre.get("max"))
        if mn and mx:
            r[(pr.get("nombre_normalizado") or "").lower()] = (mn, mx)
    return r


def revisar(d, rangos):
    duras, suaves = [], []
    for k in ("tipo", "proveedor", "cif", "numero_documento", "fecha", "total"):
        if d.get(k) in (None, ""):
            duras.append(f"falta {k}")
    if (d.get("cif") or "").replace("-", "").upper() == CLIENTE:
        duras.append("CIF del cliente como proveedor")
    if d.get("fecha") and not re.fullmatch(r"20(25|26)-\d\d-\d\d", str(d["fecha"])):
        duras.append(f"fecha rara {d['fecha']}")
    prods = d.get("productos") or []
    if not prods:
        duras.append("sin líneas")
    lineas = round(sum(num(p.get("total")) or 0 for p in prods), 2)
    pie = round(sum(num(c.get("importe")) or 0 for c in d.get("cargos_pie") or []), 2)
    des = d.get("desglose_iva") or []
    sub = num(d.get("subtotal")); iva = num(d.get("iva"))
    if sub is None and des: sub = round(sum(num(x.get("base")) or 0 for x in des), 2)
    if iva is None and des: iva = round(sum(num(x.get("cuota")) or 0 for x in des), 2)
    re_, irpf, tot = num(d.get("recargo_equivalencia")) or 0, num(d.get("retencion_irpf")) or 0, num(d.get("total"))
    if sub is not None and prods and abs(lineas + pie - sub) > tol(sub):
        duras.append(f"líneas {lineas} + pie {pie} ≠ base {sub} (dif {round(lineas + pie - sub, 2)})")
    if None not in (sub, iva, tot) and abs(sub + iva + re_ - abs(irpf) - tot) > tol(tot):
        duras.append(f"base+IVA+RE−IRPF = {round(sub + iva + re_ - abs(irpf), 2)} ≠ total {tot}")
    for x in des:
        b, p, c = num(x.get("base")), num(x.get("pct")), num(x.get("cuota"))
        if None not in (b, p, c) and abs(b * p / 100 - c) > max(0.06, 0.01 * abs(c)):
            duras.append(f"cuota {p}% de {b} = {round(b * p / 100, 2)} ≠ {c}")
    for p in prods:
        q, pu, t, dt = num(p.get("cantidad")), num(p.get("precio_unitario")), num(p.get("total")), num(p.get("descuento_pct")) or 0
        if q is not None and pu is not None and t is not None and not p.get("bonificada"):
            if abs(q * pu * (1 - dt / 100) - t) > max(0.06, 0.02 * abs(t)):
                suaves.append(f"línea «{(p.get('nombre') or '')[:28]}»: {q}×{pu}{f'−{dt}%' if dt else ''} ≠ {t}")
        rg = rangos.get((p.get("producto_ficha") or "").lower())
        if rg and pu and (pu < rg[0] * 0.5 or pu > rg[1] * 2):
            suaves.append(f"precio raro «{(p.get('nombre') or '')[:28]}»: {pu} (ficha {rg[0]}–{rg[1]})")
    return duras, suaves, len(prods)


filas, vistos, md = [], collections.Counter(), [f"# Informe {LOTE}\n"]
tot_pdf = tot_fac = tot_ok = tot_lineas = 0
for cif in sorted(os.listdir(B)):
    sal = f"{B}/{cif}/salida"
    if not os.path.isdir(sal):
        continue
    lista = json.load(open(f"{B}/{cif}/lista.json"))
    hechos = {f[:-5] + ".pdf" for f in os.listdir(sal) if f.endswith(".json")}
    faltan = [f for f in lista if f not in hechos]
    rangos = rangos_ficha(cif)
    ok = fac = 0; revisar_ = []; suaves_n = 0; partes = 0
    for f in sorted(os.listdir(sal), key=lambda x: int(re.sub(r"\D", "", x) or 0)):
        if not f.endswith(".json"):
            continue
        try:
            datos = json.load(open(f"{sal}/{f}", encoding="utf-8"))
        except Exception as e:
            revisar_.append((f, "-", [f"JSON inválido: {str(e)[:60]}"])); fac += 1; continue
        for d in (datos if isinstance(datos, list) else [datos]):
            if d.get("parte_de") or d.get("no_es_factura"):
                partes += 1; continue
            fac += 1
            duras, suaves, nl = revisar(d, rangos)
            tot_lineas += nl
            clave = (d.get("cif"), str(d.get("numero_documento")).replace(" ", ""))
            vistos[clave] += 1
            if vistos[clave] > 1:
                duras.append("DUPLICADA (mismo proveedor y número)")
            suaves_n += len(suaves)
            if duras:
                revisar_.append((f, d.get("numero_documento"), duras))
            else:
                ok += 1
    nombre = json.load(open(f"{D}/fichas/{cif}.json", encoding="utf-8"))["nombre"] if os.path.exists(f"{D}/fichas/{cif}.json") else cif
    tot_pdf += len(hechos); tot_fac += fac; tot_ok += ok
    print(f"{cif} {nombre[:34]:34} PDF {len(hechos)}/{len(lista)}  facturas {fac}  cuadran {ok}  a revisar {len(revisar_)}  continuaciones {partes}  avisos suaves {suaves_n}" + (f"  FALTAN {faltan[:6]}" if faltan else ""))
    md.append(f"## {nombre} ({cif})\n- PDF {len(hechos)}/{len(lista)} · facturas {fac} · **cuadran {ok}** · a revisar {len(revisar_)} · avisos suaves {suaves_n}")
    for f, n, a in revisar_:
        md.append(f"  - {f} nº {n}: " + "; ".join(a))
    md.append("")
print(f"\nTOTAL: PDF {tot_pdf} · facturas {tot_fac} · cuadran {tot_ok} ({round(100 * tot_ok / max(tot_fac, 1))} %) · líneas {tot_lineas}")
md.insert(1, f"**Total:** PDF {tot_pdf} · facturas {tot_fac} · cuadran {tot_ok} ({round(100 * tot_ok / max(tot_fac, 1))} %) · líneas {tot_lineas}\n")
open(f"{B}/INFORME.md", "w", encoding="utf-8").write("\n".join(md))


# ── Comprobación extra: en los PDF digitales, el total extraído debe aparecer literal en el texto ──
def formas(x):
    s = f"{x:,.2f}"
    es = s.replace(",", "X").replace(".", ",").replace("X", ".")
    return {s, es, s.replace(",", ""), es.replace(".", ""), es.replace(".", " ")}

lit_ok, lit_no = 0, []
for cif in sorted(os.listdir(B)):
    sal = f"{B}/{cif}/salida"
    if not os.path.isdir(sal):
        continue
    for f in os.listdir(sal):
        txt = f"{B}/{cif}/{f[:-5]}.txt"
        if not f.endswith(".json") or not os.path.exists(txt):
            continue
        t = open(txt, encoding="utf-8").read()
        try:
            ds = json.load(open(f"{sal}/{f}", encoding="utf-8"))
        except Exception:
            continue
        for d in (ds if isinstance(ds, list) else [ds]):
            if d.get("parte_de") or d.get("no_es_factura") or num(d.get("total")) is None:
                continue
            if any(v in t for v in formas(abs(d["total"]))):
                lit_ok += 1
            else:
                lit_no.append(f"{cif}/{f} total {d['total']}")
print(f"Digitales con el total literal en el original: {lit_ok}  ·  NO aparece: {len(lit_no)}", lit_no[:10])
with open(f"{B}/INFORME.md", "a", encoding="utf-8") as o:
    o.write(f"\n## Total literal en el original (digitales)\n- aparece: {lit_ok} · no aparece: {len(lit_no)}\n" + "".join(f"  - {x}\n" for x in lit_no))


# ── Comprobación de identidad: el nº de factura extraído debe estar en el texto de ESE PDF (digitales) ──
def nucleo(n):
    ds = re.findall(r"\d+", str(n or ""))
    return max(ds, key=len) if ds else ""

id_ok, id_no = 0, []
for cif in sorted(os.listdir(B)):
    sal = f"{B}/{cif}/salida"
    if not os.path.isdir(sal):
        continue
    for f in os.listdir(sal):
        txt = f"{B}/{cif}/{f[:-5]}.txt"
        if not f.endswith(".json") or not os.path.exists(txt):
            continue
        t = re.sub(r"[\s.,]", "", open(txt, encoding="utf-8").read())
        try:
            ds = json.load(open(f"{sal}/{f}", encoding="utf-8"))
        except Exception:
            continue
        for d in (ds if isinstance(ds, list) else [ds]):
            if d.get("parte_de") or d.get("no_es_factura"):
                continue
            n = nucleo(d.get("numero_documento"))
            if n and n.lstrip("0") in t:
                id_ok += 1
            else:
                id_no.append(f"{cif}/{f} nº {d.get('numero_documento')}")
print(f"Identidad (nº de factura presente en el texto de su PDF): {id_ok}  ·  NO: {len(id_no)}", id_no[:15])
with open(f"{B}/INFORME.md", "a", encoding="utf-8") as o:
    o.write(f"\n## Identidad nº factura ↔ PDF (digitales)\n- coincide: {id_ok} · no coincide: {len(id_no)}\n" + "".join(f"  - {x}\n" for x in id_no))
