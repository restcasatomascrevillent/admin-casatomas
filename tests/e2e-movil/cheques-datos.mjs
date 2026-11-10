// Datos sintéticos de cheques regalo para las capturas de Cheques › Stripe (cheques-stripe.capturas.mjs).
// Nada real: importes y fechas inventados de forma determinista, sin nombres ni correos.
//
// `filasCheques()` imita la tabla cheques_regalo; `metricas()` e `informe()` responden como las RPC
// metricas_cheques_regalo e informe_cheques_regalo (mismos filtros y campos que el SQL).

const ruido = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
const pad = (n) => String(n).padStart(2, "0");
const isoDia = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoLocal = (d) => `${isoDia(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const IMPORTES = [25, 50, 50, 50, 75, 100, 100, 150, 200];

/** Unos 120 días de ventas: 0-3 al día (más en fin de semana y en el puente de diciembre), con canjes y caducidad a un año. */
export function filasCheques(hoy = new Date()) {
  const filas = [];
  for (let atras = 120; atras >= 0; atras--) {
    const dia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - atras);
    const peso = [1.3, 0.5, 0.5, 0.6, 0.8, 1.4, 1.6][dia.getDay()];
    const ventas = Math.floor(ruido(atras) * 2.2 * peso + (atras < 40 ? 0.6 : 0));
    for (let i = 0; i < ventas; i++) {
      const n = atras * 10 + i;
      const hora = [11, 13, 17, 19, 20, 21, 22, 10][Math.floor(ruido(n + 3) * 8)];
      const creado = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), hora, Math.floor(ruido(n + 7) * 59));
      const tipo = ruido(n + 11);
      const origen = tipo < 0.82 ? "web" : "manual";
      const metodo = origen === "web" ? null : tipo < 0.94 ? "efectivo" : "cortesia";
      const importe = IMPORTES[Math.floor(ruido(n + 13) * IMPORTES.length)];
      const gastos = origen === "web" && atras < 30 ? Math.round(((importe + 0.25) / (1 - 0.015) - importe) * 100) / 100 : 0;
      const canjeado = ruido(n + 17) < Math.min(0.75, atras / 90) ? new Date(creado.getTime() + (3 + ruido(n + 19) * Math.max(1, atras - 3)) * 864e5) : null;
      const reembolsado = origen === "web" && ruido(n + 23) > 0.97;
      filas.push({
        id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
        created_at: creado.toISOString(),
        creado_local: isoLocal(creado),
        importe_eur: importe,
        gastos_gestion_eur: gastos,
        stripe_fee_eur: origen === "web" && atras < 60 ? Math.round(((importe + gastos) * 0.015 + 0.25) * 100) / 100 : null,
        estado: reembolsado ? "cancelado" : "pagado",
        origen,
        pago_manual_metodo: metodo,
        stripe_payment_intent_id: origen === "web" ? `pi_sim_${n}` : null,
        usado: !!canjeado && canjeado < hoy && !reembolsado,
        canjeado_local: canjeado && canjeado < hoy && !reembolsado ? isoLocal(canjeado) : null,
        caduca_el: isoDia(new Date(creado.getFullYear() + 1, creado.getMonth(), creado.getDate())),
      });
    }
  }
  return filas;
}

const enRango = (localDia, desde, hasta) => (!desde || localDia >= desde) && (!hasta || localDia <= hasta);

/** Como metricas_cheques_regalo: solo pagos por Stripe (web, con payment intent), por fecha local. */
export function metricas(filas, { p_desde, p_hasta }) {
  const pagos = filas.filter((f) => f.estado === "pagado" && f.origen !== "manual" && f.stripe_payment_intent_id && enRango(f.creado_local.slice(0, 10), p_desde, p_hasta));
  const fee = (f) => f.stripe_fee_eur ?? Math.round(((f.importe_eur + f.gastos_gestion_eur) * 0.015 + 0.25) * 100) / 100;
  const suma = (xs, g) => Math.round(xs.reduce((a, x) => a + g(x), 0) * 100) / 100;
  const porHora = new Map(); const porDia = new Map();
  for (const p of pagos) {
    const h = Number(p.creado_local.slice(11, 13)); porHora.set(h, (porHora.get(h) ?? 0) + 1);
    const d = p.creado_local.slice(0, 10); const v = porDia.get(d) ?? { pagos: 0, bruto_eur: 0 };
    porDia.set(d, { pagos: v.pagos + 1, bruto_eur: Math.round((v.bruto_eur + p.importe_eur + p.gastos_gestion_eur) * 100) / 100 });
  }
  return {
    pagos: pagos.length,
    bruto_eur: suma(pagos, (p) => p.importe_eur + p.gastos_gestion_eur),
    valor_cheques_eur: suma(pagos, (p) => p.importe_eur),
    gastos_gestion_eur: suma(pagos, (p) => p.gastos_gestion_eur),
    pagos_con_gastos: pagos.filter((p) => p.gastos_gestion_eur > 0).length,
    comision_eur: suma(pagos, fee),
    neto_eur: suma(pagos, (p) => p.importe_eur + p.gastos_gestion_eur - fee(p)),
    comision_incompleta: pagos.some((p) => p.stripe_fee_eur === null),
    por_hora: [...porHora].sort((a, b) => a[0] - b[0]).map(([hora, n]) => ({ hora, pagos: n })),
    por_dia: [...porDia].sort().map(([dia, v]) => ({ dia, ...v })),
  };
}

/** Como informe_cheques_regalo: filas sin datos personales que hacen falta para el periodo y su comparación. */
export function informe(filas, { p_desde, p_hasta }, hoy = new Date()) {
  const cheques = filas
    .filter((f) => f.estado === "pagado" || f.stripe_payment_intent_id)
    .filter((f) => {
      const dia = f.creado_local.slice(0, 10);
      if (dia > p_hasta) return false;
      if (dia >= p_desde) return true;
      return (!f.canjeado_local || f.canjeado_local.slice(0, 10) >= p_desde) && (!f.caduca_el || f.caduca_el >= p_desde);
    })
    .map((f) => ({
      creado: f.creado_local,
      importe_eur: f.importe_eur,
      gastos_gestion_eur: f.gastos_gestion_eur,
      stripe_fee_eur: f.stripe_fee_eur,
      canal: f.origen === "manual" ? (f.pago_manual_metodo === "cortesia" ? "cortesia" : "manual") : "web",
      estado: f.estado === "pagado" ? "pagado" : "reembolsado",
      canjeado: f.canjeado_local,
      caduca_el: f.caduca_el,
    }));
  return { desde: p_desde, hasta: p_hasta, hoy: isoDia(hoy), cheques };
}
