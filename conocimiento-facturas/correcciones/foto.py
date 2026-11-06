# Uso: foto.py indice y0 y1 [ancho_px] [x0 x1] -> recorte de una foto de Desktop/Oficiosos/facturas
import sys, os
sys.path.insert(0, r"C:\Users\migue\AppData\Local\Temp\claude\5a2feb32f03e5f09\da67d530-328a-475d-915f-c23c8c95702b\scratchpad\pylib")
import warnings; warnings.filterwarnings("ignore")
import fitz
D = r"C:\Users\migue\Desktop\Oficiosos\facturas"
fs = sorted(os.listdir(D))
i, y0, y1 = int(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
ancho = int(sys.argv[4]) if len(sys.argv) > 4 else 1400
x0 = float(sys.argv[5]) if len(sys.argv) > 5 else 0; x1 = float(sys.argv[6]) if len(sys.argv) > 6 else 1
pix = fitz.Pixmap(os.path.join(D, fs[i]))
W, H = pix.width, pix.height
doc = fitz.open(); pg = doc.new_page(width=W, height=H)
pg.insert_image(pg.rect, filename=os.path.join(D, fs[i]))
clip = fitz.Rect(W*x0, H*y0, W*x1, H*y1)
zoom = ancho / clip.width
out = r"C:\Users\migue\Desktop\Oficiosos\codigo-restaurante\facturas-conocimiento\correcciones\img\foto%d_%d-%d.png" % (i, int(y0*100), int(y1*100))
pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip).save(out)
print(fs[i], W, H, out)
