from comun import *
import sys
lotes, sal, cat = load()
F=json.load(open(B+'/items_final.json',encoding='utf-8'))
pat=re.compile(sys.argv[1], re.I)
for it in F:
    nm=it.get('nombre') or '#%d %s'%(it['producto_id'],cat[it['producto_id']]['nombre'])
    fam=it.get('categoria_id') or cat[it['producto_id']]['categoria_id']
    if not pat.search(norm(nm)): continue
    g=sum(lotes[t]['gasto'] or 0 for t in it['textos'])
    print('%s [%d] %d textos, %.0f€%s'%(nm,fam,len(it['textos']),g,' DUDA' if 'duda' in it else ''))
    if len(sys.argv)>2:
        for t in it['textos']:
            l=lotes[t]; print('    · %s — %s €/%s'%(l['ejemplo'][:60],l['precio'],l['unidad']))
