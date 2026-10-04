import { describe,expect,it } from "vitest";
import { render,screen,within } from "@testing-library/react";
import { VistaFactura } from "../VistaFactura";
import { nuevaFactura,nuevaLinea } from "../modelo";
describe("Descuento global en la factura",()=>{
  it.each([true,false])("muestra el antes, porcentaje, ahorro y después con IVA activado=%s",(aplicarIva)=>{
    const factura=nuevaFactura();
    factura.lineas=[{...nuevaLinea(),concepto:"Licencia",precio:200,descuento:10}];
    factura.descuentoGlobal=25;factura.aplicarIva=aplicarIva;
    render(<VistaFactura factura={factura}/>);
    const fila=(label:string)=>within(screen.getByText(label).parentElement!);
    expect(fila("Antes del descuento").getByText(/180,00/)).toBeInTheDocument();
    expect(fila("Descuento global 25%").getByText(/45,00/)).toBeInTheDocument();
    expect(fila("Después del descuento").getByText(/135,00/)).toBeInTheDocument();
    expect(fila("TOTAL").getByText(aplicarIva ? /163,35/ : /135,00/)).toBeInTheDocument();
  });
  it("mantiene la base imponible cuando no hay descuento global",()=>{
    render(<VistaFactura factura={nuevaFactura()}/>);
    expect(screen.getByText("Base imponible")).toBeInTheDocument();
    expect(screen.queryByText("Antes del descuento")).toBeNull();
    expect(screen.queryByText("Después del descuento")).toBeNull();
  });
});
