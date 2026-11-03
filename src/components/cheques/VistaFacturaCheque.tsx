import { CASA_TOMAS } from "@/lib/cheques/casaTomas";

interface DatosPlantilla {
  emisor_nombre: string;
  emisor_nif: string;
  emisor_direccion: string;
  logo_data: string;
  iva_porcentaje: number;
  pie: string;
}
const euro = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

export function VistaFacturaCheque({ plantilla }: { plantilla: DatosPlantilla }) {
  const base = Math.round(10000 / (1 + plantilla.iva_porcentaje / 100)) / 100;
  return <article className="overflow-hidden rounded-xl border border-[#e5ddd0] bg-white text-[#302923] shadow-[0_12px_40px_-24px_rgba(60,40,20,.35)] break-words" aria-label="Vista previa de factura">
    <header className="bg-[#f7f3eb] border-b border-[#e5ddd0] p-5 sm:p-8">
      <div className="flex items-center justify-between gap-4">
        {plantilla.logo_data ? <img src={plantilla.logo_data} alt="Logo del emisor" className="w-32 sm:w-40 h-28 object-contain" /> : <h2 className="font-serif text-2xl">{plantilla.emisor_nombre || CASA_TOMAS.nombre}</h2>}
        <div className="text-right"><p className="text-[10px] pointer-coarse:text-xs tracking-[.16em] uppercase text-[#8b725a]">Cheque regalo</p><h2 className="font-serif text-3xl sm:text-4xl mt-2">Factura</h2><p className="mt-2 text-xs font-mono text-[#796957]">CT-00000001</p></div>
      </div>
      <div className="mt-5 pt-4 border-t border-[#e5ddd0] flex justify-between gap-4 text-xs text-[#796957]"><span>Crevillent · Alicante</span><span>{new Date().toLocaleDateString("es-ES")}</span></div>
    </header>
    <div className="p-5 sm:p-8 space-y-7">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs leading-relaxed">
        <section><h3 className="uppercase tracking-[.12em] text-[10px] pointer-coarse:text-xs text-[#927b62] mb-2">Emitida por</h3><p className="font-semibold text-sm mb-1">{plantilla.emisor_nombre || "Razón social del emisor"}</p><p className={!plantilla.emisor_nif ? "text-amber-700" : ""}>NIF: {plantilla.emisor_nif || "Pendiente de completar"}</p><p className="mt-1">{plantilla.emisor_direccion || "Dirección fiscal del emisor"}</p></section>
        <section><h3 className="uppercase tracking-[.12em] text-[10px] pointer-coarse:text-xs text-[#927b62] mb-2">Facturada a · ejemplo</h3><p className="font-semibold text-sm mb-1">Nombre del comprador</p><p>NIF: 12345678Z</p><p className="mt-1">Dirección fiscal del comprador</p><p>cliente@ejemplo.com</p></section>
      </div>
      <div><div className="flex justify-between gap-4 border-y border-[#e5ddd0] bg-[#faf8f4] p-3 text-[10px] pointer-coarse:text-xs uppercase tracking-wider text-[#796957]"><span>Descripción</span><span>Importe</span></div><div className="flex justify-between gap-4 py-5 text-sm"><div><p className="font-semibold">Cheque regalo Casa Tomás</p><p className="text-xs text-[#927b62] mt-1">1 unidad · Compra en la web</p></div><p className="whitespace-nowrap font-medium">100,00 €</p></div></div>
      <div className="ml-auto max-w-xs space-y-2 text-xs"><p className="flex justify-between gap-4"><span className="text-[#796957]">Base imponible</span><span>{euro(base)}</span></p>{plantilla.iva_porcentaje > 0 && <p className="flex justify-between gap-4"><span className="text-[#796957]">IVA ({plantilla.iva_porcentaje}%)</span><span>{euro(100 - base)}</span></p>}<div className="flex justify-between items-center gap-4 mt-3 rounded-lg bg-[#795440] text-white p-4"><span className="text-xs">TOTAL PAGADO</span><span className="font-serif text-2xl whitespace-nowrap">100,00 €</span></div></div>
      <p className="text-[10px] pointer-coarse:text-xs text-[#927b62]">Pago confirmado mediante Stripe</p>
      <footer className="border-t border-[#e5ddd0] pt-5 text-[10px] pointer-coarse:text-xs leading-relaxed text-[#796957] whitespace-pre-line">{plantilla.pie}</footer>
    </div>
  </article>;
}
