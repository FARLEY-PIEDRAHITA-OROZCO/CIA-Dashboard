/** Detalle de las épicas asignadas a una persona.
 *
 * Recibe el resultado de la consulta en vez de pedirlo, para que quien lo usa
 * decida cuándo se pide: son ~264 asignaciones en total y este detalle puede
 * ser de una persona o de veinte.
 */

import type { AsignacionQA } from "../api/tipos";
import { Cargando, CajaVacia, ErrorAlerta } from "../componentes/retroalimentacion";
import { enlaceA } from "../navegacion";
import { tituloObsoleto } from "./carga";

export function AsignacionesDePersona({
  estado,
  quitting,
  onQuitar,
}: {
  estado: {
    data?: { asignaciones: AsignacionQA[]; total: number };
    isPending: boolean;
    isError: boolean;
    error: unknown;
  };
  /** `true` mientras hay un borrado en curso, para no apilar clics. */
  quitting: boolean;
  /** Quita la asignación. Lo recibe de la página, que es quien tiene el hook. */
  onQuitar: (epica: number, rol: string) => void;
}) {
  if (estado.isPending) return <Cargando texto="Cargando sus épicas…" />;
  if (estado.isError) {
    return (
      <ErrorAlerta
        mensaje={`No se pudieron cargar: ${
          estado.error instanceof Error ? estado.error.message : String(estado.error)
        }`}
      />
    );
  }

  const lista = estado.data?.asignaciones ?? [];
  if (lista.length === 0) {
    return <CajaVacia mensaje="No tiene ninguna épica asignada." />;
  }

  return (
    <>
      <ul className="lista-asignados">
        {lista.map((a) => (
          <li key={`${a.epica}-${a.rol}`} className="asignado">
            {/* Se enlaza a la épica solo si su título se conoce: una épica que ya
                no está en Azure daría un 404, y un enlace roto es peor que
                ninguna acción. */}
            {a.titulo_conocido ? (
              <a className="enlace-persona" href={enlaceA({ pagina: "epica", azureId: a.epica })}>
                <span className="monospace">#{a.epica}</span> {tituloObsoleto(a)}
              </a>
            ) : (
              <span className="titulo-obsoleto">
                <span className="monospace">#{a.epica}</span> {tituloObsoleto(a)}
              </span>
            )}
            <span className="chip-rol" data-rol={a.rol}>
              {a.rol === "dev" ? "Desarrollo" : "QA"}
            </span>
            <span className="texto-suave small">
              desde {a.desde}
              {a.dias_laborables === 0
                ? " (hoy)"
                : ` · ${a.dias_laborables} d. laborables`}
            </span>
            {a.nota && <span className="texto-suave small">— {a.nota}</span>}
            <button
              type="button"
              className="btn secundario small"
              disabled={quitting}
              onClick={() => onQuitar(a.epica, a.rol)}
              aria-label={`Quitar la épica ${a.epica} de ${a.rol === "dev" ? "desarrollo" : "QA"}`}
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>
      {!lista.every((a) => a.titulo_conocido) && (
        <p className="texto-suave small">
          Las marcadas como <span className="titulo-obsoleto">obsoletas</span> ya no
          están en Azure. La asignación se conserva: es lo único que dice qué había
          ahí, y lo único que se puede hacer con ella es quitarla desde la ficha.
        </p>
      )}
    </>
  );
}
