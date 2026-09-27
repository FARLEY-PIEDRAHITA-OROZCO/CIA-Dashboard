/** Paginación de la tabla de ítems: presentacional.
 *
 * El backend limita cada respuesta a 200 ítems para no volcar el proyecto
 * entero en el navegador, pero con estas páginas **nada queda fuera de
 * alcance**: el total real viaja aparte y la hoja se puede recorrer entera.
 */

import { ITEMS_POR_PAGINA } from "../navegacion";

export function Paginacion({
  hoja,
  total,
  hayMas,
  porPagina = ITEMS_POR_PAGINA,
  onCambiar,
}: {
  /** Hoja actual, 1-based. */
  hoja: number;
  total: number;
  hayMas: boolean;
  /**
   * Elementos por hoja. Por defecto `ITEMS_POR_PAGINA`.
   *
   * Es un parámetro y no una constante porque las dos listas que pagina esta
   * vista tienen tamaños distintos: 200 ítems del índice y 50 historias sin
   * caso. Fijar 200 para las dos daría ocho páginas de 361 filas de las que
   * nadie avanza.
   */
  porPagina?: number;
  onCambiar: (hoja: number) => void;
}) {
  const porHoja = Math.max(1, Math.floor(porPagina));
  const hojas = Math.max(1, Math.ceil(total / porHoja));
  if (total <= porHoja) return null;

  const desde = (Math.max(1, Math.floor(hoja)) - 1) * porHoja + 1;
  const hasta = Math.min((Math.max(1, Math.floor(hoja)) - 1) * porHoja + porHoja, total);

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
        Hoja {hoja} de {hojas} · {desde}-{hasta} de {total}
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
