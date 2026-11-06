# Lista las diferencias entre correcciones/originales/*.json y importar/json/*.json
import json, os, sys
B = r"C:\Users\migue\Desktop\Oficiosos\codigo-restaurante\facturas-conocimiento"
def plano(x, pre=""):
    out = {}
    if isinstance(x, dict):
        for k, v in x.items(): out.update(plano(v, f"{pre}.{k}" if pre else k))
    elif isinstance(x, list):
        for i, v in enumerate(x): out.update(plano(v, f"{pre}[{i}]"))
    else: out[pre] = x
    return out
for f in sorted(os.listdir(B + r"\correcciones\originales")):
    if not f.endswith(".json") or not f.startswith("zip2026"): continue
    a = plano(json.load(open(B + r"\correcciones\originales\\" + f, encoding="utf8")))
    b = plano(json.load(open(B + r"\importar\json\\" + f, encoding="utf8")))
    for k in sorted(set(a) | set(b)):
        if a.get(k, "∅") != b.get(k, "∅"):
            print(f, k, repr(a.get(k, "∅"))[:90], "->", repr(b.get(k, "∅"))[:140])
