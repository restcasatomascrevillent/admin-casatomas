from comun import *
import sys
lotes, sal, cat = load()
fams=[int(x) for x in sys.argv[1].split(',')]
det = len(sys.argv)>2
names=collections.defaultdict(list)
for it in sal:
    c=it.get('categoria_id') or cat[it['producto_id']]['categoria_id']
    if c not in fams: continue
    nm=it.get('nombre') or '#%d %s'%(it['producto_id'],cat[it['producto_id']]['nombre'])
    names[(c,nm)].append(it)
for (c,nm) in sorted(names, key=lambda x:(x[0],norm(x[1]).lstrip('#0123456789 '))):
    its=names[(c,nm)]
    ts=[lotes[t] for it in its for t in it['textos']]
    g=sum(x['gasto'] or 0 for x in ts)
    d=' D' if any('duda' in i for i in its) else ''
    if det:
        print('%d %s [%.0f€]%s'%(c,nm,g,d))
        for x in ts: print('    %s | %s %s | %s'%(x['ejemplo'][:60],x['precio'],x['unidad'],(x['proveedores'] or ['?'])[0][:20]))
    else:
        ex='; '.join('%s %s/%s'%(x['ejemplo'][:38],x['precio'],x['unidad']) for x in ts[:3])
        print('%d %s [%d|%.0f€]%s :: %s'%(c,nm,len(ts),g,d,ex))
