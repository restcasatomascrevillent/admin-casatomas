import json, glob, os, collections, unicodedata, re
B = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii','ignore').decode().lower()
    return re.sub(r'\s+',' ', s).strip()
lotes = {}
for f in sorted(glob.glob(B+'/lotes/lote*.json')):
    k=os.path.basename(f)
    for r in json.load(open(f,encoding='utf-8')):
        lotes.setdefault(r['t'],[]).append((k,r))
sal = []
for f in sorted(glob.glob(B+'/salida/lote*.json')):
    k=os.path.basename(f)
    for it in json.load(open(f,encoding='utf-8')):
        it['_lote']=k; sal.append(it)
print('textos lote', sum(len(v) for v in lotes.values()), 'unicos', len(lotes))
dup=[t for t,v in lotes.items() if len(v)>1]; print('t duplicados en lotes', len(dup), dup[:5])
cnt=collections.Counter(t for it in sal for t in it['textos'])
print('items', len(sal), 'textos en salida', sum(cnt.values()))
print('faltan', [t for t in lotes if t not in cnt][:20], len([t for t in lotes if t not in cnt]))
print('sobran', [t for t in cnt if t not in lotes][:20], len([t for t in cnt if t not in lotes]))
print('repetidos', [(t,c) for t,c in cnt.items() if c>1][:20], len([t for t,c in cnt.items() if c>1]))
keys=collections.Counter(tuple(sorted(k for k in it if k!='_lote')) for it in sal); print(keys)
cat=json.load(open(B+'/catalogo_actual.json',encoding='utf-8'))
ids={c['id'] for c in cat}
print('pid invalidos', [it for it in sal if 'producto_id' in it and it['producto_id'] not in ids][:5])
print('nombres', len({norm(it['nombre']) for it in sal if 'nombre' in it}), 'con pid', sum('producto_id' in it for it in sal), 'dudas', sum('duda' in it for it in sal))
print(collections.Counter(it.get('categoria_id') for it in sal))
