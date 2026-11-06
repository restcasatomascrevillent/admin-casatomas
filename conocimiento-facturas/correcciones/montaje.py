import sys, os
sys.path.insert(0, r"C:\Users\migue\AppData\Local\Temp\claude\5a2feb32f03e5f09\da67d530-328a-475d-915f-c23c8c95702b\scratchpad\pylib")
import warnings; warnings.filterwarnings("ignore")
import fitz
D = r"C:\Users\migue\Desktop\Oficiosos\facturas"
fs = sorted(os.listdir(D))
cols, w, h = 5, 300, 420
doc = fitz.open(); pg = doc.new_page(width=cols*w, height=((len(fs)+cols-1)//cols)*(h+20))
for i, f in enumerate(fs):
    x, y = (i % cols) * w, (i // cols) * (h + 20)
    pg.insert_image(fitz.Rect(x, y + 20, x + w - 5, y + h + 15), filename=os.path.join(D, f))
    pg.insert_text((x + 5, y + 14), str(i), fontsize=14)
pg.get_pixmap(dpi=60).save(r"C:\Users\migue\Desktop\Oficiosos\codigo-restaurante\facturas-conocimiento\correcciones\img\montaje_whatsapp.png")
for i, f in enumerate(fs): print(i, f)
