/** Lista de activos de prueba editables, con un formulario por fila.
 *
 * Es el tercer nivel de revelado de `#/pruebas`: el veredicto y la cinta dicen
 * cuánto falta, esta lista es donde se trabaja. Casos, suites y planes en una
 * sola vista con pestañas, porque los tres se editan igual y separarlos serían
 * tres pantallas con la misma forma.
 *
 * El formulario **no decide qué campos ofrece**: los recibe en
 * `campos_editables` desde el backend. No es una comodidad, es la razón de que
 * un `Test Plan` no muestre casillas de tags ni de notas: ese tipo no las tiene,
 * y Azure lo descubriría de la peor manera — aceptando la escritura en silencio
 * y dejando un campo que nadie lee.
 *
 * Conecta los hooks de datos (no es presentacional) porque cada fila escribe por
 * su cuenta; sacar el estado a un padre obligaría a propagar `guardando` y `error`
 * por 50 filas.
 */

import { useState } from "react";

import { CajaVacia, Cargando, ErrorAlerta } from "../componentes/retroalimentacion";
import { EstadoTrabajo } from "../componentes/EstadoTrabajo";
import { EdicionInline } from "../epicas/EdicionInline";
import { useActualizarWorkItem, usePruebasActivos } from "../epicas/hooks";
import { Paginacion } from "../sprints/Paginacion";
import { PRUEBAS_POR_PAGINA } from "../navegacion";
import type { ActualizacionQA, ActivoDePrueba, CampoEditable } from "../api/tipos";

/** Los tres tipos, en el orden en que se leen: del más grande al más pequeño. */
const TIPOS = [
  { valor: "Test Case", etiqueta: "Casos" },
  { valor: "Test Suite", etiqueta: "Suites" },
  { valor: "Test Plan", etiqueta: "Planes" },
] as const;

/** Nota por tipo sobre lo que su plantilla permite. No es decoración. */
const AVISO_TIPO: Record<string, string> = {
  "Test Plan":
    "Un plan solo tiene estado editable: en este proyecto no tiene tags, " +
    "descripción ni prioridad, y Azure aceptaría escribirlos sin avisar. " +
    "Además su pertenencia —qué casos contiene— no es accesible por la API, " +
    "así que un plan no se puede abrir.",
  "Test Suite":
    "Una suite solo tiene estado editable: en este proyecto no tiene tags, " +
    "descripción ni prioridad.",
};

