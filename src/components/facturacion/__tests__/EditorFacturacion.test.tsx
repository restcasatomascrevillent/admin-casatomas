import { beforeEach,describe,it,expect,vi } from "vitest";
import { render,screen,fireEvent,within } from "@testing-library/react";
import { nuevaFactura } from "../modelo";
import { catalogoInicial } from "../catalogo";
import type { DatosFacturacion } from "@/hooks/useFacturacionOficiososia";

const mock=vi.hoisted(()=>({data:null as DatosFacturacion|null,guardar:vi.fn()}));
vi.mock("@/hooks/useFacturacionOficiososia",()=>({
  useFacturacionOficiososia:()=>({data:mock.data,isLoading:false,isError:false,isFetching:false,guardar:mock.guardar,refetch:vi.fn()}),
}));
import { EditorFacturacion } from "../EditorFacturacion";

beforeEach(()=>{
  vi.clearAllMocks();
  const documento=nuevaFactura();documento.numero="FO-2026-010";documento.catalogo=catalogoInicial();
  documento.catalogo.productos.find(p=>p.id==="licencia")!.precio=149;
  documento.catalogo.productos.find(p=>p.id==="web")!.precio=25;
  documento.catalogo.productos.find(p=>p.id==="reservas")!.precio=30;
  mock.data={config:{documento,actualizado_en:"2026-10-03T12:00:00Z"},facturas:[]};
});
describe("editor simplificado",()=>{
  it("mantiene las tres pestañas y permite consultar un historial vacío",()=>{
    render(<EditorFacturacion/>);
    expect(screen.getByRole("tab",{name:"Nueva factura"})).toBeInTheDocument();
    expect(screen.getByRole("tab",{name:"Módulos y paquetes"})).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab",{name:"Facturas emitidas"}),{button:0,ctrlKey:false});
    expect(screen.getByText("Todavía no hay facturas emitidas")).toBeInTheDocument();
  });
  it("rellena un paquete con precios guardados y evita añadirlo dos veces",()=>{
    render(<EditorFacturacion/>);
    const paquete=screen.getByRole("button",{name:/Panel esencial/});
    fireEvent.click(paquete);
    expect(screen.getAllByRole("group",{name:/^Concepto [0-9]+$/})).toHaveLength(3);
    expect(within(screen.getByRole("group",{name:"Concepto 1"})).getByLabelText("Precio unitario (€)",{exact:true})).toHaveValue(149);
    expect(paquete).toBeDisabled();
  });
  it("quita el IVA de la vista previa, deshabilita su edición y restaura el porcentaje al activarlo",()=>{
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:/Panel esencial/}));
    const aplicar=screen.getByRole("switch",{name:"Aplicar IVA"});
    const preview=screen.getByRole("article",{name:"Vista previa de factura"});
    fireEvent.click(aplicar);
    expect(within(preview).queryByRole("columnheader",{name:"IVA"})).not.toBeInTheDocument();
    const iva=within(screen.getByRole("group",{name:"Concepto 1"})).getByLabelText("IVA (%)",{exact:true});
    expect(iva).toBeDisabled();expect(iva).toHaveValue(0);
    fireEvent.click(aplicar);
    expect(iva).toBeEnabled();expect(iva).toHaveValue(21);
  });
});
