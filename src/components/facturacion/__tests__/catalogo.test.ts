import { describe,it,expect } from "vitest";
import { nuevaFactura,nuevaLinea } from "../modelo";
import { catalogoInicial,agregarProductos,recuperarServicios,ultimaFacturaCliente,prepararNuevaFactura,aplicarGastosServicios,cambiarMes,cambiarTipo,lineaCuota,siguienteNumero,ID_CUOTA_MENSUAL,type GastoServicio } from "../catalogo";
import { totalesRecibo } from "../modelo";
import type { FacturaGuardada } from "@/hooks/useFacturacionOficiososia";

const guardada = (numero:string, fecha:string, nombre="Cliente"):FacturaGuardada => {
  const documento=nuevaFactura(); documento.numero=numero; documento.fecha=fecha; documento.cliente={nombre,nif:"",direccion:"",email:""};
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
  it("detecta solo el mismo cliente (por nombre: no hay NIF) y elige el recibo más reciente por fecha",()=>{
    const a=guardada("R-2026-001","2026-08-01");
    const b=guardada("R-2026-002","2026-09-01");
    const ajena=guardada("R-2026-003","2026-10-01","Otro cliente");
    expect(ultimaFacturaCliente([a,ajena,b],{...a.documento.cliente,nombre:"  CLIENTE "})).toBe(b);
    expect(ultimaFacturaCliente([a,b],{...a.documento.cliente,nombre:""})).toBeUndefined();
  });
  it("recupera servicios recurrentes con sus precios y descuentos sin copiar la instalación",()=>{
    const anterior=nuevaFactura();
    anterior.lineas=[{...nuevaLinea("Instalación"),precio:600},{...nuevaLinea("Licencia"),concepto:"Plan cliente",precio:99,descuento:5}];
    const f=recuperarServicios(nuevaFactura(),anterior);
    expect(f.lineas).toHaveLength(1);expect(f.lineas[0].precio).toBe(99);
    expect(f.lineas[0].descuento).toBe(5);expect(f.lineas[0].id).not.toBe(anterior.lineas[1].id);
    expect(recuperarServicios(f,anterior)).toBe(f);
  });
  it("sugiere el siguiente número de la serie de recibos y mantiene emisor, catálogo y cliente, sin datos fiscales",()=>{
    const actual=nuevaFactura();actual.catalogo=catalogoInicial();actual.cliente={nombre:"Casa Tomás",nif:"OLD",direccion:"Calle",email:"x@y.test"};
    const y=String(new Date().getFullYear());
    // Las facturas antiguas «FO-…» no cuentan para la serie «R-…».
    const nueva=prepararNuevaFactura(actual,[guardada("R-"+y+"-005",y+"-01-01"),guardada("FO-"+y+"-040",y+"-01-01")]);
    expect(nueva.numero).toBe("R-"+y+"-006");expect(nueva.emisor).toEqual(actual.emisor);
    expect(nueva.catalogo).toEqual(actual.catalogo);
    expect(nueva.cliente).toEqual({nombre:"Casa Tomás",nif:"",direccion:"",email:""});
    expect(nueva).toMatchObject({tipo:"licencia",aplicarIva:false,retencion:0});
    expect(siguienteNumero([],"2027-03-01")).toBe("R-2027-001");
  });
});

