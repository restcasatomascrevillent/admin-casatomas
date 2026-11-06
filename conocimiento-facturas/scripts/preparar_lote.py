"""Prepara un lote de extracción: texto o imágenes de TODOS los PDF de los proveedores indicados."""
import sys, os, json
D, S, LOTE = sys.argv[1], sys.argv[2], sys.argv[3]; CIFS = sys.argv[4].split(",")
sys.path.insert(0, S + "/pylib"); import pymupdf
sys.path.insert(0, D + "/scripts"); from muestras_lineas import lineas
SRC = S + "/zip_facturas/FACTURAS CONTABILIZADAS/"
m = json.load(open(D + "/mapa_proveedores.json", encoding="utf-8"))
inv = {x["f"]: x for x in json.load(open(D + "/inventario.json", encoding="utf-8"))}
for cif in CIFS:
    fs = sorted([f for f, v in m.items() if v["cif"] == cif], key=lambda f: int(f[1:-4]))
    d = f"{D}/{LOTE}/{cif}"; os.makedirs(d + "/img", exist_ok=True); os.makedirs(d + "/salida", exist_ok=True)
    for f in fs:
        doc = pymupdf.open(SRC + f)
        if inv[f]["chars"] > 200:
            t = "\n".join(f"===== PAGINA {i+1}/{doc.page_count} =====\n" + "\n".join(lineas(p)) for i, p in enumerate(doc))
            open(f"{d}/{f[:-4]}.txt", "w", encoding="utf-8").write(t)
        else:
            for i, p in enumerate(doc):
                p.get_pixmap(dpi=150).save(f"{d}/img/{f[:-4]}_p{i+1}.png")
    json.dump(fs, open(d + "/lista.json", "w"), indent=0)
    print(cif, len(fs), "PDF", sum(inv[f]["pags"] for f in fs), "pág", sum(1 for f in fs if inv[f]["chars"] <= 200), "escaneos")
