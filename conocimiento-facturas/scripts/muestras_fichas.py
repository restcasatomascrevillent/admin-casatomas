"""Prepara, para los N proveedores de producto más grandes, 4 muestras + catálogo de líneas."""
import sys, os, re, json, collections
D, S, N, DESDE = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 0
sys.path.insert(0, S + "/pylib"); import pymupdf
SRC = S + "/zip_facturas/FACTURAS CONTABILIZADAS/"
m = json.load(open(D + "/mapa_proveedores.json", encoding="utf-8"))
inv = {x["f"]: x for x in json.load(open(D + "/inventario.json", encoding="utf-8"))}
PROD = {"alimentacion-general", "pescado", "fruta-verdura", "bebidas", "vino", "marisco", "carne", "panaderia", "lacteos", "menaje", "limpieza"}
g = collections.defaultdict(list)
for f, v in m.items():
    if v["cif"]: g[v["cif"]].append(f)
cat = lambda fs: collections.Counter(m[f]["categoria"] for f in fs if m[f]["categoria"]).most_common(1)[0][0] if any(m[f]["categoria"] for f in fs) else None
top = [c for c, fs in sorted(g.items(), key=lambda kv: -len(kv[1])) if cat(fs) in PROD][DESDE:DESDE + N]
num = lambda f: int(re.sub(r"\D", "", f) or 0)

def lineas(page):
    rows = []
    for w in sorted(page.get_text("words"), key=lambda w: (round(w[3] / 3), w[0])):
        y = (w[1] + w[3]) / 2
        if rows and abs(rows[-1][0] - y) < 3: rows[-1][1].append(w)
        else: rows.append([y, [w]])
    out = []
    for _, ws in rows:
        ws.sort(key=lambda w: w[0]); s = ""; last = None
        for w in ws:
            if last is not None: s += " | " if w[0] - last > 12 else " "
            s += w[4]; last = w[2]
        out.append(s)
    return out

resumen = []
for cif in top:
    fs = sorted(g[cif], key=num); dig = [f for f in fs if inv[f]["chars"] > 200]; esc = [f for f in fs if inv[f]["chars"] <= 200]
    # 4 muestras repartidas en el año; 1 escaneo si lo hay y hay digitales
    base = dig if len(dig) >= 3 else fs
    k = 6 if len(dig) < 3 else 4
    idx = sorted({round(i * (len(base) - 1) / (k - 1)) for i in range(k)}) if len(base) > 1 else [0]
    mu = [base[i] for i in idx]
    if len(dig) >= 3 and esc: mu = mu[:3] + [esc[len(esc) // 2]]
    # también la factura con más páginas si no está
    largo = max(base, key=lambda f: inv[f]["pags"])
    if largo not in mu and inv[largo]["pags"] > 1: mu = mu[:3] + [largo] + mu[3:4]
    mu = mu[:6]
    d = f"{D}/fase2/{cif}"; os.makedirs(d + "/img", exist_ok=True)
    for f in mu:
        doc = pymupdf.open(SRC + f)
        if inv[f]["chars"] > 200:
            t = "\n".join(f"===== PAGINA {i+1}/{doc.page_count} =====\n" + "\n".join(lineas(p)) for i, p in enumerate(doc) if i < 6)
            open(f"{d}/{f[:-4]}.txt", "w", encoding="utf-8").write(t)
        else:
            for i, p in enumerate(doc):
                if i < 6: p.get_pixmap(dpi=150).save(f"{d}/img/{f[:-4]}_p{i+1}.png")
    # catálogo: líneas con importe de TODOS los digitales, sin números, por frecuencia
    cnt = collections.Counter(); ej = {}
    for f in dig:
        doc = pymupdf.open(SRC + f)
        for p in doc:
            for l in lineas(p):
                if re.search(r"\d+[.,]\d{2}\b", l) and re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}", l) and len(l) < 200:
                    k = re.sub(r"\s+", " ", re.sub(r"[\d.,/%€-]+", "#", l)).strip()
                    cnt[k] += 1
                    e = ej.setdefault(k, [])
                    if len(e) < 4 and all(l != x[1] for x in e): e.append((f, l))
    with open(f"{d}/catalogo_lineas.txt", "w", encoding="utf-8") as o:
        o.write(f"# Líneas con importe en los {len(dig)} PDF digitales del proveedor (agrupadas quitando números). veces | hasta 4 ejemplos reales distintos separados por || (fichero) — úsalos para el rango de precios\n")
        for k, n in cnt.most_common(450):
            o.write(f"{n:4} | " + "  ||  ".join(f"{t}   ({f})" for f, t in ej[k]) + chr(10))
    nombre = (collections.Counter(m[f]["proveedor"] for f in fs if m[f]["proveedor"]).most_common(1) or [("(sin nombre)",)])[0][0]
    json.dump({"cif": cif, "nombre": nombre, "categoria": cat(fs), "n_pdf": len(fs), "digitales": len(dig), "escaneos": len(esc), "muestras": mu}, open(d + "/info.json", "w", encoding="utf-8"), ensure_ascii=False)
    resumen.append((cif, nombre, cat(fs), len(fs), len(dig), len(esc), mu, len(cnt)))
for r in resumen: print(r[0], r[1][:38], r[2], f"pdf={r[3]} dig={r[4]} esc={r[5]}", "muestras", r[6], "lineas_cat", r[7])
