"""Prepara importar/ (manifest.json + json/ + pdf/) a partir de lote1..lote6.

- Una entrada por factura; se saltan no_es_factura y las continuaciones (parte_de).
- Duplicados: mismo proveedor + mismo número, o mismo proveedor + mismo total + misma fecha.
  Se queda la versión digital (o la primera). Mismo número con total/fecha distintos → se
  importan las dos con alerta «revisar».
- precio_referencia en líneas regaladas sin precio (último precio de ese proveedor y artículo).
- Páginas de cada factura para recortar el PDF (la lonja trae una factura por página).
Uso: python -I preparar_importacion.py <D> <S>
"""
import glob, json, os, re, shutil, sys, collections

D, S = sys.argv[1], sys.argv[2]
SRC = S + "/zip_facturas/FACTURAS CONTABILIZADAS/"
OUT = D + "/importar"
inv = {x["f"]: x for x in json.load(open(D + "/inventario.json", encoding="utf-8"))}
mapa = json.load(open(D + "/mapa_proveedores.json", encoding="utf-8"))
NOMBRES_MALOS = re.compile(r"no consta|desconocid|^\s*$", re.I)


def num_clave(n):
    return re.sub(r"[^0-9A-Z]", "", str(n or "").upper())


def paginas_de(d, archivo):
    pags = d.get("paginas_pdf") or []
    res = collections.OrderedDict()
    for p in pags:
        if isinstance(p, int):
            res.setdefault(archivo, []).append(p)
        elif isinstance(p, str):
            m = re.match(r"(R\d+)(?:\.pdf)?:p?(\d+)", p.strip(), re.I)
            if m:
                res.setdefault(m.group(1) + ".pdf", []).append(int(m.group(2)))
            elif p.strip().isdigit():
                res.setdefault(archivo, []).append(int(p))
    if not res:
        res[archivo] = list(range(1, inv[archivo]["pags"] + 1))
    return [{"pdf": f"pdf/{a}", "pages": sorted(set(v))} for a, v in res.items()]


# 1) Recoger facturas
facturas, no_facturas = [], []
for f in sorted(glob.glob(D + "/lote[1-6]/*/salida/*.json")):
    archivo = os.path.basename(f)[:-5] + ".pdf"
    datos = json.load(open(f, encoding="utf-8"))
    for i, d in enumerate(datos if isinstance(datos, list) else [datos]):
        if d.get("parte_de"):
            continue
        if d.get("no_es_factura"):
            no_facturas.append({"archivo": archivo, "que_es": d.get("que_es")})
            continue
        d = dict(d)
        d["archivo"] = archivo
        if not d.get("proveedor") or NOMBRES_MALOS.search(str(d.get("proveedor"))):
            d["proveedor"] = (mapa.get(archivo) or {}).get("proveedor") or d.get("proveedor")
        if not d.get("cif"):
            d["cif"] = (mapa.get(archivo) or {}).get("cif")
        facturas.append({"clave": f"zip2026:{archivo}#{i}", "datos": d,
                         "digital": inv[archivo]["chars"] > 200})

# 2) Duplicados
facturas.sort(key=lambda x: (not x["digital"], int(x["datos"]["archivo"][1:-4])))
vistos_num, vistos_tot, finales, descartadas = {}, {}, [], []
for x in facturas:
    d = x["datos"]
    prov = (d.get("cif") or d.get("proveedor") or "").upper()
    kn = (prov, num_clave(d.get("numero_documento")))
    kt = (prov, d.get("total"), d.get("fecha"))
    previo = vistos_num.get(kn) if kn[1] else None
    if previo is not None:
        p = previo["datos"]
        if p.get("total") == d.get("total") and p.get("fecha") == d.get("fecha"):
            descartadas.append({"archivo": d["archivo"], "igual_a": p["archivo"], "motivo": "mismo número"}); continue
        d.setdefault("alertas", []).append(f"Mismo número que {p['archivo']} con otro total o fecha: revisar")
    elif kt in vistos_tot and d.get("total") not in (None, 0):
        descartadas.append({"archivo": d["archivo"], "igual_a": vistos_tot[kt]["datos"]["archivo"], "motivo": "mismo total y fecha"}); continue
    if kn[1]:
        vistos_num.setdefault(kn, x)
    vistos_tot.setdefault(kt, x)
    finales.append(x)

# 3) precio_referencia para regalos sin precio
historial = collections.defaultdict(list)
for x in finales:
    d = x["datos"]
    for l in d.get("productos") or []:
        if l.get("precio_unitario") and (l.get("total") or 0) > 0:
            historial[((d.get("cif") or ""), re.sub(r"\W+", "", (l.get("nombre") or "").upper()))].append((d.get("fecha") or "", l["precio_unitario"]))
con_ref = 0
for x in finales:
    d = x["datos"]
    for l in d.get("productos") or []:
        if (l.get("bonificada") or l.get("total") == 0) and not l.get("precio_unitario"):
            h = sorted(historial.get(((d.get("cif") or ""), re.sub(r"\W+", "", (l.get("nombre") or "").upper())), []))
            antes = [p for f_, p in h if f_ <= (d.get("fecha") or "9999")] or [p for _, p in h]
            if antes:
                l["precio_referencia"] = antes[-1]; con_ref += 1

# 4) Escribir paquete
if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT + "/json"); os.makedirs(OUT + "/pdf")
manifest, pdfs = [], set()
for x in finales:
    d = x["datos"]
    nombre = re.sub(r"[^A-Za-z0-9]+", "_", x["clave"]) + ".json"
    json.dump(d, open(f"{OUT}/json/{nombre}", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    pags = paginas_de(d, d["archivo"])
    pdfs |= {p["pdf"][4:] for p in pags}
    manifest.append({"clave": x["clave"], "json": f"json/{nombre}", "paginas": pags,
                     "proveedor": d.get("proveedor"), "total": d.get("total"),
                     "fecha": d.get("fecha"), "local": d.get("local"),
                     "alertas": len(d.get("alertas") or [])})
for a in sorted(pdfs):
    shutil.copy2(SRC + a, f"{OUT}/pdf/{a}")
manifest.sort(key=lambda m: (m["fecha"] or "", m["clave"]))
json.dump(manifest, open(OUT + "/manifest.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump({"descartadas_por_duplicado": descartadas, "no_facturas": no_facturas},
          open(OUT + "/fuera_de_la_carga.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
tot = round(sum(m["total"] or 0 for m in manifest), 2)
print(f"facturas a importar: {len(manifest)} | duplicadas fuera: {len(descartadas)} | no-facturas fuera: {len(no_facturas)}")
print(f"PDF copiados: {len(pdfs)} | regalos con precio de referencia: {con_ref} | importe total: {tot} €")
print("con alertas:", sum(1 for m in manifest if m["alertas"]), "| por local:", dict(collections.Counter(m["local"] for m in manifest)))
