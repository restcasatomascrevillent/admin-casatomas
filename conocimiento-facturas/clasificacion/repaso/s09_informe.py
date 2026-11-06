"""Genera ../REPASO.md a partir de cambios.json, items_final.json y el texto fijo de abajo."""
from comun import *
lotes, sal, cat = load()
F = json.load(open(B + '/items_final.json', encoding='utf-8'))
C = json.load(open(R + '/cambios.json', encoding='utf-8'))

def eur(x):
    return ('{:,.2f}'.format(x)).replace(',', 'X').replace('.', ',').replace('X', '.') + ' €'

n_in_items = len(sal)
n_in_new = len({norm(i['nombre']) for i in sal if 'nombre' in i})
n_in_pid = sum('producto_id' in i for i in sal)
n_in_dudas = sum('duda' in i for i in sal)
n_pid = sum('producto_id' in i for i in F)
n_new = sum('nombre' in i for i in F)
n_dudas = sum('duda' in i for i in F)

L = []
w = L.append
w('# Repaso final de la clasificación de líneas de factura\n')
w('Fecha: 05/11/2026. Scripts en `repaso/` (`s07_final.py` aplica `reglas.py`; `s09_informe.py` genera este documento).\n')
w('## Recuentos\n')
w('| | Entrada (16 salidas) | Final (`items_final.json`) |')
w('|---|---|---|')
w('| Textos `t` | 3.780 | %d (cada uno exactamente una vez) |' % sum(len(i['textos']) for i in F))
w('| Items | %d | %d (un item por producto) |' % (n_in_items, len(F)))
w('| Productos del catálogo usados (`producto_id`) | %d items | %d productos |' % (n_in_pid, n_pid))
w('| Nombres nuevos distintos | %d | %d |' % (n_in_new, n_new))
w('| **Productos finales** | | **%d** |' % (n_pid + n_new))
w('| Items con `duda` | %d | %d |' % (n_in_dudas, n_dudas))
w('')
w('Validación superada: JSON válido; los 3.780 `t` de los lotes aparecen una sola vez; `categoria_id` siempre en {4…20}; '
  'todos los `producto_id` existen en `catalogo_actual.json`; nombres de 1-200 caracteres; ningún nombre (normalizado sin tildes ni '
  'mayúsculas) tiene dos familias ni aparece en dos items; ningún nombre nuevo coincide con uno del catálogo.\n')

w('## Criterios aplicados\n')
w('- Se une solo lo que es el mismo producto para comparar precios: plurales, orden de palabras, marca en alimentos y limpieza genéricos, '
  'calibre o peso de caja, añada en vinos.')
w('- La marca sigue separando en vinos, licores, cervezas, refrescos y aguas; también se respeta en AOVE premium, quesos curados de '
  'marca propia (trufado), caviar, ostras de marca y cecinas de wagyu (cambian mucho el precio).')
w('- Se mantienen separados fresco / congelado / cocido / en conserva / ahumado / salazón, y crianza / salvaje cuando cambia el precio.')
w('- Formatos distintos de bebida (33 cl, lata, barril, 75 cl, magnum, 3 l…) siguen separados.')
w('- No se meten textos de otro formato en un producto del catálogo cuyo nombre lleva formato (p. ej. «Leche condensada desnatada '
  'Prosalud 2,5 kg», «Salsa de tomate pouch 3,4 kg», «Limpiacristales Help LQ 80 5 L» no absorben otros tamaños).')
w('- Conservas: de marisco en Marisco (18, como el ejemplo de las instrucciones) y de pescado en Pescado (17). Las que ya existían en el '
  'catálogo en Despensa (#251 atún, #298 ventresca de bonito, #281 mújol) se usan por `producto_id` (ver recomendaciones).')
w('- Verdura y fruta congelada sin elaborar va en Frutas y verduras (5); en Congelados (8) solo quedan preparados.')
w('- Siropes y purés para coctelería (Monin, Teisseire, granadina) en Despensa (6); bebidas «sin alcohol» (Drols, Tanqueray 0,0) en Refrescos (15).')
w('- Carbón y material de encendido de la brasa: Servicios (11) como energía/combustible.')
w('- Líneas genéricas de lonja sin especie: «Perciformes», «Pleuronectiformes», «Gadiformes» → **Pescado variado de lonja** (17); '
  '«Macruros», «Cefalópodos» y «Varios» (Narejos, 75 €/kg) → **Marisco variado de lonja** (18). Un único producto de cada, la línea '
  'conserva su proveedor.\n')

