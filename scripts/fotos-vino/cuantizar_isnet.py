"""Genera public/modelos/isnet-general-use-u8.onnx (recorte de fotos de vino en
el navegador, src/components/carta/recorte/).

Cuantiza SOLO los pesos de las 119 Conv de isnet-general-use (Apache-2.0) a
uint8 por canal de salida (DequantizeLinear axis=0): 178,6 MB -> 46,7 MB y el
cómputo sigue en float32. Deja solo la salida principal. Comparado con el
modelo fp32 de rembg (misma tubería, post_process_mask): IoU de la máscara
0,9997-0,9999 en 6 fotos de la carta.

No usa el paquete `onnx` nativo (su DLL la bloquea el Control de
aplicaciones de Windows en este PC): carga onnx_ml_pb2 en Python puro.

  # venv fuera del repo con rembg (ver recortar.py) + onnx (solo por el _pb2):
  <venv>/Scripts/python -m pip install onnx
  <venv>/Scripts/python -I scripts/fotos-vino/cuantizar_isnet.py       <venv>/Lib/site-packages/onnx       ~/.rembg/models/isnet-general-use/isnet-general-use.onnx       public/modelos/isnet-general-use-u8.onnx

Si se cambia el modelo, cambiar también el nombre/CACHE_MODELO en
recorte.worker.ts para que los navegadores no sigan con el antiguo.
"""
import sys, importlib.util, types
from pathlib import Path
import numpy as np
base = Path(sys.argv[1])
pkg = types.ModuleType("onnx"); pkg.__path__ = [str(base)]; sys.modules["onnx"] = pkg
spec = importlib.util.spec_from_file_location("onnx.onnx_ml_pb2", base / "onnx_ml_pb2.py")
pb = importlib.util.module_from_spec(spec); sys.modules["onnx.onnx_ml_pb2"] = pb; spec.loader.exec_module(pb)
mp = pb.ModelProto(); mp.ParseFromString(Path(sys.argv[2]).read_bytes())
g = mp.graph
inits = {i.name: i for i in g.initializer}
pesos = {n.input[1] for n in g.node if n.op_type == "Conv" and n.input[1] in inits}
nuevos_nodos, nuevos_inits, quitar = [], [], set()
for nombre in pesos:
    t = inits[nombre]
    assert t.data_type == 1 and t.raw_data
    w = np.frombuffer(t.raw_data, dtype=np.float32).reshape(tuple(t.dims))
    oc = w.shape[0]; flat = w.reshape(oc, -1)
    mn = np.minimum(flat.min(1), 0); mx = np.maximum(flat.max(1), 0)
    escala = np.where(mx - mn > 0, (mx - mn) / 255.0, 1.0).astype(np.float32)
    zp = np.clip(np.round(-mn / escala), 0, 255).astype(np.uint8)
    q = np.clip(np.round(flat / escala[:, None]) + zp[:, None], 0, 255).astype(np.uint8).reshape(w.shape)
    qt = pb.TensorProto(name=nombre + "_q", data_type=2, dims=list(w.shape), raw_data=q.tobytes())
    st = pb.TensorProto(name=nombre + "_s", data_type=1, dims=[oc], raw_data=escala.tobytes())
    zt = pb.TensorProto(name=nombre + "_z", data_type=2, dims=[oc], raw_data=zp.tobytes())
    nuevos_inits += [qt, st, zt]
    nd = pb.NodeProto(op_type="DequantizeLinear", name=nombre + "_dq", input=[qt.name, st.name, zt.name], output=[nombre])
    nd.attribute.append(pb.AttributeProto(name="axis", type=pb.AttributeProto.INT, i=0))
    nuevos_nodos.append(nd); quitar.add(nombre)
resto = [i for i in g.initializer if i.name not in quitar]
del g.initializer[:]; g.initializer.extend(resto + nuevos_inits)
viejos = list(g.node); del g.node[:]; g.node.extend(nuevos_nodos + viejos)
# Solo la salida principal (las otras 5 son mapas intermedios que no se usan).
sal = g.output[0]; del g.output[:]; g.output.append(sal)
Path(sys.argv[3]).write_bytes(mp.SerializeToString())
print(len(pesos), "Conv cuantizadas;", round(Path(sys.argv[3]).stat().st_size / 1e6, 1), "MB")
