import { euros, tituloRecibo, totalesRecibo, type Factura } from "./modelo";

/**
 * Vista previa del recibo (17/11/2026): sin membrete (ni logo ni franja de marca) y sin ningún
 * dato fiscal (NIF, dirección, IVA, retención, vencimiento). Solo quién paga, qué paga y cuánto.
 * El PDF (`pdf.ts`) pinta lo mismo.
 */
export function VistaFactura({ factura: f }: { factura: Factura }) {
  const t = totalesRecibo(f);
  const bruto = t.lineas.reduce((sum,l)=>sum+l.bruto,0);
  const hayDescuento = t.descuentosLineas > 0 || (f.descuentoGlobal ?? 0) > 0;
  const fecha = (v: string) => v ? v.split("-").reverse().join("/") : "—";
  return (
    <article aria-label="Vista previa del recibo" className="overflow-hidden rounded-xl border bg-white text-[#191919] shadow-sm">
      <div className="space-y-6 p-5 sm:p-7">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[#191919] pb-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-wider">RECIBO</h2>
            <p className="break-words text-sm text-[#555]">{tituloRecibo(f)}</p>
          </div>
          <div className="text-right text-sm">
            <p className="break-all font-semibold">{f.numero || "Número pendiente"}</p>
            <p>Fecha: <strong>{fecha(f.fecha)}</strong></p>
          </div>
        </header>
        <section className="min-w-0 text-sm">
          <h3 className="mb-1 text-xs font-bold uppercase tracking-widest text-[#777]">Recibí de</h3>
          <p className="break-words font-semibold">{f.cliente.nombre || "Cliente pendiente"}</p>
        </section>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[430px] text-left text-xs">
            <thead className="bg-[#eeeeee]"><tr>{["Concepto","Ud.","Precio","Importe"].map((h,i) => <th key={h} className={"px-2 py-3 font-semibold " + (i ? "text-right" : "")}>{h}</th>)}</tr></thead>
            <tbody>{t.lineas.map(l => <tr key={l.id} className="border-b border-[#dddddd] align-top">
              <td className="max-w-[210px] break-words px-2 py-3"><p className="font-medium">{l.concepto || "Concepto pendiente"}</p>
                {l.descuento > 0 && <p className="mt-1 text-[10px] pointer-coarse:text-xs text-[#666]">Dto. {l.descuento}%</p>}</td>
              <td className="px-2 py-3 text-right">{l.cantidad}</td><td className="whitespace-nowrap px-2 py-3 text-right">{euros(l.precio)}</td>
              <td className="whitespace-nowrap px-2 py-3 text-right">{euros(l.baseAntesGlobal)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <dl className="ml-auto max-w-sm space-y-2 text-sm">
          {hayDescuento && <><div className="flex justify-between gap-4"><dt>Antes de los descuentos</dt><dd>{euros(bruto)}</dd></div>
            {(f.descuentoGlobal ?? 0) > 0 && <><div className="flex justify-between gap-4"><dt>Antes del descuento global</dt><dd>{euros(t.subtotal)}</dd></div>
            <div className="flex justify-between gap-4"><dt>Descuento global {f.descuentoGlobal}%</dt><dd>−{euros(t.descuentoGlobal)}</dd></div></>}
            <div className="flex justify-between gap-4 font-medium"><dt>Descuento total aplicado</dt><dd>−{euros(t.descuentosLineas+t.descuentoGlobal)}</dd></div></>}
          <div className="flex justify-between gap-4 border-y-2 border-[#191919] px-1 py-3 text-base font-bold"><dt>TOTAL</dt><dd>{euros(t.total)}</dd></div>
        </dl>
        {f.pago && <section className="text-xs"><h3 className="mb-2 font-bold uppercase">Forma de pago</h3><p className="whitespace-pre-wrap break-words">{f.pago}</p></section>}
        {f.notas && <section className="text-xs"><h3 className="mb-2 font-bold uppercase">Observaciones</h3><p className="whitespace-pre-wrap break-words">{f.notas}</p></section>}
        <footer className="border-t border-[#dddddd] pt-3 text-[10px] pointer-coarse:text-xs text-[#777]">{[f.emisor.nombre.trim() && "Emitido por " + f.emisor.nombre.trim(), "Recibo " + (f.numero || "en borrador")].filter(Boolean).join(" · ")}</footer>
      </div>
    </article>
  );
}
