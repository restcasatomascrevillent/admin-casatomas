import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ControlNoDisponible, EstadoControl } from "@/hooks/useControlExcel";
import { ControlExcel } from "../ControlExcel";
import { hoyIso } from "../formato";

const h = vi.hoisted(() => ({
  consulta: {} as Record<string, unknown>,
  refetch: vi.fn(),
  cambiar: vi.fn(),
  pendiente: false,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/useControlExcel", async (original) => ({
  ...(await original<typeof import("@/hooks/useControlExcel")>()),
  useControlExcel: () => ({ refetch: h.refetch, ...h.consulta }),
  useCambiarControlExcel: () => ({ mutateAsync: h.cambiar, isPending: h.pendiente }),
}));
vi.mock("sonner", () => ({ toast: h.toast }));

const { ErrorControlExcel } = await import("@/hooks/useControlExcel");

const ESTADO: EstadoControl = {
  ok: true,
  disponible: true,
  cliente: "Casa Tomás",
  archivo: { id: "abc", nombre: "Control_OFICIOSOSIA.xlsm", modificado: "2026-11-17T06:55:38.957Z", url: "https://drive.google.com/file/d/abc/view" },
  revision: "rev-1",
  soloLectura: false,
  ficha: { estado: "Activo", desde: "2026-11-09", instalacionPactada: 1500, cuotaPactada: 600, diaCobro: 28, notas: "Primer pago con extras" },
  cobros: [
    { fila: 7, fechaPrevista: "2026-11-13", fechaCobro: null, tipo: "Instalación", detalle: "Instalación inicial", pactado: 1500, cobrado: null, pendiente: 1500, estado: "Pendiente", recibidoPor: "", metodo: "Efectivo", notas: "", comprobar: "" },
    { fila: 9, fechaPrevista: "2026-11-13", fechaCobro: "2026-11-15", tipo: "Mensualidad", detalle: "Noviembre", pactado: 600, cobrado: 600, pendiente: 0, estado: "Cobrado", recibidoPor: "", metodo: "Bizum", notas: "", comprobar: "Falta receptor" },
  ],
  gastos: [
    { fila: 8, fecha: "2026-11-01", proveedor: "OpenAI", tipo: "IA", detalle: "Noviembre", importe: null, pagadoPor: "", repercutir: "", metodo: "", notas: "", comprobar: "" },
    { fila: 11, fecha: "2026-11-01", proveedor: "Vercel", tipo: "Hosting", detalle: "Noviembre", importe: 20.75, pagadoPor: "Miguel", repercutir: "Sí", metodo: "Tarjeta", notas: "", comprobar: "" },
  ],
  resumen: {
    cobradoTotal: 600, instalacionCobrada: 0, instalacionPendiente: 1500, cuotasCobradas: 600, reembolsosCobrados: 0, otrosCobrados: 0,
    pendienteCobro: 1500, cobrosPendientes: 1, gastosRepercutibles: 20.75, costesPorRecuperar: 20.75, gastosTotal: 20.75, avisos: 1,
  },
  listas: {
    estados: ["Activo", "Pausado", "Finalizado"],
    tiposCobro: ["Instalación", "Mensualidad", "Reembolso gastos", "Otro"],
    receptores: ["Caja común", "Miguel", "Pablo"],
    metodos: ["Transferencia", "Bizum", "Efectivo", "Tarjeta", "Otro"],
    tiposGasto: ["IA", "Hosting", "Dominio", "API", "Licencia", "Otros"],
    pagadores: ["Caja común", "Miguel", "Pablo"],
    metodosGasto: ["Transferencia", "Bizum", "Efectivo", "Tarjeta", "Otro"],
    repercutir: ["Sí", "No"],
  },
  filasLibres: { cobros: 497, gastos: 495 },
};

const conDatos = (datos: EstadoControl | ControlNoDisponible) => {
  h.consulta = { isLoading: false, isError: false, isFetching: false, data: datos, error: null };
};
const escribir = (etiqueta: string | RegExp, valor: string) => fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });

beforeEach(() => {
  vi.clearAllMocks();
  h.pendiente = false;
  h.cambiar.mockResolvedValue(ESTADO);
  conDatos(ESTADO);
});

