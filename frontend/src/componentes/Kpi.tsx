import type { ReactNode } from "react";

/** Tarjeta de indicador (KPI) del dashboard. */
export function Kpi({
  etiqueta,
  valor,
  tono,
  titulo,
}: {
  etiqueta: string;
  valor: ReactNode;
  tono?: "ok" | "alerta" | "acento" | "neutro";
  titulo?: string;
}) {
  return (
    <div className="kpi" title={titulo}>
      <div className="kpi-valor" data-tono={tono ?? "neutro"}>
        {valor}
      </div>
      <div className="kpi-etiqueta">{etiqueta}</div>
    </div>
  );
}