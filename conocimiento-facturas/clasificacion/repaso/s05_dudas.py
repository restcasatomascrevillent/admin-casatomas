from comun import *
lotes, sal, cat = load()
for it in sal:
    if 'duda' in it:
        nm=it.get('nombre') or '#%d'%it['producto_id']
        print('##',nm,'|',it.get('categoria_id'),'|',it['duda'][:160])
        for t in it['textos'][:3]:
            l=lotes[t]; print('     ',l['ejemplo'][:70],l['precio'],l['unidad'],l['gasto'],(l['proveedores'] or ['?'])[0][:30])