describe("pago mensual: cuota fija + gastos de Servicios",()=>{
  const gastos:GastoServicio[]=[
    {proveedor:"openai",nombre:"OpenAI",categoria:"IA",importe:42.356,origen:"estimado"},
    {proveedor:"vercel",nombre:"Vercel",categoria:"Hosting",importe:21.47,origen:"manual"},
    {proveedor:"google_maps",nombre:"Google Maps",categoria:null,importe:0,origen:"falta"},
  ];
  const mensual=()=>{
    const actual=nuevaFactura();actual.catalogo={...catalogoInicial(),cuotaMensual:800};actual.cliente.nombre="Casa Tomás";
    return prepararNuevaFactura(actual,[],"mensual",new Date(2026,10,17));
  };
  it("nace con el mes en curso y la cuota fija de las tarifas",()=>{
    const f=mensual();
    expect(f).toMatchObject({tipo:"mensual",mes:"2026-11"});
    expect(f.lineas).toHaveLength(1);
    expect(f.lineas[0]).toMatchObject({concepto:"Cuota mensual · noviembre de 2026",precio:800,periodicidad:"Mensual",productoId:ID_CUOTA_MENSUAL});
    expect(lineaCuota(undefined,undefined)).toMatchObject({concepto:"Cuota mensual",precio:0});
  });
  it("añade los gastos del mes como conceptos editables, sin lo que cuesta 0 €",()=>{
    const f=aplicarGastosServicios(mensual(),gastos);
    expect(f.lineas.map(l=>[l.concepto,l.precio,l.proveedor])).toEqual([
      ["Cuota mensual · noviembre de 2026",800,undefined],
      ["OpenAI · IA",42.36,"openai"],
      ["Vercel · Hosting",21.47,"vercel"],
    ]);
    expect(f.lineas[1]).toMatchObject({categoria:"Servicio",periodicidad:"Mensual",cantidad:1});
    expect(totalesRecibo(f).total).toBe(863.83);
  });
  it("al volver a traerlos sustituye los importes, conserva los descuentos y no toca la cuota ni lo añadido a mano",()=>{
    let f=aplicarGastosServicios(mensual(),gastos);
    f={...f,lineas:[{...f.lineas[0],precio:750},{...f.lineas[1],precio:10,descuento:50},f.lineas[2],{...nuevaLinea("Otros"),concepto:"Extra a mano",precio:5}]};
    const otra=aplicarGastosServicios(f,[{...gastos[0],importe:60},{proveedor:"hostinger",nombre:"Hostinger",categoria:"Dominio",importe:17.14,origen:"manual"}]);
    expect(otra.lineas.map(l=>[l.concepto,l.precio,l.descuento])).toEqual([
      ["Cuota mensual · noviembre de 2026",750,0],
      ["Extra a mano",5,0],
      ["OpenAI · IA",60,50],
      ["Hostinger · Dominio",17.14,0],
    ]);
    // Sin gastos y sin nada más, queda una línea vacía para empezar.
    const vacio=aplicarGastosServicios({...f,lineas:[f.lineas[1]]},[]);
    expect(vacio.lineas).toHaveLength(1);expect(vacio.lineas[0]).toMatchObject({concepto:"",precio:0});
  });
  it("cambiar de mes renombra la cuota (salvo que se le haya cambiado el texto)",()=>{
    const f=cambiarMes(mensual(),"2026-12");
    expect(f.mes).toBe("2026-12");expect(f.lineas[0].concepto).toBe("Cuota mensual · diciembre de 2026");
    const editada={...f,lineas:[{...f.lineas[0],concepto:"Mantenimiento"}]};
    expect(cambiarMes(editada,"2027-01").lineas[0].concepto).toBe("Mantenimiento");
    expect(cambiarMes(f,"2026-12")).toBe(f);expect(cambiarMes(f,"nada")).toBe(f);
  });
  it("pasar a licencia quita el mes, la cuota y los gastos; volver a mensual repone la cuota",()=>{
    const f=aplicarGastosServicios(mensual(),gastos);
    const conExtra={...f,lineas:[...f.lineas,{...nuevaLinea("Módulo"),concepto:"Módulo extra",precio:30}]};
    const licencia=cambiarTipo(conExtra,"licencia");
    expect(licencia.tipo).toBe("licencia");expect(licencia.mes).toBeUndefined();
    expect(licencia.lineas.map(l=>l.concepto)).toEqual(["Módulo extra"]);
    const otraVez=cambiarTipo(licencia,"mensual",new Date(2027,0,5));
    expect(otraVez.mes).toBe("2027-01");
    expect(otraVez.lineas.map(l=>l.concepto)).toEqual(["Cuota mensual · enero de 2027","Módulo extra"]);
    expect(cambiarTipo(otraVez,"mensual")).toBe(otraVez);
  });
});
