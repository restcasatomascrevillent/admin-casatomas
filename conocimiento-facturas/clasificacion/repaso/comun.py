import json, glob, os, collections, unicodedata, re
B = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = os.path.join(B,'repaso')
def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii','ignore').decode().lower()
    return re.sub(r'\s+',' ', s).strip()
def load():
    lotes = {}
    for f in sorted(glob.glob(B+'/lotes/lote*.json')):
        for r in json.load(open(f,encoding='utf-8')):
            r['_lote']=os.path.basename(f); lotes[r['t']]=r
    sal=[]
    for f in sorted(glob.glob(B+'/salida/lote*.json')):
        for it in json.load(open(f,encoding='utf-8')):
            it['_lote']=os.path.basename(f); sal.append(it)
    cat={c['id']:c for c in json.load(open(B+'/catalogo_actual.json',encoding='utf-8'))}
    return lotes, sal, cat
FAM={4:'Lácteos y huevos',5:'Frutas y verduras',6:'Despensa',7:'Panadería y repostería',8:'Congelados',9:'Limpieza y desechables',10:'Menaje y equipamiento',11:'Servicios',12:'Vinos',13:'Cervezas',14:'Licores',15:'Refrescos y aguas',16:'Café e infusiones',17:'Pescado',18:'Marisco',19:'Carne',20:'Embutidos e ibéricos'}
