import sys, os, json
sys.path.insert(0, r"C:\Users\migue\AppData\Local\Temp\claude\5a2feb32f03e5f09\da67d530-328a-475d-915f-c23c8c95702b\scratchpad\pylib")
import warnings; warnings.filterwarnings("ignore")
import fitz
BASE = r"C:\Users\migue\Desktop\Oficiosos\codigo-restaurante\facturas-conocimiento\importar\pdf"
out = {}
for f in sorted(os.listdir(BASE)):
    try:
        d = fitz.open(os.path.join(BASE, f))
        out[f] = [p.get_text() for p in d]
    except Exception as e:
        out[f] = ["ERROR " + str(e)]
json.dump(out, open(r"C:\Users\migue\AppData\Local\Temp\claude\5a2feb32f03e5f09\da67d530-328a-475d-915f-c23c8c95702b\scratchpad\textos_pdf.json", "w", encoding="utf8"), ensure_ascii=False)
print(len(out))
