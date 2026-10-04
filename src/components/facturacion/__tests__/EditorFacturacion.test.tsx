import { beforeEach,describe,it,expect,vi } from "vitest";
import { render,screen,fireEvent,within,waitFor } from "@testing-library/react";
import { nuevaFactura } from "../modelo";
import { catalogoInicial } from "../catalogo";
import type { DatosFacturacion } from "@/hooks/useFacturacionOficiososia";

const mock=vi.hoisted(()=>({data:null as DatosFacturacion|null,guardar:vi.fn(),eliminar:vi.fn()}));
vi.mock("@/hooks/useFacturacionOficiososia",()=>({
  useFacturacionOficiososia:()=>({data:mock.data,isLoading:false,isError:false,isFetching:false,guardar:mock.guardar,eliminar:mock.eliminar,refetch:vi.fn()}),
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
  it("reordena conceptos, conserva precios y respeta el orden en la factura",()=>{
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:"2. Servicios"}));
    fireEvent.click(screen.getByRole("button",{name:/Panel esencial/}));
    const primero=within(screen.getByRole("group",{name:"Concepto 1"})).getByLabelText("Descripción").getAttribute("value");
    const segundo=within(screen.getByRole("group",{name:"Concepto 2"})).getByLabelText("Descripción").getAttribute("value");
    fireEvent.change(within(screen.getByRole("group",{name:"Concepto 2"})).getByLabelText("Precio unitario (€)"),{target:{value:"77"}});
    fireEvent.click(screen.getByRole("button",{name:"Subir concepto 2"}));
    expect(within(screen.getByRole("group",{name:"Concepto 1"})).getByLabelText("Descripción")).toHaveValue(segundo);
    expect(within(screen.getByRole("group",{name:"Concepto 1"})).getByLabelText("Precio unitario (€)")).toHaveValue(77);
    expect(screen.getByRole("button",{name:"Subir concepto 1"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"4. Revisar"}));
    const rows=within(screen.getByRole("article")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent(segundo!);
    expect(rows[2]).toHaveTextContent(primero!);
  });
  it("confirma antes de eliminar un concepto y permite cancelar",async()=>{
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:"2. Servicios"}));
    fireEvent.click(screen.getByRole("button",{name:/Panel esencial/}));
    fireEvent.click(screen.getByRole("button",{name:"Eliminar concepto 2"}));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Cancelar"}));
    expect(screen.getAllByRole("group",{name:/^Concepto /})).toHaveLength(3);
    fireEvent.click(screen.getByRole("button",{name:"Eliminar concepto 2"}));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button",{name:"Eliminar concepto",exact:true}));
    await waitFor(()=>expect(screen.getAllByRole("group",{name:/^Concepto /})).toHaveLength(2));
  });

  it("permite eliminar el último concepto y deja una línea vacía para empezar",async()=>{
    mock.data!.config!.documento.lineas[0].concepto="Licencia del panel";
    mock.data!.config!.documento.lineas[0].precio=40;
    mock.guardar.mockImplementation(async(documento)=>({config:{documento,actualizado_en:"nueva-version"}}));
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:"2. Servicios"}));
    expect(screen.getByRole("button",{name:"Eliminar concepto 1"})).toBeEnabled();
    fireEvent.click(screen.getByRole("button",{name:"Eliminar concepto 1"}));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button",{name:"Eliminar concepto",exact:true}));
    await waitFor(()=>expect(within(screen.getByRole("group",{name:"Concepto 1"})).getByLabelText("Descripción")).toHaveValue(""));
    const concepto=within(screen.getByRole("group",{name:"Concepto 1"}));
    expect(concepto.getByLabelText("Descripción")).toHaveValue("");
    expect(concepto.getByLabelText("Precio unitario (€)")).toHaveValue(0);
    fireEvent.click(screen.getByRole("button",{name:"Guardar borrador"}));
    await waitFor(()=>expect(mock.guardar).toHaveBeenCalled());
    expect(mock.guardar.mock.calls[0][0].lineas[0]).toMatchObject({concepto:"",precio:0});
  });

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
    fireEvent.click(screen.getByRole("button",{name:"3. Ajustes"}));
    let iva=screen.getByLabelText("IVA de la factura (%)");
    expect(iva).toBeDisabled();expect(iva).toHaveValue(21);
    fireEvent.click(screen.getByRole("switch",{name:"Aplicar IVA"}));
    iva=screen.getByLabelText("IVA de la factura (%)");
    expect(iva).toBeEnabled();expect(iva).toHaveValue(21);
    fireEvent.change(iva,{target:{value:"10"}});
    fireEvent.click(screen.getByRole("button",{name:"4. Revisar"}));
    expect(screen.getByRole("article",{name:"Vista previa de factura"})).toHaveTextContent("IVA 10%");
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

  it("exige confirmación antes de eliminar una factura",async()=>{
    const documento=mock.data!.config!.documento;
    mock.data!.facturas=[{id:"emitida",numero:documento.numero,documento,creado_en:"2026-10-03",actualizado_en:"2026-10-03"}];
    mock.eliminar.mockResolvedValue({...mock.data,facturas:[]});
    render(<EditorFacturacion/>);
    fireEvent.mouseDown(screen.getByRole("tab",{name:"Facturas"}),{button:0,ctrlKey:false});
    fireEvent.click(screen.getByRole("button",{name:"Eliminar factura FO-2026-010"}));
    expect(mock.eliminar).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("FO-2026-010");
    fireEvent.click(screen.getByRole("button",{name:"Cancelar"}));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Eliminar factura FO-2026-010"}));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button",{name:"Eliminar"}));
    await waitFor(()=>expect(mock.eliminar).toHaveBeenCalledWith(expect.objectContaining({id:"emitida"}),"emitida"));

  });

});