describe("ControlExcel", () => {
  it("cargando, error con reintentar y «no disponible» con qué hacer", () => {
    h.consulta = { isLoading: true };
    const { rerender } = render(<ControlExcel />);
    expect(screen.getByRole("status")).toHaveTextContent("Abriendo el Excel de control");

    h.consulta = { isLoading: false, isError: true, isFetching: false, data: undefined, error: new ErrorControlExcel("No se pudo contactar con la función «control-excel» (¿está desplegada en este proyecto?).", "sin_funcion", 0) };
    rerender(<ControlExcel />);
    expect(screen.getByRole("alert")).toHaveTextContent("¿está desplegada en este proyecto?");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);

    conDatos({ ok: true, disponible: false, motivo: "sin_acceso", mensaje: "La cuenta de Google del panel (panel@oficiososia.test) no puede ver el Excel de control. Compártelo con esa cuenta como editor.", cliente: "Casa Tomás", cuentaGoogle: "panel@oficiososia.test" });
    rerender(<ControlExcel />);
    const aviso = screen.getByRole("alert");
    expect(aviso).toHaveTextContent("El panel no puede abrir el Excel");
    expect(aviso).toHaveTextContent("Compártelo con esa cuenta como editor");
    expect(within(aviso).getByText("panel@oficiososia.test")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Volver a comprobar" }));
    expect(h.refetch).toHaveBeenCalledTimes(2);

    conDatos({ ok: true, disponible: false, motivo: "sin_config", mensaje: "Este entorno no tiene configurada la cuenta de Google.", cliente: "Casa Tomás" });
    rerender(<ControlExcel />);
    expect(screen.getByRole("alert")).toHaveTextContent("En la demo es lo normal");
  });

  it("enseña el estado SOLO de este cliente: cabecera, tarjetas, ficha, cobros y gastos", () => {
    render(<ControlExcel />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Casa TomásActivo");
    expect(screen.getByText(/Excel «Control_OFICIOSOSIA\.xlsm» · modificado el 17\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Abrir en Drive/ })).toHaveAttribute("href", "https://drive.google.com/file/d/abc/view");

    const estado = screen.getByRole("group", { name: "Estado del cliente" });
    expect(estado).toHaveTextContent(/Instalación1\.?500,00\s€ pendientePactada: 1\.?500,00\s€Cobrada: 0,00\s€/);
    expect(estado).toHaveTextContent(/Cuota mensual600,00\s€ al mesDía de cobro: 28Cuotas cobradas: 600,00\s€/);
    expect(estado).toHaveTextContent(/Pendiente de cobro1\.?500,00\s€1 cobro pendienteCobrado en total: 600,00\s€/);
    expect(estado).toHaveTextContent(/Gastos por recuperar20,75\s€Repercutibles: 20,75\s€Reembolsados: 0,00\s€/);

    const ficha = screen.getByRole("region", { name: "Ficha del cliente" });
    expect(ficha).toHaveTextContent("Cliente desde09/11/2026");
    expect(ficha).toHaveTextContent("Primer pago con extras");

    const instalacion = screen.getByTestId("cobro-7");
    expect(instalacion).toHaveTextContent("Instalación inicial");
    expect(instalacion).toHaveTextContent("Previsto: 13/11/2026");
    expect(within(instalacion).getByText("Pendiente")).toBeInTheDocument();
    expect(within(instalacion).getByRole("button", { name: /Marcar cobrado/ })).toBeEnabled();
    const mensualidad = screen.getByTestId("cobro-9");
    expect(mensualidad).toHaveTextContent("Cobrado: 15/11/2026");
    expect(mensualidad).toHaveTextContent("Falta receptor");
    // Ya cobrado: no hay nada que marcar.
    expect(within(mensualidad).queryByRole("button", { name: /Marcar cobrado/ })).not.toBeInTheDocument();

    expect(screen.getByTestId("gasto-8")).toHaveTextContent("Sin importe");
    expect(screen.getByTestId("gasto-8")).toHaveTextContent("Sin decidir");
    expect(screen.getByTestId("gasto-11")).toHaveTextContent("Se repercute");
    expect(screen.getByTestId("gasto-11")).toHaveTextContent("lo paga Miguel · Tarjeta");
    expect(screen.getByRole("region", { name: "Gastos del cliente" })).toHaveTextContent(/Total gastado en este cliente: 20,75\s€/);
  });

  it("«Marcar cobrado» pide quién lo recibe y apunta el cobro entero con fecha de hoy", async () => {
    render(<ControlExcel />);
    fireEvent.click(within(screen.getByTestId("cobro-7")).getByRole("button", { name: /Marcar cobrado/ }));
    const dialogo = await screen.findByRole("dialog", { name: "Marcar cobrado" });
    expect(dialogo).toHaveTextContent(/Instalación · Instalación inicial: se apunta como cobrado entero, 1\.?500,00\s€/);
    expect(screen.getByLabelText("Fecha de cobro")).toHaveValue(hoyIso());
    fireEvent.click(within(dialogo).getByRole("button", { name: "Marcar cobrado" }));
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("Indica quién ha recibido el dinero.");
    expect(h.cambiar).not.toHaveBeenCalled();

    escribir("Recibido por", "Pablo");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Marcar cobrado" }));
    await waitFor(() => expect(h.cambiar).toHaveBeenCalledTimes(1));
    expect(h.cambiar).toHaveBeenCalledWith({
      accion: "guardar_cobro",
      cobro: { fila: 7, tipo: "Instalación", detalle: "Instalación inicial", pactado: 1500, fechaPrevista: "2026-11-13", cobrado: 1500, fechaCobro: hoyIso(), recibidoPor: "Pablo", metodo: "Efectivo", notas: "" },
    });
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Cobro marcado como cobrado"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("nuevo cobro: valida aquí, manda lo escrito y enseña en el diálogo lo que rechace el Excel", async () => {
    render(<ControlExcel />);
    fireEvent.click(screen.getByRole("button", { name: /Nuevo cobro/ }));
    const dialogo = await screen.findByRole("dialog", { name: "Nuevo cobro" });
    const guardar = within(dialogo).getByRole("button", { name: "Guardar en el Excel" });
    fireEvent.click(guardar);
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("Elige el tipo de cobro.");
    escribir("Tipo de cobro", "Mensualidad");
    escribir("Importe pactado (€)", "abc");
    fireEvent.click(guardar);
    expect(within(dialogo).getByRole("alert")).toHaveTextContent("Escribe el importe pactado");
    expect(h.cambiar).not.toHaveBeenCalled();

    escribir("Importe pactado (€)", "600,50");
    escribir("Mes / detalle", " Diciembre ");
    escribir("Fecha prevista", "2026-12-28");
    h.cambiar.mockRejectedValueOnce(new ErrorControlExcel("«Fecha prevista» tiene un año fuera de rango.", "datos_invalidos", 400));
    fireEvent.click(guardar);
    expect(await within(dialogo).findByText("«Fecha prevista» tiene un año fuera de rango.")).toBeInTheDocument();
    expect(h.toast.error).not.toHaveBeenCalled();

    fireEvent.click(guardar);
    await waitFor(() => expect(h.cambiar).toHaveBeenCalledTimes(2));
    expect(h.cambiar).toHaveBeenLastCalledWith({
      accion: "guardar_cobro",
      cobro: { tipo: "Mensualidad", detalle: "Diciembre", pactado: 600.5, fechaPrevista: "2026-12-28", cobrado: null, fechaCobro: null, recibidoPor: "", metodo: "", notas: "" },
    });
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Cobro apuntado en el Excel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("editar un gasto a medias y borrar otro (con confirmación)", async () => {
    render(<ControlExcel />);
    fireEvent.click(screen.getByRole("button", { name: "Editar gasto: OpenAI · Noviembre" }));
    const dialogo = await screen.findByRole("dialog", { name: "Editar gasto" });
    expect(screen.getByLabelText("Proveedor")).toHaveValue("OpenAI");
    escribir("Importe (€)", "12,3");
    escribir("Pagado por", "Miguel");
    escribir("¿Repercutir al cliente?", "Sí");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar en el Excel" }));
    await waitFor(() => expect(h.cambiar).toHaveBeenCalledWith({
      accion: "guardar_gasto",
      gasto: { fila: 8, proveedor: "OpenAI", tipo: "IA", detalle: "Noviembre", importe: 12.3, fecha: "2026-11-01", pagadoPor: "Miguel", repercutir: "Sí", metodo: "", notas: "" },
    }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Gasto actualizado en el Excel"));

    fireEvent.click(screen.getByRole("button", { name: "Borrar gasto: Vercel · Noviembre" }));
    const confirmar = await screen.findByRole("alertdialog", { name: "Borrar gasto" });
    expect(confirmar).toHaveTextContent(/«Vercel · Noviembre» \(20,75\s€\)/);
    fireEvent.click(within(confirmar).getByRole("button", { name: "Borrar" }));
    await waitFor(() => expect(h.cambiar).toHaveBeenLastCalledWith({ accion: "borrar_gasto", fila: 11 }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Gasto borrado del Excel"));
  });

  it("editar la ficha manda lo pactado", async () => {
    render(<ControlExcel />);
    fireEvent.click(screen.getByRole("button", { name: /Editar ficha/ }));
    const dialogo = await screen.findByRole("dialog", { name: "Ficha de Casa Tomás" });
    expect(screen.getByLabelText("Instalación pactada (€)")).toHaveValue("1500");
    escribir("Cuota pactada (€ al mes)", "650,5");
    escribir("Día de cobro (1–31)", "40");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar en el Excel" }));
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("entre 1 y 31");
    escribir("Día de cobro (1–31)", "5");
    escribir("Estado", "Pausado");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar en el Excel" }));
    await waitFor(() => expect(h.cambiar).toHaveBeenCalledWith({
      accion: "guardar_ficha",
      ficha: { estado: "Pausado", desde: "2026-11-09", instalacionPactada: 1500, cuotaPactada: 650.5, diaCobro: 5, notas: "Primer pago con extras" },
    }));
  });

  it("si el Excel cambió por fuera (409): avisa, cierra y recarga", async () => {
    h.cambiar.mockRejectedValueOnce(new ErrorControlExcel("El Excel ha cambiado desde que lo cargaste (alguien lo ha editado). Recarga para ver lo último y repite el cambio.", "conflicto", 409));
    render(<ControlExcel />);
    fireEvent.click(screen.getByRole("button", { name: "Borrar cobro: Mensualidad · Noviembre" }));
    fireEvent.click(within(await screen.findByRole("alertdialog", { name: "Borrar cobro" })).getByRole("button", { name: "Borrar" }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(expect.stringContaining("El Excel ha cambiado")));
    expect(h.cambiar).toHaveBeenCalledWith({ accion: "borrar_cobro", fila: 9 });
    expect(h.refetch).toHaveBeenCalledTimes(1);
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("solo lectura: lo dice, con la cuenta a la que dar permiso, y no deja cambiar nada", () => {
    conDatos({ ...ESTADO, soloLectura: true, cuentaGoogle: "panel@oficiososia.test" });
    render(<ControlExcel />);
    expect(screen.getByRole("alert")).toHaveTextContent("Solo lectura: la cuenta de Google del panel (panel@oficiososia.test) no puede editar el Excel");
    for (const nombre of [/Editar ficha/, /Nuevo cobro/, /Nuevo gasto/, /Marcar cobrado/, "Editar cobro: Instalación · Instalación inicial", "Borrar gasto: Vercel · Noviembre"]) {
      expect(screen.getByRole("button", { name: nombre })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: /Recargar/ })).toBeEnabled();
  });

  it("sin filas libres en el Excel no deja apuntar más", () => {
    conDatos({ ...ESTADO, filasLibres: { cobros: 0, gastos: 0 } });
    render(<ControlExcel />);
    expect(screen.getByRole("button", { name: /Nuevo cobro/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Nuevo gasto/ })).toBeDisabled();
    expect(within(screen.getByTestId("cobro-7")).getByRole("button", { name: /Marcar cobrado/ })).toBeEnabled();
  });
});
