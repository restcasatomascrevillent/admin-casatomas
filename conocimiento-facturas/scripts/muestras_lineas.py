def lineas(page):
    """Reconstruye filas por coordenada vertical y separa columnas con ' | '."""
    rows = []
    for w in sorted(page.get_text("words"), key=lambda w: (round(w[3] / 3), w[0])):
        y = (w[1] + w[3]) / 2
        if rows and abs(rows[-1][0] - y) < 3: rows[-1][1].append(w)
        else: rows.append([y, [w]])
    out = []
    for _, ws in rows:
        ws.sort(key=lambda w: w[0]); s = ""; last = None
        for w in ws:
            if last is not None: s += " | " if w[0] - last > 12 else " "
            s += w[4]; last = w[2]
        out.append(s)
    return out
