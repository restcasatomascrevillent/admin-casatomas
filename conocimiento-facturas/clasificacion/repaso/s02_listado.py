from comun import *
lotes, sal, cat = load()
# conflictos de familia por nombre
by=collections.defaultdict(list)
for it in sal:
    if 'nombre' in it: by[norm(it['nombre'])].append(it)
conf=[(k,{(i['categoria_id']) for i in v}) for k,v in by.items() if len({i['categoria_id'] for i in v})>1]
print('conflictos familia', len(conf)); [print(' ',c) for c in conf]
# nombre que coincide con catalogo
cn={norm(c['nombre']):c for c in cat.values()}
m=[(k, cn[k]['id']) for k in by if k in cn]
print('nombres == catalogo', len(m), m[:40])
# listado por familia
out=open(R+'/listado.txt','w',encoding='utf-8')
rows=[]
for it in sal:
    for t in it['textos']:
        l=lotes[t]
        nm = it.get('nombre') or ('#%d %s'%(it['producto_id'],cat[it['producto_id']]['nombre']))
        c = it.get('categoria_id') or cat[it['producto_id']]['categoria_id']
        rows.append((c,norm(nm),nm,l['ejemplo'][:70],l['unidad'],l['precio'],l['n'],l['gasto'],(l['proveedores'] or ['?'])[0][:22],it['_lote'][4:6],'D' if 'duda' in it else ''))
rows.sort()
for r in rows: out.write('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n'%(r[0],r[2],r[3],r[4],r[5],r[6],r[7],r[8],r[9],r[10]))
print(len(rows))
