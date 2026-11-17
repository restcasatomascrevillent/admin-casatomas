import { describe,expect,it } from "vitest";
import { render,screen,within } from "@testing-library/react";
import { VistaFactura } from "../VistaFactura";
import { nuevaFactura,nuevaLinea } from "../modelo";

const fila=(label:string)=>within(screen.getByText(label).parentElement!);

describe("Descuentos en el recibo",()=>{
  it("muestra el antes, el porcentaje, el ahorro y el total del descuento global",()=>{
    const factura=nuevaFactura();
    factura.lineas=[{...nuevaLinea(),concepto:"Licencia",precio:200,descuento:10}];
    factura.descuentoGlobal=25;
    render(<VistaFactura factura={factura}/>);
    expect(fila("Antes del descuento global").getByText(/180,00/)).toBeInTheDocument();
    expect(fila("Descuento global 25%").getByText(/45,00/)).toBeInTheDocument();
    expect(fila("TOTAL").getByText(/135,00/)).toBeInTheDocument();
  });
  it("resume los descuentos de conceptos aunque no exista descuento global",()=>{
    const f=nuevaFactura();
    f.lineas=[{...nuevaLinea(),concepto:"Web",precio:1500,descuento:50},{...nuevaLinea(),concepto:"Gestor",precio:400,descuento:100},{...nuevaLinea(),concepto:"Soporte",precio:150}];
    render(<VistaFactura factura={f}/>);
    expect(fila("Antes de los descuentos").getByText(/2050,00|2.050,00/)).toBeInTheDocument();
    expect(fila("Descuento total aplicado").getByText(/1150,00|1.150,00/)).toBeInTheDocument();
    expect(fila("TOTAL").getByText(/900,00/)).toBeInTheDocument();
    expect(screen.queryByText("Antes del descuento global")).toBeNull();
  });
  it("sin descuentos solo enseña el total",()=>{
    render(<VistaFactura factura={nuevaFactura()}/>);
    expect(screen.getByText("TOTAL")).toBeInTheDocument();
    expect(screen.queryByText(/Antes de/)).toBeNull();
  });
});

describe("Recibo sin membrete ni datos fiscales (17/11/2026)",()=>{
  it("una factura antigua con NIF, dirección, IVA y retención se ve como recibo: nada fiscal y total sin impuestos",()=>{
    const vieja=nuevaFactura();
    vieja.numero="FO-2026-010";vieja.aplicarIva=true;vieja.ivaGlobal=21;vieja.retencion=15;
    vieja.emisor={nombre:"OficiosOsIA",nif:"B00000000",direccion:"Calle Mayor 1, Alicante",email:"hola@oficios.test"};
    vieja.cliente={nombre:"Casa Tomás",nif:"B11111111",direccion:"Plaza 2, Crevillent",email:"casa@tomas.test"};
    vieja.lineas=[{...nuevaLinea("Licencia"),concepto:"Licencia del panel",precio:100,iva:21}];
    render(<VistaFactura factura={vieja}/>);
    const recibo=screen.getByRole("article",{name:"Vista previa del recibo"});
    expect(within(recibo).getByRole("heading",{name:"RECIBO"})).toBeInTheDocument();
    expect(recibo).toHaveTextContent("Casa Tomás");
    expect(recibo).toHaveTextContent("Emitido por OficiosOsIA");
    expect(fila("TOTAL").getByText(/100,00/)).toBeInTheDocument();
    for(const fiscal of [/FACTURA/,/NIF/i,/IVA/,/Retenci/i,/Base imponible/i,/Vencimiento/i,/B00000000/,/B11111111/,/Calle Mayor/,/Plaza 2/,/@/]) expect(recibo).not.toHaveTextContent(fiscal);
    // Sin membrete: ni logo ni imagen de marca.
    expect(within(recibo).queryByRole("img")).not.toBeInTheDocument();
    expect(within(recibo).getAllByRole("columnheader").map(c=>c.textContent)).toEqual(["Concepto","Ud.","Precio","Importe"]);
  });
  it("dice qué se paga: licencia global o el mes del pago mensual",()=>{
    const f=nuevaFactura();
    const {rerender}=render(<VistaFactura factura={f}/>);
    expect(screen.getByRole("article")).toHaveTextContent("Licencia global");
    rerender(<VistaFactura factura={{...f,tipo:"mensual",mes:"2026-11"}}/>);
    expect(screen.getByRole("article")).toHaveTextContent("Pago mensual · noviembre de 2026");
  });
});
