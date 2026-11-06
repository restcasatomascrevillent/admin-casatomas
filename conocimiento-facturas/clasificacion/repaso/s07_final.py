"""Aplica reglas.py sobre las 16 salidas y genera ../items_final.json + repaso/cambios.json + validación."""
import re
from comun import *
from reglas import R, MOVER, QUITAR_DUDA, NUEVA_DUDA

lotes, sal, cat = load()
CATS = {4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20}

def limpia(n):
    n = re.sub(r'(\d) L\b', r'\1 l', n)
    n = n.replace('Bacón', 'Bacon')
    return re.sub(r'\s+', ' ', n).strip()

# 1) estado inicial por texto
T = {}
for it in sal:
    key = '#%d' % it['producto_id'] if 'producto_id' in it else it['nombre']
    for t in it['textos']:
        T[t] = dict(orig=key, orig_cat=it.get('categoria_id') or cat[it['producto_id']]['categoria_id'],
                    dest=it.get('producto_id', it.get('nombre')), cat=it.get('categoria_id'),
                    unidad=it.get('unidad'), duda=it.get('duda'), lote=it['_lote'])
usadas_R, usadas_M = set(), set()
# 2) movimientos de textos concretos
for t, d in T.items():
    ej = lotes[t]['ejemplo']
    for i, (nom, patron, dest, c, u) in enumerate(MOVER):
        ok = ej.startswith(patron[:-1]) if patron.endswith('*') else ej == patron
        if d['orig'] == nom and ok:
            d.update(dest=dest, cat=c, unidad=u, movido=True)
            usadas_M.add(i)
# 3) renombres por producto
for t, d in T.items():
    if d.get('movido'):
        continue
    if d['orig'] in R:
        dest, c = R[d['orig']]
        usadas_R.add(d['orig'])
        d['dest'] = dest
        if isinstance(dest, int):
            d['cat'] = None
        elif c is not None:
            d['cat'] = c
faltan_R = [k for k in R if k not in usadas_R]
faltan_M = [MOVER[i] for i in range(len(MOVER)) if i not in usadas_M]
print('reglas sin usar:', faltan_R, faltan_M)

# 4) agrupar
G = collections.OrderedDict()
for t, d in T.items():
    if isinstance(d['dest'], int):
        k = ('pid', d['dest'])
    else:
        d['dest'] = limpia(d['dest'])
        k = ('nom', d['dest'])
    G.setdefault(k, []).append(t)

items, problemas = [], []
catnorm = {norm(c['nombre']): c['id'] for c in cat.values()}
for (tipo, v), ts in G.items():
    ds = [T[t] for t in ts]
    ts_sorted = sorted(ts, key=lambda t: -(lotes[t]['gasto'] or 0))
    dudas = sorted({d['duda'] for d in ds if d.get('duda')})
    if tipo == 'pid':
        it = {'textos': ts_sorted, 'producto_id': v}
        fam = cat[v]['categoria_id']
        clave_duda = '#%d' % v
    else:
        cs = {d['cat'] for d in ds}
        if len(cs) != 1:
            problemas.append(('familias distintas', v, cs))
        fam = cs.pop()
        it = {'textos': ts_sorted, 'nombre': v, 'categoria_id': fam}
        us = [(lotes[t]['gasto'] or 0, d['unidad']) for t, d in zip(ts, ds) if d.get('unidad')]
        if us:
            it['unidad'] = max(us, key=lambda x: x[0])[1]
        clave_duda = v
        if norm(v) in catnorm:
            problemas.append(('nombre igual a catálogo', v))
    if clave_duda in NUEVA_DUDA:
        it['duda'] = NUEVA_DUDA[clave_duda]
    elif dudas and clave_duda not in QUITAR_DUDA:
        it['duda'] = ' | '.join(dudas)
    it['_fam'] = fam
    items.append(it)

