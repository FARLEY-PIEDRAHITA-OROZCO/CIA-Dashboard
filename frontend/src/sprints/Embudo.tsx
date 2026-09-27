/** Embudo de filtros activos: chips que se quitan con un clic.
 *
 * Sustituye a la frase «Estás viendo: sprint Sprint 45 · tipo Bug». La frase era
 * legible pero no manipulable: para quitar un filtro había que volver al
 * desplegable. Aquí cada filtro activo es un botón con su ✕, y con cinco
 * filtros activos ya no hay que contarlos de cabeza.
 *
 * Presentacional: recibe las etiquetas ya resueltas y emite `onQuitar`.
 */

export interface FiltroActivo {
  clave: string;
  etiqueta: string;
}

/** Una pastilla por filtro, con su nombre y su botón de quitar. */
export function Embudo({
  filtros,
  onQuitar,
  onLimpiarTodo,
}: {
  filtros: FiltroActivo[];
  onQuitar: (clave: string) => void;
  onLimpiarTodo: () => void;
}) {
  if (filtros.length === 0) {
    return <p className="embudo-vacio">Sin filtros: se ve todo el proyecto.</p>;
  }
  return (
    <ul className="embudo" aria-label="Filtros activos">
      {filtros.map((f) => (
        <li key={f.clave}>
          <button
            type="button"
            className="chip"
            onClick={() => onQuitar(f.clave)}
            title={`Quitar el filtro «${f.etiqueta}»`}
          >
            {f.etiqueta} <span aria-hidden="true">✕</span>
            <span className="visualmente-oculto">: quitar filtro</span>
          </button>
        </li>
      ))}
      {filtros.length > 1 && (
        <li>
          <button
            type="button"
            className="btn secundario small chip-limpiar"
            onClick={onLimpiarTodo}
          >
            Limpiar {filtros.length}
          </button>
        </li>
      )}
    </ul>
  );
}
