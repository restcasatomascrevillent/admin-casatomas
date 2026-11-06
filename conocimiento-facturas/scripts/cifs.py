import sys, os, re, json, collections
sys.path.insert(0, sys.argv[1]); import pymupdf
src, out = sys.argv[2], sys.argv[3]
CLIENTE = {"B54583356"}
L = "TRWAGMYFPDXBNJZSQVHLCKE"
def valido(c):
    if re.fullmatch(r"\d{8}[A-Z]", c): return L[int(c[:8]) % 23] == c[8]
    if re.fullmatch(r"[XYZ]\d{7}[A-Z]", c): return L[int("XYZ".index(c[0]).__str__() + c[1:8]) % 23] == c[8]
    m = re.fullmatch(r"([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])", c)
    if not m: return False
    d = m.group(2); s = sum(int(d[i]) for i in (1, 3, 5))
    for i in (0, 2, 4, 6):
        x = int(d[i]) * 2; s += x // 10 + x % 10
    ctrl = (10 - s % 10) % 10
    return m.group(3) in (str(ctrl), "JABCDEFGHI"[ctrl])
PAT = re.compile(r"(?<![A-Z0-9])(?:ES[\s\-]?)?(?:([ABCDEFGHJNPQRSUVWXYZ])[\s\.\-]{0,2}(\d{2})\.?(\d{3})\.?(\d{2}[0-9A-J])|(\d{8})[\s\-]?([A-Z]))(?![A-Z0-9])")
NOMBRES = {"MAKRO DISTRIBUCION MAYORISTA": "A28647451"}
def cifs(t):
    r = [c for n, c in NOMBRES.items() if n in t.upper()]
    for m in PAT.finditer(t.upper()):
        c = "".join(g for g in m.groups() if g)
        if len(c) == 9 and valido(c) and c not in CLIENTE: r.append(c)
    return r
inv = json.load(open(os.path.join(os.path.dirname(out), "inventario.json"), encoding="utf-8"))
res = {}
cand = {}
for x in inv:
    if x["chars"] <= 200: continue
    d = pymupdf.open(os.path.join(src, x["f"]))
    cand[x["f"]] = [collections.Counter(cifs(p.get_text())) for p in d]
    res[x["f"]] = {"pags": x["pags"], "cabecera": d[0].get_text()[:600].replace(chr(10), " ")}
glob = collections.Counter()
for pags in cand.values():
    for c in set(k for pc in pags for k in pc): glob[c] += 1
for f, pags in cand.items():
    por_pag = [max(pc, key=lambda k: (glob[k], pc[k])) if pc else None for pc in pags]
    tot = collections.Counter(c for c in por_pag if c)
    res[f]["cif"] = max(tot, key=lambda k: (tot[k], glob[k])) if tot else None
    res[f]["cifs_distintos"] = len(tot)
json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False)
con = [k for k, v in res.items() if v["cif"]]
print("digitales", len(res), "con CIF valido", len(con), "sin CIF", len(res) - len(con))
print("PDF con varios proveedores", sum(1 for v in res.values() if v["cifs_distintos"] > 1))
c = collections.Counter(v["cif"] for v in res.values() if v["cif"]); print("CIF distintos", len(c)); print(c.most_common(15))
