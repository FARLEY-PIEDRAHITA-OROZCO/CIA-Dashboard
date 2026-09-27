/** Paginación de la tabla de ítems: presentacional.
 *
 * El backend limita cada respuesta a 200 ítems para no volcar el proyecto
 * entero en el navegador, pero con estas páginas **nada queda fuera de
 * alcance**: el total real viaja aparte y la hoja se puede recorrer entera.
 */

import { hojaAOffset, ITEMS_POR_PAGINA, totalHojas } from "../navegacion";

export function Paginacion({
  hoja,
  total,
  hayMas,
  onCambiar,
}: {
  /** Hoja actual, 1-based. */
  hoja: number;
  total: number;
  hayMas: boolean;
  onCambiar: (hoja: number) => void;
}) {
  const hojas = totalHojas(total);
  if (total <= ITEMS_POR_PAGINA) return null;

  const desde = hojaAOffset(hoja) + 1;
  const hasta = Math.min(hojaAOffset(hoja) + ITEMS_POR_PAGINA, total);

  return (
    <nav className="paginacion" aria-label="Paginación de ítems">
      <button
        type="button"
        className="btn secundario small"
        onClick={() => onCambiar(hoja - 1)}
        disabled={hoja <= 1}
      >
        ← Anterior
      </button>
      <span className="texto-suave small" aria-live="polite">
        Hoja {hoja} de {hojas} · ítems {desde}–{hasta} de {total}
      </span>
      <button
        type="button"
        className="btn secundario small"
        onClick={() => onCambiar(hoja + 1)}
        disabled={!hayMas || hoja >= hojas}
      >
        Siguiente →
      </button>
    </nav>
  );
}