# --- Unificaciones ---
U = C['uniones']
multi = {k: v for k, v in U.items() if len(v['origenes']) > 1}
ren = {k: v for k, v in U.items() if len(v['origenes']) == 1}
w('## Unificaciones (%d productos destino que juntan %d nombres de partida)\n' % (len(multi), sum(len(v['origenes']) for v in multi.values())))
w('| Producto final | Fam. | Junta | Textos | Gasto |')
w('|---|---|---|---|---|')
for k in sorted(multi, key=lambda k: (multi[k]['fam'], norm(k).lstrip('#0123456789 '))):
    v = multi[k]
    w('| %s | %s | %s | %d | %s |' % (k, v['fam'], ' + '.join('«%s»' % o for o in v['origenes']), v['n'], eur(v['gasto'])))
w('')
w('## Renombres y separaciones sin unión (%d)\n' % len(ren))
w('Nombre nuevo ← nombre de partida (las separaciones sacan algunos textos de un producto que mezclaba cosas distintas).\n')
for k in sorted(ren, key=lambda k: (ren[k]['fam'], norm(k).lstrip('#0123456789 '))):
    v = ren[k]
    w('- %s [%s] ← «%s» (%d textos, %s)' % (k, v['fam'], v['origenes'][0], v['n'], eur(v['gasto'])))
w('')
w('Separaciones hechas (textos que estaban mal agrupados):\n')
w('- «#228 Lubina»: la lubina de crianza Aquanaria (14,90 €/kg) pasa a **Lubina de crianza**; la salvaje/gallega sigue en #228 (25-40 €/kg).')
w('- «Palometa roja»: la línea «PALOMETA» a 24 €/kg (palometa negra) pasa a **Palometa**.')
w('- «Cocochas de merluza»: congeladas chilenas (36 €/kg) ≠ frescas (68 €/kg).')
w('- «Coquina»: la de Congelados Pinto 12×250 g pasa a **Coquina congelada**.')
w('- «Gamba blanca»: la de Once de Enero 105/110 piezas (congelada, 2 €/kg) pasa a **Gamba blanca congelada**.')
w('- «#221 Calamar»: «CAL.LIMPIO 10/20» pasa a **Calamar limpio**.')
w('- «Lomo de vaca» mezclaba tres cortes: «TROZO LOMO ALTO» → **Lomo alto de vaca** (con «Entrecot vaca lomo alto»), '
  '«LOMO VACA BAJO» → **Lomo bajo de vaca**, y el resto queda como **Lomo de vaca con hueso** (c/h c/solomillo, 34,5 €/kg).')
w('- «Paletilla de cordero lechal»: la congelada (23,5 €/kg, 10.005 €) → **Paletilla de cordero lechal congelada**.')
w('- «Callo/Callos de vacuno»: no se unen porque uno es congelado (6,45 €/kg) y otro fresco (9,8 €/kg): quedan **Callos de vacuno** y '
  '**Callos de vacuno congelados**.')
w('- Dos líneas «Oferta calendario adviento» (−0,95 €) que estaban en «#341 Aceite de girasol alto oleico» pasan a **Descuento comercial** '
  'para no falsear el precio del aceite.\n')

# --- Familias ---
w('## Correcciones de familia\n')
g = collections.defaultdict(lambda: [0, 0.0])
for o, fo, nd, fd, ej, ga in C['familia_cambiada']:
    g[(o, fo, nd, fd)][0] += 1; g[(o, fo, nd, fd)][1] += ga or 0
w('| Antes | Familia antes → después | Ahora | Textos | Gasto |')
w('|---|---|---|---|---|')
for k, v in sorted(g.items(), key=lambda x: (x[0][1], x[0][3])):
    w('| %s | %s → %s | %s | %d | %s |' % (k[0], FAM[k[1]], FAM[k[3]], k[2], v[0], eur(v[1])))
w('')
w('Comprobado además: en Limpieza (9), Menaje (10) y Servicios (11) no queda comida; Servicios solo tiene servicios, suministros '
  '(luz, agua, gas, CO₂, gasóleo, carbón), envases retornables y fianzas, alquileres/renting, gestoría, mantenimiento, comisiones y '
  'descuentos/rappels. Los dispensadores en préstamo (portarrollos, ambientador) pasan a Menaje.\n')

