"""Revisa las fichas de fichas/*.json y genera fichas/RESUMEN.md para leerlas de un vistazo."""
import json, os, sys

D = sys.argv[1]
F = D + "/fichas"
CLAVES = ["cif", "nombre", "categoria", "documento", "lectura", "reglas_cuadre", "guia_ocr", "productos"]
BEBIDA = {"bebidas", "vino"}
informe, md = [], ["# Fichas de proveedor — resumen\n"]

for f in sorted(os.listdir(F)):
    if not f.endswith(".json"):
        continue
    avisos = []
    try:
        d = json.load(open(os.path.join(F, f), encoding="utf-8"))
    except Exception as e:
        informe.append((f, ["JSON inválido: " + str(e)[:80]], 0)); continue
    for k in CLAVES:
        if d.get(k) in (None, "", [], {}):
            avisos.append(f"falta {k}")
    palabras = len((d.get("guia_ocr") or "").split())
    if palabras > 130:
        avisos.append(f"guia_ocr larga ({palabras} palabras)")
    prods = d.get("productos") or []
    sin_formato = sin_unidad = precio_raro = 0
    for p in prods:
        fo = p.get("formato") or {}
        if d.get("categoria") in BEBIDA or p.get("familia") in ("vino", "cerveza", "refresco", "licor", "agua"):
            if not fo.get("envase") or not fo.get("contenido") or "unidades_por_bulto" not in fo:
                sin_formato += 1
        if not p.get("unidad_factura"):
            sin_unidad += 1
        pr = p.get("precio") or {}
        if isinstance(pr.get("min"), (int, float)) and isinstance(pr.get("max"), (int, float)) and pr["min"] > pr["max"]:
            precio_raro += 1
    if sin_formato: avisos.append(f"{sin_formato} bebidas sin envase/contenido/unidades por bulto")
    if sin_unidad: avisos.append(f"{sin_unidad} productos sin unidad_factura")
    if precio_raro: avisos.append(f"{precio_raro} productos con min > max")
    informe.append((f, avisos, len(prods)))

    le, doc = d.get("lectura") or {}, d.get("documento") or {}
    md.append(f"## {d.get('nombre')} — {d.get('cif')} ({d.get('categoria')})\n")
    md.append(f"- **Documento:** {doc.get('tipo_habitual')} · páginas {doc.get('paginas_tipicas')} · nº {', '.join((doc.get('numero_factura') or {}).get('ejemplos') or [])}")
    md.append(f"- **Cantidad es:** {le.get('cantidad_es')} · **precio por:** {le.get('precio_es_por')} · **IVA:** {le.get('tipos_iva')}")
    dto = le.get("descuento_por_linea") or {}
    md.append(f"- **Descuento por línea:** {'sí ' + str(dto.get('valores_habituales') or '') if dto.get('existe') else 'no'} · **pie:** {le.get('cargos_y_descuentos_pie') or 'nada'}")
    for t in (le.get("trampas") or [])[:4]:
        md.append(f"- ⚠️ {t}")
    md.append(f"- **Guía para el OCR:** {d.get('guia_ocr')}")
    md.append(f"- **Catálogo:** {len(prods)} productos. Ejemplos:")
    for p in prods[:6]:
        fo, pr = p.get("formato") or {}, p.get("precio") or {}
        fmt = " ".join(str(x) for x in [fo.get("envase"), fo.get("contenido"), fo.get("unidad_contenido"), f"×{fo.get('unidades_por_bulto')}" if fo.get("unidades_por_bulto") else None, fo.get("bulto")] if x)
        md.append(f"  - {p.get('nombre_normalizado') or p.get('nombre_impreso')} · {p.get('presentacion') or ''} · {fmt} · se factura por {p.get('unidad_factura')} · {pr.get('min')}–{pr.get('max')} €/{pr.get('por')}")
    if d.get("dudas"):
        md.append(f"- **Dudas ({len(d['dudas'])}):** " + " | ".join(str(x) for x in d["dudas"][:3]))
    md.append("")

open(F + "/RESUMEN.md", "w", encoding="utf-8").write("\n".join(md))
print(f"fichas: {len(informe)}  sin avisos: {sum(1 for _, a, _ in informe if not a)}")
for f, a, n in informe:
    print(f"{'OK ' if not a else 'REV'} {f:16} {n:4} productos", "· " + " · ".join(a) if a else "")
