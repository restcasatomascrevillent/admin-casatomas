# PLAN B del recorte en iPhone (03-11-2026), NO USADO: ver docs/recorte-servidor.md.
#   python -m venv v && v/Scripts/pip install onnx
#   v/Scripts/python scripts/recorte/modelo-entrada-dinamica.py public/modelos/isnet-general-use-u8.onnx salida.onnx
# Resultado medido: a 1024 da EXACTAMENTE la misma máscara que el original; a
# 512 gasta ~4 veces menos memoria de activaciones pero la máscara cambia mucho
# (IoU 0-0,89 frente a 1024 en 8 fotos de prueba), así que no se usa.
# isnet-general-use-u8.onnx (entrada fija 1024) → entrada dinámica:
# los Resize del grafo tienen el tamaño de salida como CONSTANTE (traza a 1024).
# Se sustituye cada Const[h,w] por las medidas reales del tensor con el que se
# concatena después (o por las de la imagen de entrada en las salidas laterales).
import onnx, sys
from onnx import helper, numpy_helper, TensorProto
m = onnx.load(sys.argv[1]); g = m.graph
prod = {o: n for n in g.node for o in n.output}
cons = {}
for n in g.node:
    for i in n.input: cons.setdefault(i, []).append(n)
entrada = g.input[0].name
def const_de(x):
    n = prod.get(x)
    if n is not None and n.op_type == "Constant":
        for a in n.attribute:
            if a.name == "value": return numpy_helper.to_array(a.t)
    return None
nuevos = []; cambios = 0; ini = {}
def cte(nombre, valores):
    if nombre not in ini:
        ini[nombre] = helper.make_tensor(nombre, TensorProto.INT64, [len(valores)], valores)
        g.initializer.append(ini[nombre])
    return nombre
for r in [n for n in g.node if n.op_type == "Resize"]:
    tam = r.input[3]
    cat = prod[tam]
    assert cat.op_type == "Concat", r.name
    c = const_de(cat.input[1])
    assert c is not None and c.shape == (2,), (r.name, c)
    # ¿Con qué se concatena la salida del Resize?
    referencia = None
    for u in cons.get(r.output[0], []):
        if u.op_type == "Concat":
            otros = [i for i in u.input if i != r.output[0]]
            if otros: referencia = otros[0]; break
    if referencia is None:
        referencia = entrada  # salida lateral: vuelve al tamaño de la imagen
    forma = r.name + "_forma_ref"; hw = r.name + "_hw_ref"
    nuevos.append(helper.make_node("Shape", [referencia], [forma], name=r.name + "/ShapeRef"))
    nuevos.append(helper.make_node("Slice", [forma, cte("ini_2", [2]), cte("ini_4", [4]), cte("ini_0", [0])], [hw], name=r.name + "/SliceRef"))
    cat.input[1] = hw
    cambios += 1
# Insertar los nodos nuevos antes del primer Concat que los usa (orden topológico).
orden = list(g.node) + nuevos
# Shape(ref) debe ir después de que exista ref: recolocar con un orden topológico simple.
existentes = {i.name for i in g.input} | {i.name for i in g.initializer}
listos, pendientes = [], orden[:]
while pendientes:
    avance = False
    for n in list(pendientes):
        if all((not i) or i in existentes for i in n.input):
            listos.append(n); existentes.update(n.output); pendientes.remove(n); avance = True
    assert avance, "ciclo"
del g.node[:]; g.node.extend(listos)
for t in list(g.input) + list(g.output):
    d = t.type.tensor_type.shape.dim
    d[2].ClearField("dim_value"); d[2].dim_param = "alto"
    d[3].ClearField("dim_value"); d[3].dim_param = "ancho"
del g.value_info[:]
onnx.checker.check_model(m)
onnx.save(m, sys.argv[2])
print("Resize cambiados:", cambios)