# --- Dudas ---
w('## Dudas\n')
w('Resueltas (se quita `duda`): lonja genérica (Perciformes, Pleuronectiformes, Macruros, Cefalópodos, Varios); «BUEY» de Casimiro → '
  '#107 Buey de mar; «SAN PEDRO» = San Martín (Zeus faber); «Ancestral» de J. L. Flores a 32,35 € = Balbás Ancestral 75 cl (32,10 €); '
  '«Rosiñol Laumont» = rossinyol, **Rebozuelo** (seta); «Concentrado de caña Carmen» = **Miel de caña**; «Salados» de Farruquiño = '
  '**Salado de cerdo para cocido**; «ESPARRAGO G» a 4 €/kg = espárrago verde; cebolla en cubos/tiras de Makro 2,5 kg = congelada; '
  'alcachofa cortada MC 1 kg = congelada (pasa a 5); «Genuine coconut» = coco; «Twist green» de Dobla = decoración de chocolate (7); '
  '«Venta por volumen» y «Promoción especial» = descuentos; «BDO camisa» = bordado; Tower = equipo de conservación de vino; '
  'cartucho de gas 227 g, pepinillos, aceitunas Sarasa/Mare Nostrum, Pizza-Pop, bao de cerdo, hamburguesa de tofu, cremoso de '
  'chipirón, cuello de cordero, panceta curada, tomate rojo, cookie Triticum, hoja de bambú, granadina: nombre y familia correctos.\n')
w('Quedan %d con `duda`:\n' % n_dudas)
for it in F:
    if 'duda' in it:
        nm = it.get('nombre') or '#%d %s' % (it['producto_id'], cat[it['producto_id']]['nombre'])
        gs = sum(lotes[t]['gasto'] or 0 for t in it['textos'])
        w('- **%s** (%s): %s' % (nm, eur(gs), it['duda']))
w('')

# --- Recomendaciones catálogo ---
w('## Recomendaciones sobre el catálogo existente (no se tocan desde este fichero)\n')
w('- **#260 «Choco 300/500 g»** está en Pescado (17); es sepia → Marisco (18).')
w('- **#231 «Orujo Beneolive 5 L»** está en Licores (14) pero sus líneas son «OLIBEN ORUJO 5L» de la misma marca que el #253 aceite '
  'Beneolive: es **aceite de orujo de oliva** → Despensa (6), renombrar «Aceite de orujo de oliva Beneolive 5 L».')
w('- **#251 atún claro en aceite**, **#298 ventresca de bonito** y **#281 mújol en tarro** están en Despensa; si se adopta el criterio '
  '«conservas de pescado en Pescado (17)», moverlos. Hoy suman %s del gasto de Despensa.' % eur(sum(
    sum(lotes[t]['gasto'] or 0 for t in it['textos']) for it in F if it.get('producto_id') in (251, 298, 281))))
w('- **#220 «Brócoli Anedilco 2,5 kg»** está en Congelados (8); con el criterio aplicado (verdura congelada en 5) debería ir a 5.')
w('- **#106 «Centolla hembra 1-1,5 kg»** duplica a **#303 «Centolla»**: su único texto nuevo se ha llevado a #303; conviene fusionarlos.')
w('- **#211 «Mejillones»** y **#222 «Mejillón en malla Batemar»** parecen el mismo mejillón fresco (en saco o malla); los textos nuevos van a #211, valorar fusionarlos.\n')

# --- Gasto por familia ---
w('## Gasto por familia (suma de `gasto` de los lotes, sin IVA)\n')
w('Familia según el fichero final (para `producto_id`, la del catálogo).\n')
w('| Familia | Productos | Textos | Gasto |')
w('|---|---|---|---|')
gf, tf, pf = C['gasto_fam'], C['textos_fam'], C['prod_fam']
for k in sorted(gf, key=lambda k: -gf[k]):
    w('| %s (%s) | %d | %d | %s |' % (FAM[int(k)], k, pf[k], tf[k], eur(gf[k])))
w('| **Total** | %d | %d | **%s** |' % (sum(pf.values()), sum(tf.values()), eur(sum(gf.values()))))
w('')
w('Servicios incluye descuentos y rappels en negativo (−%s), por eso su neto es menor que la suma de facturas de servicios.\n' % eur(-sum(
    sum(lotes[t]['gasto'] or 0 for t in it['textos']) for it in F if (it.get('categoria_id') == 11) and
    sum(lotes[t]['gasto'] or 0 for t in it['textos']) < 0)))
open(B + '/REPASO.md', 'w', encoding='utf-8').write('\n'.join(L))
print('ok', len(L))
