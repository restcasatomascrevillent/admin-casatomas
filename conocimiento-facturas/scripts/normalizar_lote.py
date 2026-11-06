"""Unifica criterios entre agentes antes de validar/cargar. Guarda copia en salida_orig/ la primera vez.
  1. Envases/retornables que un agente puso en cargos_pie → pasan a ser líneas de producto (IVA 21 % si no consta).
  2. local vacío o no_consta → el de la ficha si la ficha tiene un único local.
  3. tipo abono → importes en negativo si vinieron en positivo.
"""
import json, os, re, sys, shutil
D, LOTE = sys.argv[1], sys.argv[2]
ENVASE = re.compile(r"envase|batea|bandeja|caja|petit|palet|jaula|barril|retornable|cunera|turia|campo", re.I)
cambios = {"envases": 0, "local": 0, "abono": 0}
for cif in os.listdir(f"{D}/{LOTE}"):
    sal = f"{D}/{LOTE}/{cif}/salida"
    if not os.path.isdir(sal): continue
    orig = f"{D}/{LOTE}/{cif}/salida_orig"
    if not os.path.isdir(orig): shutil.copytree(sal, orig)
    ficha = json.load(open(f"{D}/fichas/{cif}.json", encoding="utf-8")) if os.path.exists(f"{D}/fichas/{cif}.json") else {}
    locales = ficha.get("locales") or []
    for f in os.listdir(sal):
        if not f.endswith(".json"): continue
        p = f"{sal}/{f}"; datos = json.load(open(p, encoding="utf-8")); lista = datos if isinstance(datos, list) else [datos]
        for d in lista:
            if d.get("parte_de"): continue
            resto = []
            for c in d.get("cargos_pie") or []:
                if ENVASE.search(c.get("concepto") or ""):
                    d.setdefault("productos", []).append({"orden": len(d["productos"]) + 1, "pagina": None, "nombre": c.get("concepto"), "producto_ficha": None,
                        "cantidad": 1, "unidad": "ud", "bultos": None, "contenido_cantidad": None, "contenido_unidad": None,
                        "precio_unitario": c.get("importe"), "descuento_pct": None, "total": c.get("importe"),
                        "iva_pct": c.get("iva_pct") if c.get("iva_pct") is not None else 21, "albaran_ref": None, "bonificada": False, "es_envase": True})
                    cambios["envases"] += 1
                else:
                    resto.append(c)
            d["cargos_pie"] = resto
            if d.get("local") in (None, "", "no_consta") and len(locales) == 1:
                d["local"] = locales[0]; d.setdefault("alertas", []).append("local tomado de la ficha (no impreso)"); cambios["local"] += 1
            if d.get("tipo") == "abono" and isinstance(d.get("total"), (int, float)) and d["total"] > 0:
                for k in ("subtotal", "iva", "total"):
                    if isinstance(d.get(k), (int, float)): d[k] = -abs(d[k])
                for x in d.get("desglose_iva") or []:
                    for k in ("base", "cuota"):
                        if isinstance(x.get(k), (int, float)): x[k] = -abs(x[k])
                for l in d.get("productos") or []:
                    if isinstance(l.get("total"), (int, float)): l["total"] = -abs(l["total"])
                cambios["abono"] += 1
        json.dump(datos, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(LOTE, cambios)
