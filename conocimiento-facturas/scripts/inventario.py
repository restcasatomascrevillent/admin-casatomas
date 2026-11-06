import sys, os, hashlib, json, collections
sys.path.insert(0, sys.argv[1]); import pymupdf
d = sys.argv[2]; out = []
for f in sorted(os.listdir(d)):
    p = os.path.join(d, f); b = open(p,'rb').read()
    try:
        doc = pymupdf.open(p); n = doc.page_count
        txt = "".join(pg.get_text() for pg in doc)
        imgs = sum(len(pg.get_images()) for pg in doc)
        prod = (doc.metadata or {}).get('producer','') or ''
    except Exception as e:
        n, txt, imgs, prod = -1, '', 0, 'ERROR '+str(e)[:60]
    out.append(dict(f=f, kb=len(b)//1024, sha=hashlib.sha1(b).hexdigest(), pags=n, chars=len(txt.strip()), imgs=imgs, prod=prod[:40], txt=txt[:1500]))
json.dump(out, open(sys.argv[3],'w',encoding='utf-8'), ensure_ascii=False)
pags = collections.Counter(min(o['pags'],6) for o in out)
print('docs', len(out), 'paginas totales', sum(max(o['pags'],0) for o in out))
print('paginas/doc (6=6+):', sorted(pags.items()))
tipo = collections.Counter('texto' if o['chars']>200 else ('poco texto' if o['chars']>0 else 'solo imagen') for o in out)
print('capa de texto:', tipo.most_common())
dup = collections.Counter(o['sha'] for o in out); print('duplicados exactos:', sum(v-1 for v in dup.values() if v>1))
print('errores:', [o['f'] for o in out if o['pags']<0][:10])
print('productores:', collections.Counter(o['prod'] for o in out).most_common(12))
