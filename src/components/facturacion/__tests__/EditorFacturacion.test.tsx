import { beforeEach,describe,it,expect,vi } from "vitest";
import { render,screen,fireEvent,within,waitFor } from "@testing-library/react";
import { mesDeFecha,nuevaFactura,textoMesRecibo } from "../modelo";
import { catalogoInicial,type GastoServicio } from "../catalogo";
import type { DatosFacturacion } from "@/hooks/useFacturacionOficiososia";
import type { GastosServiciosMes } from "@/hooks/useGastosServiciosMes";

const mock=vi.hoisted(()=>({data:null as DatosFacturacion|null,guardar:vi.fn(),eliminar:vi.fn(),gastos:null as GastosServiciosMes|null,mesPedido:[] as Array<string|undefined>}));
vi.mock("@/hooks/useFacturacionOficiososia",()=>({
  useFacturacionOficiososia:()=>({data:mock.data,isLoading:false,isError:false,isFetching:false,guardar:mock.guardar,eliminar:mock.eliminar,refetch:vi.fn()}),
}));
// Los gastos de Servicios se simulan: sin mes (licencia) no hay nada que traer.
vi.mock("@/hooks/useGastosServiciosMes",()=>({
  useGastosServiciosMes:(mes:string|undefined)=>{mock.mesPedido.push(mes);return mes && mock.gastos ? mock.gastos : {gastos:null,cargando:false,error:false,disponible:true};},
}));
vi.mock("@/components/control-excel/ControlExcel",()=>({ControlExcel:()=><p>Control del Excel de prueba</p>}));
// La vista previa del PDF se simula: jsPDF y pdf.js no corren en jsdom. Se anota qué recibo se pide.
const previa=vi.hoisted(()=>({blob:vi.fn(async()=>new Blob(["pdf"]))}));
vi.mock("../pdf",()=>({blobPdfFactura:previa.blob,descargarBlobPdf:vi.fn(),descargarFactura:vi.fn()}));
vi.mock("@/components/facturas/shared/VisorPdf",()=>({VisorPdf:({titulo}:{titulo:string})=><p data-testid="visor-pdf">{titulo}</p>}));
import { EditorFacturacion } from "../EditorFacturacion";

const GASTOS:GastoServicio[]=[
  {proveedor:"openai",nombre:"OpenAI",categoria:"IA",importe:42.36,origen:"estimado"},
  {proveedor:"vercel",nombre:"Vercel",categoria:"Hosting",importe:21.47,origen:"manual"},
  {proveedor:"google_maps",nombre:"Google Maps",categoria:null,importe:0,origen:"falta"},
];
const concepto=(n:number)=>within(screen.getByRole("group",{name:"Concepto "+n}));

