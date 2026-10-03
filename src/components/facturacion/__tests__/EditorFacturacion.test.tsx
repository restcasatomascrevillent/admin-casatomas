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
    fireEvent.mouseDown(screen.getByRole("tab",{name:"Facturas"}),{button:0,ctrlKey:false});
    expect(screen.getByText("Todavía no hay facturas")).toBeInTheDocument();
  });
  it("rellena un paquete con precios guardados y evita añadirlo dos veces",()=>{
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:"2. Servicios"}));
    const paquete=screen.getByRole("button",{name:/Panel esencial/});
    fireEvent.click(paquete);
    expect(screen.getAllByRole("group",{name:/^Concepto [0-9]+$/})).toHaveLength(3);
    expect(within(screen.getByRole("group",{name:"Concepto 1"})).getByLabelText("Precio unitario (€)",{exact:true})).toHaveValue(149);
    expect(paquete).toBeDisabled();
  });
  it("quita el IVA de la vista previa, deshabilita su edición y restaura el porcentaje al activarlo",()=>{
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:"2. Servicios"}));
    fireEvent.click(screen.getByRole("button",{name:/Panel esencial/}));
    fireEvent.click(screen.getByRole("button",{name:"3. Ajustes"}));
    const aplicar=screen.getByRole("switch",{name:"Aplicar IVA"});
    fireEvent.click(aplicar);
    fireEvent.click(screen.getByRole("button",{name:"4. Revisar"}));
    expect(within(screen.getByRole("article",{name:"Vista previa de factura"})).queryByRole("columnheader",{name:"IVA"})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"2. Servicios"}));
    let iva=within(screen.getByRole("group",{name:"Concepto 1"})).getByLabelText("IVA (%)",{exact:true});
    expect(iva).toBeDisabled();expect(iva).toHaveValue(0);
    fireEvent.click(screen.getByRole("button",{name:"3. Ajustes"}));
    fireEvent.click(screen.getByRole("switch",{name:"Aplicar IVA"}));
    fireEvent.click(screen.getByRole("button",{name:"2. Servicios"}));
    iva=within(screen.getByRole("group",{name:"Concepto 1"})).getByLabelText("IVA (%)",{exact:true});
    expect(iva).toBeEnabled();expect(iva).toHaveValue(21);
  });
  it("muestra solo el paso actual y conserva el cliente y el precio al navegar",()=>{
    render(<EditorFacturacion/>);
    const cliente=within(screen.getByRole("group",{name:"Cliente"}));
    fireEvent.change(cliente.getByLabelText("Nombre / razón social"),{target:{value:"Cliente prueba"}});
    expect(screen.queryByText("2. Conceptos de la factura")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Siguiente"}));
    expect(screen.queryByRole("group",{name:"Cliente"})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:/Panel esencial/}));
    fireEvent.change(within(screen.getByRole("group",{name:"Concepto 1"})).getByLabelText("Precio unitario (€)"),{target:{value:"175"}});
    fireEvent.click(screen.getByRole("button",{name:"Anterior"}));
    expect(within(screen.getByRole("group",{name:"Cliente"})).getByLabelText("Nombre / razón social")).toHaveValue("Cliente prueba");
    fireEvent.click(screen.getByRole("button",{name:"4. Revisar"}));
    expect(screen.getByRole("article",{name:"Vista previa de factura"})).toHaveTextContent("Cliente prueba");
    expect(screen.getByRole("button",{name:"Emitir factura"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"2. Servicios"}));
    expect(within(screen.getByRole("group",{name:"Concepto 1"})).getByLabelText("Precio unitario (€)")).toHaveValue(175);
  });

});
