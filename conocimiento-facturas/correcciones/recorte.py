# Uso: python -I -X utf8 recorte.py R594.pdf pagina y0 y1 [dpi] [x0 x1]  (fracciones 0-1 de la página)
import sys
sys.path.insert(0, r"C:\Users\migue\AppData\Local\Temp\claude\5a2feb32f03e5f09\da67d530-328a-475d-915f-c23c8c95702b\scratchpad\pylib")
import warnings; warnings.filterwarnings("ignore")
import fitz
BASE = r"C:\Users\migue\Desktop\Oficiosos\codigo-restaurante\facturas-conocimiento\importar\pdf\\"
IMG = r"C:\Users\migue\Desktop\Oficiosos\codigo-restaurante\facturas-conocimiento\correcciones\img\\"
f, p, y0, y1 = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
dpi = int(sys.argv[5]) if len(sys.argv) > 5 else 120
x0 = float(sys.argv[6]) if len(sys.argv) > 6 else 0; x1 = float(sys.argv[7]) if len(sys.argv) > 7 else 1
pg = fitz.open(BASE + f)[p - 1]
r = pg.rect
clip = fitz.Rect(r.x0 + r.width * x0, r.y0 + r.height * y0, r.x0 + r.width * x1, r.y0 + r.height * y1)
out = IMG + f.replace('.pdf', '') + f"_p{p}_{int(y0*100)}-{int(y1*100)}.png"
pg.get_pixmap(dpi=dpi, clip=clip).save(out)
print(out)