# 5) validación
cnt = collections.Counter(t for it in items for t in it['textos'])
assert set(cnt) == set(lotes) and all(c == 1 for c in cnt.values()), 'cobertura'
fam_por_nombre = collections.defaultdict(set)
for it in items:
    if 'producto_id' in it:
        assert it['producto_id'] in cat, it
    else:
        assert it['categoria_id'] in CATS, it
        assert 1 <= len(it['nombre']) <= 200, it
        fam_por_nombre[norm(it['nombre'])].add(it['categoria_id'])
dobles = {k: v for k, v in fam_por_nombre.items() if len(v) > 1}
assert not dobles, dobles
nombres_rep = [k for k, v in collections.Counter(norm(it['nombre']) for it in items if 'nombre' in it).items() if v > 1]
assert not nombres_rep, nombres_rep
print('problemas:', problemas)

items.sort(key=lambda it: (it['_fam'], norm(it.get('nombre') or cat[it.get('producto_id')]['nombre'])))
out = []
for it in items:
    o = {'textos': it['textos']}
    if 'producto_id' in it:
        o['producto_id'] = it['producto_id']
    else:
        o['nombre'] = it['nombre']; o['categoria_id'] = it['categoria_id']
        if it.get('unidad'): o['unidad'] = it['unidad']
    if it.get('duda'): o['duda'] = it['duda']
    out.append(o)
json.dump(out, open(B + '/items_final.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
json.loads(open(B + '/items_final.json', encoding='utf-8').read())

# 6) datos para el informe
def nombre_dest(d):
    return '#%d %s' % (d['dest'], cat[d['dest']]['nombre']) if isinstance(d['dest'], int) else d['dest']
def fam_dest(d):
    return cat[d['dest']]['categoria_id'] if isinstance(d['dest'], int) else d['cat']
def nombre_orig(o):
    return '#%s %s' % (o[1:], cat[int(o[1:])]['nombre']) if o.startswith('#') else o
cambios = collections.defaultdict(lambda: {'origenes': set(), 'fam': None, 'n': 0, 'gasto': 0})
famcamb = []
for t, d in T.items():
    nd = nombre_dest(d)
    c = cambios[nd]; c['origenes'].add(nombre_orig(d['orig'])); c['fam'] = fam_dest(d); c['n'] += 1; c['gasto'] += lotes[t]['gasto'] or 0
    if fam_dest(d) != d['orig_cat']:
        famcamb.append((nombre_orig(d['orig']), d['orig_cat'], nd, fam_dest(d), lotes[t]['ejemplo'], lotes[t]['gasto']))
uniones = {k: v for k, v in cambios.items() if len(v['origenes']) > 1 or list(v['origenes'])[0] != k}
gasto_fam = collections.Counter(); textos_fam = collections.Counter(); prod_fam = collections.Counter()
for it in items:
    g = sum(lotes[t]['gasto'] or 0 for t in it['textos'])
    gasto_fam[it['_fam']] += g; textos_fam[it['_fam']] += len(it['textos']); prod_fam[it['_fam']] += 1
json.dump({'uniones': {k: {'origenes': sorted(v['origenes']), 'fam': v['fam'], 'n': v['n'], 'gasto': round(v['gasto'], 2)} for k, v in uniones.items()},
           'familia_cambiada': famcamb,
           'gasto_fam': {k: round(v, 2) for k, v in gasto_fam.items()}, 'textos_fam': textos_fam, 'prod_fam': prod_fam},
          open(B + '/repaso/cambios.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

n_pid = sum('producto_id' in it for it in out)
n_new = sum('nombre' in it for it in out)
print('items', len(out), 'con producto_id', n_pid, '(productos de catálogo distintos', len({it['producto_id'] for it in out if 'producto_id' in it}), ')',
      'nombres nuevos', n_new, 'dudas', sum('duda' in it for it in out), 'textos', sum(len(it['textos']) for it in out))
print('uniones/renombres', len(uniones), 'textos con familia cambiada', len(famcamb))
for k in sorted(gasto_fam): print(k, FAM[k], prod_fam[k], textos_fam[k], round(gasto_fam[k], 2))
print('total gasto', round(sum(gasto_fam.values()), 2))
