from comun import *
import difflib
lotes, sal, cat = load()
names={}
for it in sal:
    if 'nombre' in it: names[it['nombre']]=it['categoria_id']
for c in cat.values(): names['#%d %s'%(c['id'],c['nombre'])]=c['categoria_id']
byf=collections.defaultdict(list)
for n,c in names.items(): byf[c].append(n)
for c in sorted(byf):
    if c in (10,11,12,14): continue
    L=sorted(byf[c])
    for i in range(len(L)):
        a=norm(L[i]).lstrip('#0123456789 ')
        for j in range(i+1,len(L)):
            b=norm(L[j]).lstrip('#0123456789 ')
            wa=a.split()[:1]; wb=b.split()[:1]
            if wa!=wb and wa[0][:4]!=wb[0][:4]: continue
            r=difflib.SequenceMatcher(None,a,b).ratio()
            if r>0.72: print(c,'|',L[i],'||',L[j],'%.2f'%r)
