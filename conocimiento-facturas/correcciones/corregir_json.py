# -*- coding: utf-8 -*-
"""Aplica al paquete de importación (importar/json) las correcciones de calidad
comprobadas contra el PDF original (ver correcciones/INFORME.md).

- Guarda la copia del JSON original en correcciones/originales/ (solo la primera vez).
- Cada corrección comprueba el valor de partida: si ya está corregido, no hace
  nada (se puede ejecutar varias veces). Si encuentra otro valor, se detiene.
- OJO: scripts/preparar_importacion.py regenera importar/ desde lote1..lote6;
  si se vuelve a ejecutar, hay que volver a pasar este script.

Uso:  python -I -X utf8 corregir_json.py
"""
import json, os, shutil, sys

BASE = r"C:\Users\migue\Desktop\Oficiosos\codigo-restaurante\facturas-conocimiento"
JDIR = os.path.join(BASE, "importar", "json")
ORIG = os.path.join(BASE, "correcciones", "originales")
os.makedirs(ORIG, exist_ok=True)

registro = []


def ruta(clave_pdf):  # "R153.pdf#0" -> json/zip2026_R153_pdf_0.json
    nombre, parte = clave_pdf.split("#")
    return os.path.join(JDIR, "zip2026_" + nombre.replace(".pdf", "_pdf") + "_" + parte + ".json")


def cargar(clave_pdf):
    p = ruta(clave_pdf)
    copia = os.path.join(ORIG, os.path.basename(p))
    if not os.path.exists(copia):
        shutil.copy2(p, copia)
    return json.load(open(p, encoding="utf-8"))


def guardar(clave_pdf, d):
    with open(ruta(clave_pdf), "w", encoding="utf-8") as fh:
        json.dump(d, fh, ensure_ascii=False, indent=1)


def anota(clave, campo, antes, despues):
    registro.append((clave, campo, antes, despues))


def fallo(msg):
    print("ERROR:", msg)
    sys.exit(1)


def r2(x):
    return round(x + 0.0, 2)


def nota_obs(d, texto):
    o = d.get("observaciones") or ""
    if texto not in o:
        d["observaciones"] = (o.rstrip(". ") + ". " if o else "") + texto


# ── D13 · Mª Carmen Virola: base impresa ANTES del 20 % de descuento sobre el total con IVA
VIROLA = {"R267.pdf#0": (252.94, 200.33), "R594.pdf#0": (302.86, 239.86), "R1002.pdf#0": (271.22, 214.81),
          "R1293.pdf#0": (223.84, 177.28), "R1650.pdf#0": (278.32, 220.43)}
for k, (antes, despues) in VIROLA.items():
    d = cargar(k)
    if abs(d["subtotal"] - despues) < 0.005:
        continue
    if abs(d["subtotal"] - antes) > 0.005 or abs(r2(d["total"] - d["iva"]) - despues) > 0.005:
        fallo(f"{k}: subtotal {d['subtotal']} inesperado")
    lineas = sum(p["total"] or 0 for p in d["productos"]) + sum(c["importe"] or 0 for c in d["cargos_pie"])
    if abs(lineas - despues) > 0.02:
        fallo(f"{k}: líneas {lineas} no cuadran con {despues}")
    d["subtotal"] = despues
    nota_obs(d, f"Corrección 06/11/2026: la base impresa {str(antes).replace('.', ',')} es anterior al descuento del 20 % "
                f"(aplicado sobre el total con IVA); subtotal guardado = total − IVA = {str(despues).replace('.', ',')}")
    anota(k, "subtotal", antes, despues)
    guardar(k, d)

# ── D13 · Campoluz: el punto verde (P.V.) va incluido en la base y no estaba en ninguna línea
PV = {"R1009.pdf#0": [(0.59, 21), (0.49, 10)], "R1205.pdf#0": [(0.86, 21), (0.16, 10)],
      "R1226.pdf#0": [(0.70, 21)], "R1402.pdf#0": [(0.19, 10)], "R152.pdf#0": [(0.55, 10)],
      "R153.pdf#0": [(0.48, 21)], "R1580.pdf#0": [(0.44, 10)], "R525.pdf#0": [(0.35, 21)],
      "R797.pdf#0": [(0.04, 21)]}
for k, cargos in PV.items():
    d = cargar(k)
    if any("Punto verde" in (c.get("concepto") or "") for c in d["cargos_pie"]):
        continue
    signo = -1 if d["tipo"] == "abono" else 1
    lineas = sum(p["total"] or 0 for p in d["productos"]) + sum(c["importe"] or 0 for c in d["cargos_pie"])
    if d["tipo"] == "abono":
        lineas = -abs(lineas)
    nuevo = lineas + signo * sum(i for i, _ in cargos)
    if abs(nuevo - d["subtotal"]) > 0.005:
        fallo(f"{k}: con el P.V. las líneas suman {nuevo:.2f} y el subtotal es {d['subtotal']}")
    for imp, pct in cargos:
        d["cargos_pie"].append({"concepto": f"Punto verde (P.V.) {pct} %", "importe": imp, "iva_pct": pct})
        anota(k, "cargos_pie (nuevo)", None, f"Punto verde (P.V.) {pct} %: {imp}")
    guardar(k, d)

