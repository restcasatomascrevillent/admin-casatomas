import { euros, totalesFactura, type Factura } from "./modelo";

export function VistaFactura({ factura: f }: { factura: Factura }) {
  const t = totalesFactura(f);
  const bruto = t.lineas.reduce((sum,l)=>sum+l.bruto,0);
  const hayDescuento = t.descuentosLineas > 0 || (f.descuentoGlobal ?? 0) > 0;
  const fecha = (v: string) => v ? v.split("-").reverse().join("/") : "—";
  return (
    <article aria-label="Vista previa de factura" className="overflow-hidden rounded-xl border bg-[#fdfcf9] text-[#191919] shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b-4 border-[#ffb300] bg-[#18191a] px-5 py-5">
        <img src="/branding/oficiososia-logo.png" alt="OficiosOsIA" className="h-auto w-44 max-w-full" />
        <div className="text-right"><h2 className="text-xl font-bold tracking-wider text-[#ffb300]">FACTURA</h2>
          <p className="break-all text-sm text-white">{f.numero || "Número pendiente"}</p></div>
      </header>
      <div className="space-y-6 p-5 sm:p-7">
        <div className="grid gap-6 sm:grid-cols-2">
          {([["Emisor", f.emisor], ["Cliente", f.cliente]] as const).map(([rol,p]) => (
            <section key={rol} className="min-w-0 space-y-1 text-sm">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-[#777]">{rol}</h3>
              <p className="break-words font-semibold">{p.nombre || "Razón social pendiente"}</p>
              <p>NIF: {p.nif || "pendiente"}</p>
              <p className="whitespace-pre-wrap break-words">{p.direccion || "Dirección pendiente"}</p>
              <p className="break-all">{p.email}</p>
            </section>
          ))}
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-y border-[#dedbd4] py-3 text-xs">
          <p>Fecha: <strong>{fecha(f.fecha)}</strong></p><p>Vencimiento: <strong>{fecha(f.vencimiento)}</strong></p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[430px] text-left text-xs">
            <thead className="bg-[#eeece7]"><tr>{["Concepto","Ud.","Precio",...(f.aplicarIva===false || f.ivaGlobal!==undefined ? [] : ["IVA"]),"Base"].map((h,i) => <th key={h} className={"px-2 py-3 font-semibold " + (i ? "text-right" : "")}>{h}</th>)}</tr></thead>
            <tbody>{t.lineas.map(l => <tr key={l.id} className="border-b border-[#dedbd4] align-top">
              <td className="max-w-[210px] break-words px-2 py-3"><p className="font-medium">{l.concepto || "Concepto pendiente"}</p>
                <p className="mt-1 text-[10px] text-[#666]">{l.categoria} · {l.periodicidad}{l.descuento > 0 ? " · Dto. " + l.descuento + "%" : ""}</p></td>
              <td className="px-2 py-3 text-right">{l.cantidad}</td><td className="whitespace-nowrap px-2 py-3 text-right">{euros(l.precio)}</td>
              {f.aplicarIva!==false && f.ivaGlobal===undefined && <td className="px-2 py-3 text-right">{l.iva}%</td>}<td className="whitespace-nowrap px-2 py-3 text-right">{euros(l.baseAntesGlobal)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <dl className="ml-auto max-w-sm space-y-2 text-sm">
          {hayDescuento && <><div className="flex justify-between gap-4"><dt>Antes de los descuentos</dt><dd>{euros(bruto)}</dd></div>
            {t.descuentosLineas > 0 && <div className="flex justify-between gap-4"><dt>Descuentos por concepto</dt><dd>−{euros(t.descuentosLineas)}</dd></div>}
            {(f.descuentoGlobal ?? 0) > 0 && <><div className="flex justify-between gap-4"><dt>Antes del descuento global</dt><dd>{euros(t.subtotal)}</dd></div>
            <div className="flex justify-between gap-4"><dt>Descuento global {f.descuentoGlobal}%</dt><dd>−{euros(t.descuentoGlobal)}</dd></div></>}
            <div className="flex justify-between gap-4 font-medium"><dt>Descuento total aplicado</dt><dd>−{euros(t.descuentosLineas+t.descuentoGlobal)}</dd></div></>}
          <div className="flex justify-between gap-4"><dt>{hayDescuento ? "Después de los descuentos" : "Base imponible"}</dt><dd>{euros(t.base)}</dd></div>
          {t.grupos.map(g => <div key={g.tipo} className="flex justify-between gap-4"><dt>IVA {g.tipo}%</dt><dd>{euros(g.importe)}</dd></div>)}
          {f.retencion > 0 && <div className="flex justify-between gap-4"><dt>Retención {f.retencion}%</dt><dd>−{euros(t.retencion)}</dd></div>}
          <div className="flex justify-between gap-4 bg-[#ffb300] px-3 py-3 text-base font-bold"><dt>TOTAL</dt><dd>{euros(t.total)}</dd></div>
        </dl>
        {hayDescuento && <p className="text-right text-xs text-[#666]">Los descuentos se aplican antes de los impuestos.</p>}
        {f.pago && <section className="text-xs"><h3 className="mb-2 font-bold uppercase">Forma de pago</h3><p className="whitespace-pre-wrap break-words">{f.pago}</p></section>}
        {f.notas && <section className="text-xs"><h3 className="mb-2 font-bold uppercase">Observaciones</h3><p className="whitespace-pre-wrap break-words">{f.notas}</p></section>}
        <footer className="border-t border-[#dedbd4] pt-3 text-[10px] text-[#777]">OficiosOsIA · {f.numero || "Borrador"}</footer>
      </div>
    </article>
  );
}
