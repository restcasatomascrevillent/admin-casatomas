import { describe,it,expect } from "vitest";
import { nuevaFactura,nuevaLinea } from "../modelo";
import { catalogoInicial,agregarProductos,recuperarServicios,ultimaFacturaCliente,prepararNuevaFactura } from "../catalogo";
import type { FacturaGuardada } from "@/hooks/useFacturacionOficiososia";

const guardada = (numero:string, fecha:string, nif="NIF-CLIENTE"):FacturaGuardada => {
  const documento=nuevaFactura(); documento.numero=numero; documento.fecha=fecha; documento.cliente={nombre:"Cliente",nif,direccion:"Dirección",email:""};
  return {id:crypto.randomUUID(),numero,documento,creado_en:fecha+"T12:00:00Z",actualizado_en:fecha+"T12:00:00Z"};
};
describe("catálogo y creación rápida",()=>{
  it("añade un paquete sin duplicar módulos ni sobrescribir precios ya editados",()=>{
    const c=catalogoInicial(); c.productos.find(p=>p.id==="licencia")!.precio=149;
    const f=agregarProductos(nuevaFactura(),c,["licencia"]);
    f.lineas[0].precio=125;
    const completo=agregarProductos(f,c,["licencia","web","reservas"],"esencial");
    expect(completo.lineas).toHaveLength(3);
    expect(completo.lineas[0].precio).toBe(125);
    expect(completo.lineas.filter(l=>l.paqueteId==="esencial")).toHaveLength(2);
    expect(agregarProductos(completo,c,["licencia","web","reservas"],"esencial")).toBe(completo);
  });
  it("conserva los conceptos manuales y las periodicidades de los servicios",()=>{
    const c=catalogoInicial();const f=nuevaFactura();f.lineas=[{...nuevaLinea("Otros"),concepto:"Servicio a medida",precio:23}];
    const resultado=agregarProductos(f,c,["instalacion","licencia"]);
    expect(resultado.lineas.map(l=>l.periodicidad)).toEqual(["Mensual","Puntual","Mensual"]);
    expect(resultado.lineas[0].concepto).toBe("Servicio a medida");
  });
  it("detecta solo el mismo NIF y elige la factura más reciente por fecha",()=>{
    const a=guardada("FO-2026-001","2026-08-01");
    const b=guardada("FO-2026-002","2026-09-01");
    const ajena=guardada("FO-2026-003","2026-10-01","OTRO");
    expect(ultimaFacturaCliente([a,ajena,b],{...a.documento.cliente,nif:" nif-cliente "})).toBe(b);
    expect(ultimaFacturaCliente([a,b],{...a.documento.cliente,nif:""})).toBeUndefined();
  });
  it("recupera servicios recurrentes con sus precios y descuentos sin copiar la instalación",()=>{
    const anterior=nuevaFactura();
    anterior.lineas=[{...nuevaLinea("Instalación"),precio:600},{...nuevaLinea("Licencia"),concepto:"Plan cliente",precio:99,descuento:5}];
    const f=recuperarServicios(nuevaFactura(),anterior);
    expect(f.lineas).toHaveLength(1);expect(f.lineas[0].precio).toBe(99);
    expect(f.lineas[0].descuento).toBe(5);expect(f.lineas[0].id).not.toBe(anterior.lineas[1].id);
    expect(recuperarServicios(f,anterior)).toBe(f);
  });
  it("sugiere el siguiente número y mantiene emisor y catálogo sin arrastrar el cliente",()=>{
    const actual=nuevaFactura();actual.catalogo=catalogoInicial();actual.cliente={nombre:"Anterior",nif:"OLD",direccion:"Calle",email:""};
    const y=String(new Date().getFullYear());
    const nueva=prepararNuevaFactura(actual,[guardada("FO-"+y+"-005",y+"-01-01")]);
    expect(nueva.numero).toBe("FO-"+y+"-006");expect(nueva.emisor).toEqual(actual.emisor);
    expect(nueva.catalogo).toEqual(actual.catalogo);expect(nueva.cliente.nombre).toBe("");
  });
});
