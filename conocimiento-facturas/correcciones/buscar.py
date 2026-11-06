import sys, json, re
T = json.load(open(r"C:\Users\migue\AppData\Local\Temp\claude\5a2feb32f03e5f09\da67d530-328a-475d-915f-c23c8c95702b\scratchpad\textos_pdf.json", encoding="utf8"))
for pat in sys.argv[1:]:
    r = re.compile(pat, re.I)
    for f, pags in T.items():
        for i, t in enumerate(pags):
            for m in r.finditer(t):
                s = t[max(0, m.start()-80):m.end()+80].replace("\n", " | ")
                print(f"[{pat}] {f} p{i+1}: ...{s}...")
