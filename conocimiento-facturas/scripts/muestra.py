import sys, os, json, random
sys.path.insert(0, sys.argv[1]); import pymupdf
inv = json.load(open(sys.argv[2], encoding='utf-8')); src = sys.argv[3]; out = sys.argv[4]
random.seed(7)
dig = [x for x in inv if x['chars'] > 200]; esc = [x for x in inv if x['chars'] <= 200]
def pick(pool, buckets):
    sel = []
    for (lo, hi), n in buckets:
        c = [x for x in pool if lo <= x['pags'] <= hi and x not in sel]
        prods = {}
        random.shuffle(c)
        for x in c:  # variedad de productor
            if x['prod'] in prods and len(c) > n * 2: continue
            prods[x['prod']] = 1; sel.append(x)
            if sum(1 for s in sel if lo <= s['pags'] <= hi) >= n: break
    return sel
sd = pick(dig, [((1,1),5), ((2,2),3), ((3,4),2), ((5,99),2)])
se = pick(esc, [((1,1),5), ((2,3),3)])
os.makedirs(out + '/texto', exist_ok=True); os.makedirs(out + '/img', exist_ok=True)
def lineas(page):
    words = page.get_text("words")  # x0,y0,x1,y1,w,...
    rows = []
    for w in sorted(words, key=lambda w: (round(w[3]/3), w[0])):
        y = (w[1] + w[3]) / 2
        if rows and abs(rows[-1][0] - y) < 3: rows[-1][1].append(w)
        else: rows.append([y, [w]])
    res = []
    for _, ws in rows:
        ws.sort(key=lambda w: w[0]); s = ''; last = None
        for w in ws:
            if last is not None:
                gap = w[0] - last
                s += ' | ' if gap > 12 else ' '
            s += w[4]; last = w[2]
        res.append(s)
    return '\n'.join(res)
for x in sd:
    d = pymupdf.open(os.path.join(src, x['f']))
    t = '\n'.join(f'===== PAGINA {i+1}/{d.page_count} =====\n' + lineas(p) for i, p in enumerate(d))
    open(f"{out}/texto/{x['f'][:-4]}.txt", 'w', encoding='utf-8').write(t)
for x in se:
    d = pymupdf.open(os.path.join(src, x['f']))
    for i, p in enumerate(d):
        p.get_pixmap(dpi=170).save(f"{out}/img/{x['f'][:-4]}_p{i+1}.png")
json.dump({'digitales': [(x['f'], x['pags'], x['prod']) for x in sd], 'escaneos': [(x['f'], x['pags']) for x in se]}, open(out + '/muestra.json', 'w'), indent=1)
print(json.dumps({'digitales': [(x['f'], x['pags'], x['prod']) for x in sd], 'escaneos': [(x['f'], x['pags']) for x in se]}, indent=0))
