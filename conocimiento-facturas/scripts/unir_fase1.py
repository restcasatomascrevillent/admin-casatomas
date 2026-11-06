"""Une la identificación de proveedor de los 1.673 PDF en un único mapa y resume."""
import json, os, re, sys, collections

S = sys.argv[1]
F = S + "/fase1/salida/"
cargar = lambda p: json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}

demo = {r["cif"]: r["nombre"] for r in cargar(S + "/proveedores_demo.json").get("rows", []) if r["cif"]}
nombres = cargar(F + "cif_nombres.json")
dig = cargar(S + "/proveedores_digitales.json")
sin = cargar(F + "digitales_sin_cif.json")
sin.update(cargar(F + "digitales_logo.json"))
esc = {}
for n in "abc":
    esc.update(cargar(F + f"escaneos_{n}.json"))
inv = json.load(open(S + "/inventario.json", encoding="utf-8"))


def limpio(c):
    c = re.sub(r"[^0-9A-Z]", "", (c or "").upper())
    c = c[2:] if c.startswith("ES") and len(c) == 11 else c
    return c if len(c) == 9 and c != "B54583356" else None


def clave_nombre(n):
    n = (n or "").upper()
    n = re.sub(r"\b(S\.?\s?L\.?\s?U?\.?|S\.?\s?A\.?|S\.?\s?COOP.*|SLU|SL|SA|S\.R\.L\.?)\b", "", n)
    return re.sub(r"[^A-Z0-9]", "", n)[:18]


mapa = {}
for x in inv:
    f = x["f"]
    if f in dig and dig[f]["cif"]:
        cif = dig[f]["cif"]
        info = nombres.get(cif) or {}
        mapa[f] = dict(cif=cif, proveedor=demo.get(cif) or info.get("nombre"), categoria=info.get("categoria"), origen="texto-cif", pags=x["pags"])
    else:
        r = sin.get(f) or esc.get(f) or {}
        mapa[f] = dict(cif=limpio(r.get("cif")), proveedor=r.get("proveedor"), categoria=r.get("categoria"), tipo=r.get("tipo"),
                       manuscrita=r.get("manuscrita"), local=r.get("local"), origen="agente-texto" if f in sin else ("agente-imagen" if f in esc else "pendiente"), pags=x["pags"])

# Si un nombre sin CIF coincide con un proveedor que sí tiene CIF, se le asigna.
por_nombre = {}
for v in mapa.values():
    if v["cif"] and v["proveedor"]:
        por_nombre.setdefault(clave_nombre(v["proveedor"]), v["cif"])
for v in mapa.values():
    if not v["cif"] and v["proveedor"]:
        v["cif"] = por_nombre.get(clave_nombre(v["proveedor"]))
        if v["cif"]:
            v["origen"] += "+nombre"

CATS = {"A11535564": "charcuteria", "B03969375": "alimentacion-general", "B73417701": "alimentacion-general", "B75143214": "carne", "B03141165": "alimentacion-general", "B03286184": "bebidas", "B30444285": "alimentacion-general", "A28647451": "alimentacion-general", "46914230A": "marisco", "B54968961": "fruta-verdura", "B03680253": "alimentacion-general",
        "B54157011": "pescado", "B94186988": "marisco", "B06805246": "alimentacion-general", "B73028474": "pescado",
        "E13781760": "marisco", "B53149829": "servicios", "B53363974": "limpieza", "A30228837": "alimentacion-general",
        "B03354073": "panaderia", "33288687M": "panaderia", "B75143214": "bebidas", "B30321574": "alimentacion-general",
        "B24831901": "servicios", "B53012969": "alimentacion-general", "B54977780": "alimentacion-general", "B54490115": "pescado",
        "E42544965": "pescado", "B42568519": "menaje", "A87934337": "carne", "B03821576": "alimentacion-general",
        "B03969375": "bebidas", "B03191350": "marisco"}
NOMBRE_A_CIF = {"URIARTE": "B03821576", "HERMANOS FERN": "A08620056", "EMBAJADORES": "B75143214"}
NOMBRES_FIJOS = {"B01414531": "Bodegas de los Herederos del Marqués de Riscal, S.L.U.", "B03286184": "COMERCIAL TABARCA, S.L.", "B30444285": "Productos Continental (Cafés Salzillo)", "B54490115": "Cofradía de Pescadores de Santa Pola (lonja)", "E42544965": "Lonja de Santa Pola (armador)"}
for v in mapa.values():
    if not v["cif"] and v["proveedor"]:
        for n, c in NOMBRE_A_CIF.items():
            if (v["proveedor"] or "").upper().startswith(n): v["cif"] = c; v["origen"] += "+manual"
    if v["cif"] in CATS: v["categoria"] = CATS[v["cif"]]
    if v["cif"] in NOMBRES_FIJOS: v["proveedor"] = NOMBRES_FIJOS[v["cif"]]
    if v["cif"] in demo: v["proveedor"] = demo[v["cif"]]
json.dump(mapa, open(S + "/fase1/mapa_proveedores.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)

clave = lambda v: v["cif"] or ("NOMBRE:" + clave_nombre(v["proveedor"]) if v["proveedor"] else "DESCONOCIDO")
grupos = collections.defaultdict(list)
for f, v in mapa.items():
    grupos[clave(v)].append(f)
print("PDF:", len(mapa), "| pendientes:", sum(1 for v in mapa.values() if v["origen"] == "pendiente"),
      "| sin proveedor:", len(grupos.get("DESCONOCIDO", [])))
print("proveedores distintos:", len(grupos), "| con CIF:", sum(1 for k in grupos if not k.startswith(("NOMBRE", "DESC"))),
      "| ya en demo:", sum(1 for k in grupos if k in demo))
cat = collections.Counter((mapa[fs[0]]["categoria"] or "?") for fs in grupos.values())
print("categorías (proveedores):", cat.most_common())
print("local (escaneos):", collections.Counter(v.get("local") for v in mapa.values() if v.get("local")).most_common())
print("\nTOP 30 por nº de PDF:")
for k, fs in sorted(grupos.items(), key=lambda g: -len(g[1]))[:30]:
    v = mapa[fs[0]]
    print(f"{len(fs):4}  {k[:22]:22} {('[demo] ' if k in demo else '')}{(v['proveedor'] or '?')[:45]:45} {v['categoria'] or ''}")
largos = [k for k, fs in grupos.items() if len(fs) >= 3]
print("\nproveedores con 3+ PDF:", len(largos), "cubren", sum(len(grupos[k]) for k in largos), "PDF")
