from comun import *
lotes, sal, cat = load()
STOP={'de','del','la','el','las','los','en','con','y','al','a','para','x'}
def sing(w):
    if len(w)>4 and w.endswith('es') and w[-3] in 'lnrdz': return w[:-2]
    if len(w)>3 and w.endswith('s'): return w[:-1]
    return w
def key(n):
    ws=[sing(w) for w in re.findall(r'[a-z0-9]+', norm(n)) if w not in STOP]
    return ' '.join(sorted(ws))
names=collections.defaultdict(lambda: {'cats':set(),'g':0,'n':0,'l':set()})
for it in sal:
    if 'nombre' in it:
        d=names[it['nombre']]; d['cats'].add(it['categoria_id']); d['l'].add(it['_lote'][4:6])
        for t in it['textos']: d['g']+=lotes[t]['gasto'] or 0; d['n']+=1
groups=collections.defaultdict(list)
for n in names: groups[key(n)].append(n)
for c in cat.values(): groups[key(c['nombre'])].append('#%d %s'%(c['id'],c['nombre']))
for k,v in groups.items():
    if len(v)>1: print(' || '.join('%s[%s]'%(x, ','.join(map(str,names[x]['cats'])) if x in names else 'cat') for x in v))