# ── D13 · Abonos con una línea POSITIVA dentro (el importador fuerza todo a negativo si tipo = abono):
#    se guardan como «factura» con los signos explícitos, que es como queda en la base de datos.
for k in ("R1072.pdf#1", "R1042.pdf#0"):
    d = cargar(k)
    if d["tipo"] == "factura":
        continue
    if d["tipo"] != "abono" or d["total"] >= 0 or d["subtotal"] >= 0 or d["iva"] > 0:
        fallo(f"{k}: no es el abono esperado")
    for p in d["productos"]:
        if p["total"] is not None and p["total"] < 0 and p["cantidad"] is not None and p["cantidad"] > 0:
            p["cantidad"] = -p["cantidad"]
    d["tipo"] = "factura"
    nota_obs(d, "Abono (factura rectificativa): importes guardados en negativo; la línea de descuento/oferta va en positivo porque reduce el abono")
    anota(k, "tipo", "abono", "factura (signos explícitos)")
    guardar(k, d)
d = cargar("R1072.pdf#1")
assert d["cargos_pie"][0]["importe"] == 32.93 and d["productos"][0]["total"] == -365.9
d = cargar("R1042.pdf#0")
assert d["productos"][0]["total"] == -9.5 and d["productos"][1]["total"] == 0.95

# ── Caso 6 · D. Primeras Marcas: segunda línea con 100 % de descuento (importe en blanco = 0)
for k, ordenes in (("R860.pdf#0", [2]), ("R1017.pdf#0", [2, 4])):
    d = cargar(k)
    cambio = False
    for p in d["productos"]:
        if p["orden"] in ordenes and p["total"] is None:
            p["total"] = 0.0
            p["descuento_pct"] = 100
            p["bonificada"] = True
            anota(k, f"productos[orden {p['orden']}].total / descuento_pct", None, "0,00 / 100 %")
            cambio = True
    if cambio:
        guardar(k, d)

# ── Caso 6 · Musgrave (abono lote de Navidad): los componentes llevan su base (Pvp S/Iva de las 5
#    unidades) y no total; el precio leído era el importe de las 5 unidades -> precio por unidad.
COMP = {2: (34.05, 6.81), 3: (157.82, 31.564), 4: (84.34, 16.868)}
d = cargar("R34.pdf#0")
cambio = False
for p in d["productos"]:
    if p["orden"] in COMP:
        antes, despues = COMP[p["orden"]]
        if abs(abs(p["precio_unitario"]) - despues) < 0.0005:
            continue
        if abs(abs(p["precio_unitario"]) - antes) > 0.005:
            fallo(f"R34 orden {p['orden']}: precio {p['precio_unitario']} inesperado")
        p["precio_unitario"] = despues
        anota("R34.pdf#0", f"productos[orden {p['orden']}].precio_unitario", -antes, despues)
        cambio = True
if cambio:
    guardar("R34.pdf#0", d)

# ── Caso 8 · Colorao: columnas PESO (kg) y PRECIO (€/kg) leídas al revés
COLORAO = ["R84", "R185", "R224", "R360", "R415", "R431", "R455", "R578", "R704", "R760", "R824", "R950", "R986", "R1500"]
for f in COLORAO:
    k = f + ".pdf#0"
    d = cargar(k)
    if "Colorao" not in d["proveedor"] and "COLORAO" not in d["proveedor"].upper():
        fallo(f"{k}: proveedor {d['proveedor']}")
    cambio = False
    for p in d["productos"]:
        if p["nombre"].upper().startswith("ENVASES"):
            continue
        q, pr = p["cantidad"], p["precio_unitario"]
        if abs(q * pr - p["total"]) > 0.02:
            fallo(f"{k} {p['nombre']}: {q} x {pr} != {p['total']}")
        if q < pr:  # ya corregido (kg < €/kg en todas las líneas de este proveedor)
            continue
        p["cantidad"], p["precio_unitario"] = pr, q
        anota(k, f"{p['nombre']}: cantidad / precio_unitario", f"{q} / {pr}", f"{pr} kg / {q} €/kg")
        cambio = True
    if cambio:
        guardar(k, d)

# ── Caso 8 · Makro: el nombre leído era el código de envase (BJ = bandeja, BO = bote)
for k, orden, antes, despues in (("R891.pdf#0", 9, "BJ", "METRO Chef Pimiento California amarillo ristra 500g"),
                                 ("R718.pdf#0", 4, "BO", "LA ESPECIERA DEL NORTE Ñora en bote 380g")):
    d = cargar(k)
    p = next(p for p in d["productos"] if p["orden"] == orden)
    if p["nombre"] == despues:
        continue
    if p["nombre"] != antes:
        fallo(f"{k}: nombre {p['nombre']}")
    p["nombre"] = despues
    anota(k, f"productos[orden {orden}].nombre", antes, despues)
    guardar(k, d)

# ── Caso 8 · La Bohemia: «OBSEQUIO SIERRA CANTABRIA» es el rótulo del albarán de obsequio, no un producto
d = cargar("R1439.pdf#0")
n = len(d["productos"])
d["productos"] = [p for p in d["productos"] if p["nombre"] != "OBSEQUIO SIERRA CANTABRIA"]
if len(d["productos"]) != n:
    nota_obs(d, "El albarán 2618212 es un obsequio de Sierra Cantabria (El Puntido 21 3 L y San Vicente 19 Magnum, sin cargo); el rótulo «OBSEQUIO SIERRA CANTABRIA» no es una línea")
    anota("R1439.pdf#0", "productos (rótulo quitado)", "OBSEQUIO SIERRA CANTABRIA", None)
    guardar("R1439.pdf#0", d)

for r in registro:
    print(" | ".join("" if x is None else str(x) for x in r))
print(f"{len(registro)} cambios aplicados")
