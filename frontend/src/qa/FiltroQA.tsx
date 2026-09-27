/** Filtro de épicas por persona asignada a pruebas.
 *
 * Presentacional: recibe la lista de personas y el GUID activo, y emite el
 * cambio. No conoce React Query ni el hash.
 *
 * Solo ofrece a quienes **tienen** alguna épica asignada, más una entrada para
 * quitar el filtro. Ofrecer a los 35 del proyecto dejaría un desplegable en el
 * que 30 opciones no devuelven nada, y no hay forma de saber de antemano
 * cuáles son ésos sin llamar a la API.
 */

import type { PersonaQA } from "../api/tipos";

export function FiltroQA({
  personas,
  seleccionado = "",
  cargando = false,
  onCambiar,
}: {
  personas: PersonaQA[];
  /** GUID de la persona activa; vacío = sin filtro. */
  seleccionado?: string;
  cargando?: boolean;
  onCambiar: (guid: string) => void;
}) {
  const conEpicas = personas
    .filter((p) => p.epicas > 0)
    .sort((a, b) => b.epicas - a.epicas || a.nombre.localeCompare(b.nombre));

  // La persona activa puede tener 0 épicas (acaba de desasignarse, o la URL
  // viene de otra persona). Si no aparece en la lista, se añade con su nombre
  // real para que el filtro no parezca haberse borrado solo.
  const activa = personas.find((p) => p.guid.toLowerCase() === seleccionado.toLowerCase());
  const opciones =
    activa && !conEpicas.some((p) => p.guid === activa.guid) ? [activa, ...conEpicas] : conEpicas;

  const totalEpicas = conEpicas.reduce((suma, p) => suma + p.epicas, 0);

  return (
    <div className="filtro-qa">
      <label className="filtro-campo" htmlFor="f-qa">
        <span className="etiqueta-filtro">Épicas de</span>
        <select
          id="f-qa"
          value={seleccionado}
          disabled={cargando}
          onChange={(e) => onCambiar(e.target.value)}
        >
          <option value="">
            {conEpicas.length === 0
              ? "Nadie tiene épicas asignadas"
              : `Todas (${personas.length} personas)`}
          </option>
          {opciones.map((p) => (
            <option key={p.guid} value={p.guid}>
              {p.nombre} ({p.epicas})
              {p.es_qa ? " · QA" : p.es_dev ? " · dev" : ""}
            </option>
          ))}
        </select>
      </label>

      {seleccionado && (
        <button
          type="button"
          className="btn secundario small"
          onClick={() => onCambiar("")}
        >
          Quitar filtro
        </button>
      )}

      {!seleccionado && totalEpicas > 0 && (
        <span className="texto-suave small">
          {totalEpicas} épica{totalEpicas === 1 ? "" : "s"} con responsable de
          pruebas, de {personas.length} personas
        </span>
      )}
    </div>
  );
}
