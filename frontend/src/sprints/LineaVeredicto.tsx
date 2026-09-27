/** Línea de veredicto: una frase en vez de una fila de KPIs.
 *
 * Presentacional. Recibe las partes ya calculadas (`veredicto.ts`).
 */

import type { Veredicto } from "./veredicto";

export function LineaVeredicto({ veredicto }: { veredicto: Veredicto }) {
  return (
    // Región viva propia: al elegir otro sprint, un lector de pantalla anuncia
    // el nuevo veredicto en lugar de un «cargando» genérico. El nombre la
    // distingue de los otros `role="status"` de la página.
    <div className="veredicto" data-tono={veredicto.tono} role="status" aria-label="Veredicto">
      <p className="veredicto-titular">{veredicto.titular}</p>
      {veredicto.detalle && <p className="veredicto-detalle">{veredicto.detalle}</p>}
    </div>
  );
}