beforeEach(()=>{
  vi.clearAllMocks();mock.mesPedido=[];
  const documento=nuevaFactura();documento.numero="R-2026-010";documento.catalogo={...catalogoInicial(),cuotaMensual:800};
  documento.catalogo.productos.find(p=>p.id==="licencia")!.precio=149;
  documento.catalogo.productos.find(p=>p.id==="web")!.precio=25;
  documento.catalogo.productos.find(p=>p.id==="reservas")!.precio=30;
  mock.data={config:{documento,actualizado_en:"2026-10-03T12:00:00Z"},facturas:[]};
  mock.gastos={gastos:GASTOS,cargando:false,error:false,disponible:true};
});
describe("editor de recibos",()=>{
  it("reordena conceptos, conserva precios y respeta el orden en el recibo",()=>{
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:"2. Conceptos"}));
    fireEvent.click(screen.getByRole("button",{name:/Panel esencial/}));
    const primero=concepto(1).getByLabelText("Descripción").getAttribute("value");
    const segundo=concepto(2).getByLabelText("Descripción").getAttribute("value");
    fireEvent.change(concepto(2).getByLabelText("Precio unitario (€)"),{target:{value:"77"}});
    fireEvent.click(screen.getByRole("button",{name:"Subir concepto 2"}));
    expect(concepto(1).getByLabelText("Descripción")).toHaveValue(segundo);
    expect(concepto(1).getByLabelText("Precio unitario (€)")).toHaveValue(77);
    expect(screen.getByRole("button",{name:"Subir concepto 1"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"3. Revisar"}));
    const rows=within(screen.getByRole("article")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent(segundo!);
    expect(rows[2]).toHaveTextContent(primero!);
  });
  it("confirma antes de eliminar un concepto y permite cancelar",async()=>{
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:"2. Conceptos"}));
    fireEvent.click(screen.getByRole("button",{name:/Panel esencial/}));
    fireEvent.click(screen.getByRole("button",{name:"Eliminar concepto 2"}));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Cancelar"}));
    expect(screen.getAllByRole("group",{name:/^Concepto /})).toHaveLength(3);
    fireEvent.click(screen.getByRole("button",{name:"Eliminar concepto 2"}));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button",{name:"Eliminar concepto"}));
    await waitFor(()=>expect(screen.getAllByRole("group",{name:/^Concepto /})).toHaveLength(2));
  });

  it("permite eliminar el último concepto y deja una línea vacía para empezar",async()=>{
    mock.data!.config!.documento.lineas[0].concepto="Licencia del panel";
    mock.data!.config!.documento.lineas[0].precio=40;
    mock.guardar.mockImplementation(async(documento)=>({config:{documento,actualizado_en:"nueva-version"}}));
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:"2. Conceptos"}));
    expect(screen.getByRole("button",{name:"Eliminar concepto 1"})).toBeEnabled();
    fireEvent.click(screen.getByRole("button",{name:"Eliminar concepto 1"}));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button",{name:"Eliminar concepto"}));
    await waitFor(()=>expect(concepto(1).getByLabelText("Descripción")).toHaveValue(""));
    expect(concepto(1).getByLabelText("Precio unitario (€)")).toHaveValue(0);
    fireEvent.click(screen.getByRole("button",{name:"Guardar borrador"}));
    await waitFor(()=>expect(mock.guardar).toHaveBeenCalled());
    expect(mock.guardar.mock.calls[0][0].lineas[0]).toMatchObject({concepto:"",precio:0});
  });

  it("tiene las cuatro pestañas (Recibos, Nuevo recibo, Tarifas y Control Excel) y permite consultar un historial vacío",async()=>{
    render(<EditorFacturacion/>);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    for(const nombre of ["Recibos","Nuevo recibo","Tarifas","Control Excel"]) expect(screen.getByRole("tab",{name:nombre})).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab",{name:"Recibos"}),{button:0,ctrlKey:false});
    expect(screen.getByText("Todavía no hay recibos")).toBeInTheDocument();
    // El control del Excel solo se carga al abrir su pestaña.
    expect(screen.queryByText("Control del Excel de prueba")).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab",{name:"Control Excel"}),{button:0,ctrlKey:false});
    expect(await screen.findByText("Control del Excel de prueba")).toBeInTheDocument();
  });
  it("rellena un paquete con precios guardados y evita añadirlo dos veces",()=>{
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:"2. Conceptos"}));
    const paquete=screen.getByRole("button",{name:/Panel esencial/});
    fireEvent.click(paquete);
    expect(screen.getAllByRole("group",{name:/^Concepto [0-9]+$/})).toHaveLength(3);
    expect(concepto(1).getByLabelText("Precio unitario (€)",{exact:true})).toHaveValue(149);
    expect(paquete).toBeDisabled();
  });
  it("no pide ni enseña ningún dato fiscal en ningún paso: ni NIF, ni dirección, ni IVA, ni retención, ni vencimiento",()=>{
    const {container}=render(<EditorFacturacion/>);
    expect(screen.getAllByRole("button",{name:/^\d\. /}).map(b=>b.textContent)).toEqual(["1. Datos","2. Conceptos","3. Revisar"]);
    for(const paso of ["1. Datos","2. Conceptos","3. Revisar"]){
      fireEvent.click(screen.getByRole("button",{name:paso}));
      for(const fiscal of [/NIF/i,/CIF/,/Dirección fiscal/i,/IVA/,/Retenci/i,/Vencimiento/i,/IBAN/,/razón social/i,/Base imponible/i]) expect(container).not.toHaveTextContent(fiscal);
    }
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByRole("article",{name:"Vista previa del recibo"})).toHaveTextContent("RECIBO");
  });
  it("muestra solo el paso actual y conserva el cliente y el precio al navegar",()=>{
    render(<EditorFacturacion/>);
    fireEvent.change(screen.getByLabelText("Cliente"),{target:{value:"Cliente prueba"}});
    expect(screen.queryByText("2. Conceptos del recibo")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Siguiente"}));
    expect(screen.queryByLabelText("Cliente")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:/Panel esencial/}));
    fireEvent.change(concepto(1).getByLabelText("Precio unitario (€)"),{target:{value:"175"}});
    fireEvent.click(screen.getByRole("button",{name:"Anterior"}));
    expect(screen.getByLabelText("Cliente")).toHaveValue("Cliente prueba");
    fireEvent.click(screen.getByRole("button",{name:"3. Revisar"}));
    expect(screen.getByRole("article",{name:"Vista previa del recibo"})).toHaveTextContent("Cliente prueba");
    expect(screen.getByRole("button",{name:"Emitir recibo"})).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Siguiente"})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"2. Conceptos"}));
    expect(concepto(1).getByLabelText("Precio unitario (€)")).toHaveValue(175);
  });
  it("el descuento de cada concepto y el global se ponen en el paso de conceptos y bajan el total",()=>{
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:"2. Conceptos"}));
    fireEvent.click(screen.getByRole("button",{name:/Panel esencial/}));
    fireEvent.change(concepto(1).getByLabelText("Descuento (%)"),{target:{value:"50"}});
    fireEvent.change(screen.getByLabelText("Descuento global (%)"),{target:{value:"10"}});
    // 149·50 % + 25 + 30 = 129,50; −10 % = 116,55
    expect(screen.getByText("Total:").closest("span")).toHaveTextContent(/116,55/);
  });
  it("emite el recibo sin datos fiscales aunque el documento guardado viniera de una factura antigua",async()=>{
    const d=mock.data!.config!.documento;
    d.cliente={nombre:"Casa Tomás",nif:"B11111111",direccion:"Plaza 2",email:"casa@tomas.test"};
    d.emisor={nombre:"OficiosOsIA",nif:"B00000000",direccion:"Calle 1",email:"hola@oficios.test"};
    d.aplicarIva=true;d.ivaGlobal=21;d.retencion=15;d.vencimiento="2099-01-01";
    d.lineas=[{...d.lineas[0],concepto:"Instalación",precio:1700,iva:21}];
    mock.guardar.mockImplementation(async(documento)=>({config:{documento,actualizado_en:"v2"},factura:{id:"f1",numero:documento.numero,documento,creado_en:"x",actualizado_en:"v2"}}));
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:"3. Revisar"}));
    expect(screen.getByRole("article",{name:"Vista previa del recibo"})).toHaveTextContent(/1\.?700,00/);
    fireEvent.click(screen.getByRole("button",{name:"Emitir recibo"}));
    await waitFor(()=>expect(mock.guardar).toHaveBeenCalled());
    const guardado=mock.guardar.mock.calls[0][0];
    expect(guardado.cliente).toEqual({nombre:"Casa Tomás",nif:"",direccion:"",email:""});
    expect(guardado.emisor).toEqual({nombre:"OficiosOsIA",nif:"",direccion:"",email:""});
    expect(guardado).toMatchObject({aplicarIva:false,retencion:0});
    expect(guardado.vencimiento).toBe(guardado.fecha);
  });

  it("«Vista previa del PDF» enseña el PDF sin guardar ni emitir: del borrador en edición y de los de la lista",async()=>{
    const documento=mock.data!.config!.documento;
    documento.cliente.nombre="Casa Tomás";
    mock.data!.facturas=[{id:"emitida",numero:"R-2026-001",documento:{...documento,numero:"R-2026-001"},creado_en:"2026-10-03",actualizado_en:"2026-10-03"}];
    mock.data!.borradores=[{id:"b1",numero:"R-2026-010",documento,factura_id:null,creado_en:"2026-10-04",actualizado_en:"2026-10-04"}];
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:"3. Revisar"}));
    fireEvent.click(screen.getByRole("button",{name:"Vista previa del PDF"}));
    expect(await screen.findByTestId("visor-pdf")).toHaveTextContent("Recibo R-2026-010");
    expect(previa.blob).toHaveBeenLastCalledWith(expect.objectContaining({numero:"R-2026-010"}),{borrador:true});
    expect(mock.guardar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Cerrar"}));
    await waitFor(()=>expect(screen.queryByTestId("visor-pdf")).not.toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole("tab",{name:"Recibos"}),{button:0,ctrlKey:false});
    fireEvent.click(screen.getByRole("button",{name:"Vista previa del PDF de R-2026-001"}));
    expect(await screen.findByTestId("visor-pdf")).toHaveTextContent("Recibo R-2026-001");
    expect(previa.blob).toHaveBeenLastCalledWith(expect.objectContaining({numero:"R-2026-001"}),{borrador:false});
    expect(screen.getByRole("button",{name:"Descargar PDF"})).toBeEnabled();
    expect(mock.guardar).not.toHaveBeenCalled();
  });

  it("exige confirmación antes de eliminar un recibo",async()=>{
    const documento=mock.data!.config!.documento;
    mock.data!.facturas=[{id:"emitida",numero:documento.numero,documento,creado_en:"2026-10-03",actualizado_en:"2026-10-03"}];
    mock.eliminar.mockResolvedValue({...mock.data,facturas:[]});
    render(<EditorFacturacion/>);
    fireEvent.mouseDown(screen.getByRole("tab",{name:"Recibos"}),{button:0,ctrlKey:false});
    fireEvent.click(screen.getByRole("button",{name:"Eliminar recibo R-2026-010"}));
    expect(mock.eliminar).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("R-2026-010");
    fireEvent.click(screen.getByRole("button",{name:"Cancelar"}));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Eliminar recibo R-2026-010"}));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button",{name:"Eliminar"}));
    await waitFor(()=>expect(mock.eliminar).toHaveBeenCalledWith(expect.objectContaining({id:"emitida"}),"emitida"));

  });

});

