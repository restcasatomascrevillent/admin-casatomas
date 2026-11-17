import { beforeEach,describe,expect,it,vi } from "vitest";
import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import { nuevaFactura,type Factura } from "../modelo";

const pdf=vi.hoisted(()=>({blob:vi.fn(),descargar:vi.fn()}));
vi.mock("../pdf",()=>({blobPdfFactura:pdf.blob,descargarBlobPdf:pdf.descargar}));
// pdf.js no corre en jsdom: el visor se sustituye por una marca con lo que recibe.
vi.mock("@/components/facturas/shared/VisorPdf",()=>({VisorPdf:({fuente,titulo}:{fuente:Blob;titulo:string})=><p data-testid="visor">{titulo} · {fuente.size} bytes</p>}));
import { VistaPreviaPdf } from "../VistaPreviaPdf";

const recibo=(cambios:Partial<Factura>={}):Factura=>({...nuevaFactura(),numero:"R-2026-007",cliente:{nombre:"Casa Tomás",nif:"",direccion:"",email:""},tipo:"mensual",mes:"2026-11",...cambios});
const BLOB=new Blob(["%PDF-de-prueba"],{type:"application/pdf"});

beforeEach(()=>{vi.clearAllMocks();pdf.blob.mockResolvedValue(BLOB);});

describe("vista previa del PDF del recibo",()=>{
  it("cerrada no genera nada",()=>{
    render(<VistaPreviaPdf recibo={null} cerrar={vi.fn()}/>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pdf.blob).not.toHaveBeenCalled();
  });
  it("de un recibo emitido: enseña el mismo PDF que se descarga y deja descargarlo",async()=>{
    const cerrar=vi.fn();const documento=recibo();
    render(<VistaPreviaPdf recibo={{documento,borrador:false}} cerrar={cerrar}/>);
    const dialogo=screen.getByRole("dialog",{name:"Vista previa del PDF · R-2026-007"});
    expect(dialogo).toHaveTextContent("Pago mensual · noviembre de 2026 · Casa Tomás");
    expect(screen.getByRole("status")).toHaveTextContent("Preparando el PDF…");
    expect(await screen.findByTestId("visor")).toHaveTextContent("Recibo R-2026-007 · "+BLOB.size+" bytes");
    expect(pdf.blob).toHaveBeenCalledWith(documento,{borrador:false});
    fireEvent.click(screen.getByRole("button",{name:"Descargar PDF"}));
    await waitFor(()=>expect(pdf.descargar).toHaveBeenCalledWith(BLOB,documento));
    fireEvent.click(screen.getByRole("button",{name:"Cerrar"}));
    expect(cerrar).toHaveBeenCalled();
  });
  it("de un borrador: lo pide como borrador, lo dice y no ofrece descargarlo",async()=>{
    const documento=recibo({numero:"",cliente:{nombre:"",nif:"",direccion:"",email:""}});
    render(<VistaPreviaPdf recibo={{documento,borrador:true}} cerrar={vi.fn()}/>);
    expect(screen.getByRole("dialog",{name:"Vista previa del PDF · sin número"})).toHaveTextContent(/cliente pendiente · Borrador sin emitir/);
    expect(await screen.findByTestId("visor")).toBeInTheDocument();
    expect(pdf.blob).toHaveBeenCalledWith(documento,{borrador:true});
    expect(screen.queryByRole("button",{name:"Descargar PDF"})).not.toBeInTheDocument();
    expect(screen.getByText("Para descargarlo, emite el recibo.")).toBeInTheDocument();
  });
  it("si el PDF no se puede generar, lo dice en vez de quedarse cargando",async()=>{
    pdf.blob.mockRejectedValue(new Error("No se han podido cargar los recursos del recibo."));
    render(<VistaPreviaPdf recibo={{documento:recibo(),borrador:false}} cerrar={vi.fn()}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent(/recursos del recibo|No se ha podido generar la vista previa/);
    expect(screen.queryByTestId("visor")).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Descargar PDF"})).toBeDisabled();
  });
});
