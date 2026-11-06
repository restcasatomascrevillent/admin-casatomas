# Uso: python -I -X utf8 pdf.py R153.pdf [pagina(1-based)] [png]
import sys
sys.path.insert(0, r"C:\Users\migue\AppData\Local\Temp\claude\5a2feb32f03e5f09\da67d530-328a-475d-915f-c23c8c95702b\scratchpad\pylib")
import fitz
BASE = r"C:\Users\migue\Desktop\Oficiosos\codigo-restaurante\facturas-conocimiento\importar\pdf\\"
IMG = r"C:\Users\migue\Desktop\Oficiosos\codigo-restaurante\facturas-conocimiento\correcciones\img\\"
f = sys.argv[1]
doc = fitz.open(BASE + f)
pags = [int(sys.argv[2])] if len(sys.argv) > 2 and sys.argv[2] != '0' else range(1, doc.page_count + 1)
png = len(sys.argv) > 3
print(f"== {f}: {doc.page_count} páginas")
for p in pags:
    pg = doc[p - 1]
    t = pg.get_text()
    print(f"--- página {p} ({len(t)} car.)")
    print(t)
    if png or len(t.strip()) < 30:
        out = IMG + f.replace('.pdf', '') + f"_p{p}.png"
        pg.get_pixmap(dpi=150).save(out)
        print("PNG:", out)