export function ListaActivos({
  abierto,
  sprint = "",
}: {
  /** No se pide nada mientras esté `false`: son 3.931 activos. */
  abierto: boolean;
  /** Filtra por el sprint elegido en la cinta. */
  sprint?: string;
}) {
  const [tipo, setTipo] = useState<string>(TIPOS[0].valor);
  const [estado, setEstado] = useState("");
  const [hoja, setHoja] = useState(1);
  const [editando, setEditando] = useState<number | null>(null);

  const activos = usePruebasActivos(
    {
      tipo,
      estado: estado || undefined,
      sprint: sprint || undefined,
      offset: (hoja - 1) * PRUEBAS_POR_PAGINA,
      limite: PRUEBAS_POR_PAGINA,
    },
    abierto,
  );

  const datos = activos.data;
  const aviso = AVISO_TIPO[tipo];
  const hayFiltro = estado !== "" || sprint !== "";

  if (!abierto) {
    return (
      <CajaVacia mensaje="Abre este panel para ver y editar casos, suites y planes." />
    );
  }

  return (
    <>
      <div className="banda-filtros">
        <div className="selector-segmentado" role="group" aria-label="Tipo de activo">
          {TIPOS.map((t) => (
            <button
              key={t.valor}
              type="button"
              onClick={() => {
                // Cambiar de tipo o de estado vuelve a la primera hoja: la
                // página 4 de los casos no significa nada en las suites.
                setTipo(t.valor);
                setEstado("");
                setHoja(1);
                setEditando(null);
              }}
              aria-pressed={tipo === t.valor}
            >
              {t.etiqueta}
            </button>
          ))}
        </div>

        <label className="filtro-campo" htmlFor="a-estado">
          {/* No se llama igual que el campo del formulario a propósito: dos
              controles con la etiqueta "Estado" en la misma pantalla son
              ambiguos para un lector de pantalla y para cualquiera que use la
              página sin ratón. */}
          <span className="etiqueta-filtro">Filtrar por estado</span>
          <select
            id="a-estado"
            value={estado}
            onChange={(e) => {
              setEstado(e.target.value);
              setHoja(1);
            }}
          >
            <option value="">Todos los estados</option>
            {(datos?.estados[tipo] ?? []).map((valor) => (
              <option key={valor} value={valor}>
                {valor}
              </option>
            ))}
          </select>
        </label>

        {sprint && (
          <span className="texto-suave small">Sprint {sprint}</span>
        )}
      </div>

      {aviso && <p className="texto-suave small">{aviso}</p>}

      {activos.isPending ? (
        <Cargando texto="Cargando activos de prueba…" />
      ) : activos.isError ? (
        <ErrorAlerta
          mensaje={`No se pudieron cargar los activos: ${
            activos.error instanceof Error ? activos.error.message : String(activos.error)
          }`}
        />
      ) : !datos || datos.items.length === 0 ? (
        <CajaVacia
          mensaje={
            hayFiltro
              ? "Ningún activo cumple los filtros indicados."
              : `No hay ${tipo} en el proyecto.`
          }
        />
      ) : (
        <>
          <ul className="lista-activos">
            {datos.items.map((activo) => (
              <FilaActivo
                key={activo.azure_id}
                activo={activo}
                estadosDisponibles={datos.estados[activo.tipo] ?? []}
                abierto={editando === activo.azure_id}
                onAlternar={() =>
                  setEditando(editando === activo.azure_id ? null : activo.azure_id)
                }
                onGuardado={() => setEditando(null)}
              />
            ))}
          </ul>
          <Paginacion
            hoja={hoja}
            total={datos.resumen.total}
            hayMas={datos.resumen.hay_mas}
            porPagina={PRUEBAS_POR_PAGINA}
            onCambiar={setHoja}
          />
        </>
      )}
    </>
  );
}

function FilaActivo({
  activo,
  estadosDisponibles,
  abierto,
  onAlternar,
  onGuardado,
}: {
  activo: ActivoDePrueba;
  estadosDisponibles: string[];
  abierto: boolean;
  onAlternar: () => void;
  onGuardado: () => void;
}) {
  const guardar = useActualizarWorkItem();
  // El error se muestra junto a su campo, no en un aviso global: un «Error HTTP
  // 409» sin contexto no dice si el problema fue el campo o el work item.
  const error = guardar.isError
    ? guardar.error instanceof Error
      ? guardar.error.message
      : String(guardar.error)
    : "";

  return (
    <li className="activo-fila">
      <div className="activo-cabecera">
        <button
          type="button"
          className="activo-titulo"
          onClick={onAlternar}
          aria-expanded={abierto}
        >
          {activo.titulo}
        </button>
        <div className="hu-meta">
          <EstadoTrabajo estado={activo.estado} />
          {activo.prioridad && <span className="hu-persona">P{activo.prioridad}</span>}
          {activo.persona && <span className="hu-persona">{activo.persona}</span>}
          {activo.sprint ? (
            <span className="hu-sprint">{activo.sprint}</span>
          ) : (
            <span className="hu-sprint" data-sin-sprint="true">
              sin sprint
            </span>
          )}
        </div>
      </div>

      {abierto && (
        <EdicionInline
          workItemId={activo.azure_id}
          titulo={`${activo.tipo} #${activo.azure_id}`}
          estadoActual={activo.estado}
          estadosDisponibles={estadosDisponibles}
          prioridadActual={activo.prioridad}
          tagsActuales={activo.tags}
          camposEditables={activo.campos_editables as CampoEditable[]}
          habilitado={activo.campos_editables.length > 0}
          guardando={guardar.isPending}
          error={error}
          onGuardar={(cambios: ActualizacionQA) =>
            guardar.mutate(
              { workItemId: activo.azure_id, cambios },
              // Se cierra solo si Azure aceptó. Un fallo deja el formulario
              // abierto con el error y los valores escritos, que es lo único
              // que permite corregir sin volver a teclearlo todo.
              { onSuccess: onGuardado },
            )
          }
          onCerrar={onAlternar}
        />
      )}
    </li>
  );
}