describe("pago mensual",()=>{
  const mes=mesDeFecha(new Date());
  const textoMes=textoMesRecibo(mes);
  const total=()=>screen.getByText("Total:").closest("span");
  const enRecibo=()=>within(screen.getByRole("list",{name:"Gastos de "+textoMes+" en el recibo"}));
  const precio=(nombre:string)=>screen.getByLabelText("Precio de "+nombre+" (€)");
  const descuento=(nombre:string)=>screen.getByLabelText("Descuento de "+nombre+" (%)");
  const nuevoMensual=async()=>{
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:"Nuevo pago mensual"}));
    await waitFor(()=>expect(screen.getByLabelText("Mes que se paga")).toHaveValue(mes));
    fireEvent.click(screen.getByRole("button",{name:"2. Conceptos"}));
    await waitFor(()=>expect(enRecibo().getAllByRole("listitem")).toHaveLength(2));
  };
  it("una licencia no pide el mes ni consulta los gastos de Servicios",()=>{
    render(<EditorFacturacion/>);
    expect(screen.getByRole("button",{name:/Licencia global/})).toHaveAttribute("aria-pressed","true");
    expect(screen.queryByLabelText("Mes que se paga")).not.toBeInTheDocument();
    expect(mock.mesPedido.every(m=>m===undefined)).toBe(true);
  });
  it("nace con la cuota fija de las tarifas y los gastos del mes de Servicios, sin lo que cuesta 0 €",async()=>{
    await nuevoMensual();
    // La lista de conceptos lleva solo la cuota: los gastos de Servicios se editan en su bloque.
    expect(screen.getAllByRole("group",{name:/^Concepto /})).toHaveLength(1);
    expect(concepto(1).getByLabelText("Descripción")).toHaveValue("Cuota mensual · "+textoMes);
    expect(concepto(1).getByLabelText("Precio unitario (€)")).toHaveValue(800);
    expect(precio("OpenAI")).toHaveValue(42.36);
    expect(precio("Vercel")).toHaveValue(21.47);
    expect(descuento("OpenAI")).toHaveValue(0);
    expect(mock.mesPedido).toContain(mes);
    // El bloque dice de dónde sale cada importe y lo que falta por meter en Servicios.
    expect(enRecibo().getByText("Estimado")).toBeInTheDocument();
    expect(enRecibo().getByText("Metido a mano")).toBeInTheDocument();
    expect(screen.getByText(/Falta meter en Servicios › Costes el importe de: Google Maps/)).toBeInTheDocument();
    expect(screen.getByText("Los precios son los de Servicios.")).toBeInTheDocument();
    expect(total()).toHaveTextContent(/863,83/);
  });
  it("cada gasto de Servicios se modifica en su bloque: precio y descuento, con lo que queda en el recibo a la vista",async()=>{
    mock.guardar.mockImplementation(async(documento)=>({config:{documento,actualizado_en:"v2"}}));
    await nuevoMensual();
    fireEvent.change(descuento("OpenAI"),{target:{value:"50"}});
    expect(screen.getByTestId("importe-servicio-openai")).toHaveTextContent(/21,18/);
    expect(total()).toHaveTextContent(/842,65/); // 800 + 21,18 + 21,47
    fireEvent.change(precio("Vercel"),{target:{value:"10"}});
    expect(screen.getByTestId("importe-servicio-vercel")).toHaveTextContent(/10,00/);
    expect(total()).toHaveTextContent(/831,18/);
    expect(enRecibo().getByText(/En Servicios: 21,47\s€ \(precio cambiado\)/)).toBeInTheDocument();
    expect(screen.getByText(/Servicios en el recibo:/).closest("p")).toHaveTextContent(/31,18.*en Servicios: 63,83.*se descuentan 32,65/);
    fireEvent.click(screen.getByRole("button",{name:"Guardar borrador"}));
    await waitFor(()=>expect(mock.guardar).toHaveBeenCalled());
    const guardado=mock.guardar.mock.calls[0][0];
    expect(guardado).toMatchObject({tipo:"mensual",mes,aplicarIva:false,retencion:0});
    expect(guardado.lineas.map((l:{concepto:string;precio:number;descuento:number;proveedor?:string})=>[l.concepto,l.precio,l.descuento,l.proveedor])).toEqual([
      ["Cuota mensual · "+textoMes,800,0,undefined],["OpenAI · IA",42.36,50,"openai"],["Vercel · Hosting",10,0,"vercel"],
    ]);
    // «Volver a traer» repone el precio de Servicios y conserva el descuento.
    fireEvent.click(screen.getByRole("button",{name:"Volver a traer los importes"}));
    expect(precio("Vercel")).toHaveValue(21.47);
    expect(descuento("OpenAI")).toHaveValue(50);
    // Y el recibo que se revisa lleva el descuento.
    fireEvent.click(screen.getByRole("button",{name:"3. Revisar"}));
    const recibo=screen.getByRole("article",{name:"Vista previa del recibo"});
    expect(recibo).toHaveTextContent("OpenAI · IA");expect(recibo).toHaveTextContent("Dto. 50%");
  });
  it("«Descuento a todos» pone el mismo descuento a todos los servicios sin tocar la cuota",async()=>{
    await nuevoMensual();
    const aplicar=screen.getByRole("button",{name:"Aplicar a todos"});
    expect(aplicar).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Descuento a todos los servicios (%)"),{target:{value:"100"}});
    fireEvent.click(aplicar);
    expect(descuento("OpenAI")).toHaveValue(100);expect(descuento("Vercel")).toHaveValue(100);
    expect(concepto(1).getByLabelText("Descuento (%)")).toHaveValue(0);
    expect(total()).toHaveTextContent(/800,00/);
    fireEvent.change(screen.getByLabelText("Descuento a todos los servicios (%)"),{target:{value:"150"}});
    expect(aplicar).toBeDisabled();
  });
  it("un gasto se puede quitar del recibo y volver a añadir; quitado no vuelve solo",async()=>{
    await nuevoMensual();
    fireEvent.click(screen.getByRole("button",{name:"Quitar Vercel del recibo"}));
    expect(enRecibo().getAllByRole("listitem")).toHaveLength(1);
    expect(total()).toHaveTextContent(/842,36/);
    const fuera=within(screen.getByRole("list",{name:"Gastos de Servicios que no están en el recibo"}));
    expect(fuera.getByText(/Vercel.*21,47.*no está en el recibo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Añadir Vercel al recibo"}));
    expect(precio("Vercel")).toHaveValue(21.47);
    expect(screen.queryByRole("list",{name:"Gastos de Servicios que no están en el recibo"})).not.toBeInTheDocument();
    // Quitados todos, el botón general los trae de nuevo.
    fireEvent.click(screen.getByRole("button",{name:"Quitar Vercel del recibo"}));
    fireEvent.click(screen.getByRole("button",{name:"Quitar OpenAI del recibo"}));
    expect(screen.getByText("Todavía no están en el recibo.")).toBeInTheDocument();
    expect(total()).toHaveTextContent(/800,00/);
    fireEvent.click(screen.getByRole("button",{name:"Añadir al recibo"}));
    expect(enRecibo().getAllByRole("listitem")).toHaveLength(2);
  });
  it("un concepto añadido a mano va antes de los servicios y se ordena solo entre los conceptos propios",async()=>{
    mock.guardar.mockImplementation(async(documento)=>({config:{documento,actualizado_en:"v2"}}));
    await nuevoMensual();
    fireEvent.click(screen.getByRole("button",{name:"Añadir concepto"}));
    expect(screen.getAllByRole("group",{name:/^Concepto /})).toHaveLength(2);
    fireEvent.change(concepto(2).getByLabelText("Descripción"),{target:{value:"Extra a mano"}});
    expect(screen.getByRole("button",{name:"Bajar concepto 2"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"Subir concepto 2"}));
    expect(concepto(1).getByLabelText("Descripción")).toHaveValue("Extra a mano");
    fireEvent.click(screen.getByRole("button",{name:"Guardar borrador"}));
    await waitFor(()=>expect(mock.guardar).toHaveBeenCalled());
    expect(mock.guardar.mock.calls[0][0].lineas.map((l:{concepto:string})=>l.concepto)).toEqual(["Extra a mano","Cuota mensual · "+textoMes,"OpenAI · IA","Vercel · Hosting"]);
  });
  it("sin costes de Servicios disponibles deja la cuota y avisa de que se añadan a mano",async()=>{
    mock.gastos={gastos:null,cargando:false,error:false,disponible:false};
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:"Nuevo pago mensual"}));
    await waitFor(()=>expect(screen.getByLabelText("Mes que se paga")).toHaveValue(mes));
    fireEvent.click(screen.getByRole("button",{name:"2. Conceptos"}));
    expect(screen.getAllByRole("group",{name:/^Concepto /})).toHaveLength(1);
    expect(screen.getByText(/no están disponibles en este entorno/)).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Aplicar a todos"})).not.toBeInTheDocument();
  });
  it("pasar un recibo a pago mensual desde el paso 1 pone el mes, la cuota y los gastos",async()=>{
    render(<EditorFacturacion/>);
    fireEvent.click(screen.getByRole("button",{name:/Pago mensual/}));
    expect(screen.getByLabelText("Mes que se paga")).toHaveValue(mes);
    fireEvent.click(screen.getByRole("button",{name:"2. Conceptos"}));
    await waitFor(()=>expect(enRecibo().getAllByRole("listitem")).toHaveLength(2));
    expect(screen.getAllByRole("group",{name:/^Concepto /})).toHaveLength(1);
    expect(screen.queryByRole("button",{name:/Panel esencial/})).not.toBeInTheDocument();
  });
});
