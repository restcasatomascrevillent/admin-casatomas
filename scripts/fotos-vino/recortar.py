"""
Quita el fondo de las fotos descargadas por `homogeneizar.mts descargar`.

  python -I scripts/fotos-vino/recortar.py <carpeta> [--modelo isnet-general-use]

Lee <carpeta>/orig/<vinoId>.<ext> y escribe <carpeta>/sinfondo/<vinoId>.png
(RGBA). Salta las que ya existen (reanudable). No toca BD ni Storage.

Modelo por defecto: isnet-general-use (Apache-2.0, ~1 s/foto en CPU).
Alternativa: birefnet-general (MIT, ~14 s/foto, resultado casi idéntico en
estas fotos). NO usar RMBG-1.4/2.0 de BRIA (licencia no comercial).

Requisitos (en un venv fuera del repo):
  python -m venv <ruta>/venv-rembg
  <ruta>/venv-rembg/Scripts/python -m pip install "rembg[cpu]" pillow
La primera vez rembg descarga el modelo (~180 MB) a ~/.rembg/models.
"""
import sys
import time
from pathlib import Path


def main() -> int:
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        print(__doc__)
        return 2
    carpeta = Path(args[0])
    modelo = "isnet-general-use"
    if "--modelo" in args:
        modelo = args[args.index("--modelo") + 1]

    from PIL import Image
    from rembg import new_session, remove

    origenes = sorted(p for p in (carpeta / "orig").iterdir() if p.is_file())
    salida = carpeta / "sinfondo"
    salida.mkdir(parents=True, exist_ok=True)
    pendientes = [p for p in origenes if not (salida / f"{p.stem}.png").exists()]
    print(f"{len(origenes)} fotos, {len(pendientes)} pendientes, modelo {modelo}", flush=True)
    if not pendientes:
        return 0

    sesion = new_session(modelo)
    errores = 0
    for i, p in enumerate(pendientes, 1):
        t = time.time()
        try:
            img = Image.open(p).convert("RGB")
            out = remove(img, session=sesion, post_process_mask=True)
            tmp = salida / f"{p.stem}.png.tmp"
            out.save(tmp, format="PNG")
            tmp.replace(salida / f"{p.stem}.png")
            print(f"[{i}/{len(pendientes)}] {p.stem} {time.time() - t:.1f}s", flush=True)
        except Exception as e:  # noqa: BLE001 - se sigue con las demás
            errores += 1
            print(f"[{i}/{len(pendientes)}] ERROR {p.stem}: {e}", flush=True)
    print(f"Hecho. Errores: {errores}")
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
