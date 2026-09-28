/** Vista de equipo QA: quién prueba qué y con qué rol.
 *
 * Es la contraparte del panel de asignación. Desde la épica se asigna; desde aquí
 * se ve el reparto completo y se decide quién es QA.
 *
 * Dos decisiones de coste y de honestidad:
 *
 * 1. **Abre con una sola lectura.** `/api/qa/personas` son 35 filas sobre el
 *    índice ya en memoria, e incluye `epicas`, `dias_laborables` y
 *    `items_backlog`. Las ~264 asignaciones **no** se piden hasta que se elige
 *    una persona: son el detalle de alguien concreto, no de la vista.
 *
 * 2. **La sugerencia no se aplica sola.** `sugerencia-qa` es una heurística por
 *    volumen de activos tocados; marcarla es una decisión de quien la ve. Por eso
 *    la vista la ofrece fila a fila y guarda `forzado: true` cuando alguien la
 *    acepta, que es lo que la distingue de un valor por defecto.
 */

import { useMemo, useState } from "react";

import { ApiError } from "../api/cliente";
import type { PersonaQA } from "../api/tipos";
import { Kpi } from "../componentes/Kpi";
import { Cargando, CajaVacia, ErrorAlerta } from "../componentes/retroalimentacion";
import { irA } from "../navegacion";
import {
  FILTROS,
  type FiltroPersonas,
  conteoPorCategoria,
  personasOrdenadas,
  resumenSugerencias,
  textoRol,
} from "./carga";
import {
  useAsignaciones,
  useMarcarRolQA,
  usePersonasQA,
  useQuitarAsignacion,
  useSugerenciasQA,
} from "./hooks";
import { AsignacionesDePersona } from "./AsignacionesDePersona";
import { AvisoRegistro } from "./AvisoRegistro";

function explicacion(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return (
        "El registro cambió en otra pestaña o herramienta. No se perdió nada: " +
        "recarga y repite."
      );
    }
    if (error.status === 500) {
      return `El fichero del registro no se puede leer o escribir: ${error.message}`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export default function PaginaQA() {
  const [filtro, setFiltro] = useState<FiltroPersonas>("con_epicas");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [aceptada, setAceptada] = useState<string | null>(null);

  const personas = usePersonasQA(true);
  // Plegadas por defecto a propósito: necesitan el **índice de pruebas** entero
  // (3.932 activos, 18 lotes, ~5,5 s en frío) y son una sección secundaria de la
  // página. Pedirlas al abrir `#/qa` hacía que esa vista costara lo mismo que
  // `#/pruebas` para quien solo quería ver el reparto de roles. Es revelado
  // progresivo, igual que la tabla de ítems de la vista de sprints.
  const [verSugerencias, setVerSugerencias] = useState(false);
  const sugerencias = useSugerenciasQA(verSugerencias, 3);
  const marcar = useMarcarRolQA();
  const quitar = useQuitarAsignacion();
  // Solo se pide la lista de la persona abierta: son ~264 filas en total y este
  // detalle puede ser de una o de veinte.
  const asignaciones = useAsignaciones(
    abierta ? { persona: abierta } : { persona: "__ninguna__" },
    abierta !== null,
  );

  const todas = useMemo(() => personas.data?.personas ?? [], [personas.data]);
  const visibles = useMemo(() => personasOrdenadas(todas, filtro), [todas, filtro]);
  const conteo = useMemo(() => conteoPorCategoria(todas), [todas]);
  const sugerencia = useMemo(
    () => resumenSugerencias(sugerencias.data?.sugerencias ?? []),
    [sugerencias.data],
  );

  const marcarRol = (guid: string, cambios: { es_qa?: boolean; es_dev?: boolean; forzado?: boolean }) => {
    setFallo(null);
    marcar.mutate(
      { guid, cambios },
      { onError: (e) => setFallo(explicacion(e)) },
    );
  };

  const toggle = (p: PersonaQA, campo: "es_qa" | "es_dev") => {
    // `null` es «no lo toques» y `false` es «quítaselo». Marcar en un interruptor
    // alterna el valor booleano, y por eso se manda siempre un booleano
    // explícito: mandar `null` borraría el rol que no se quería cambiar.
    const nuevo = !p[campo];
    // Quitar el último rol pone `forzado: false` explícito, para que la interfaz
    // deje de fingir que ese rol era un valor por defecto del sistema.
    const seQuedaSinRol = !nuevo && (campo === "es_qa" ? !p.es_dev : !p.es_qa);
    setAceptada(null);
    marcarRol(p.guid, { [campo]: nuevo, ...(seQuedaSinRol ? { forzado: false } : {}) });
  };

  if (personas.isPending) return <Cargando texto="Cargando el equipo de pruebas…" />;
  if (personas.isError) {
    return (
      <div className="pagina">
        <ErrorAlerta
          mensaje={`No se pudo cargar el equipo: ${
            personas.error instanceof Error ? personas.error.message : String(personas.error)
          }`}
        />
      </div>
    );
  }

  const conRol = todas.filter((p) => p.es_qa || p.es_dev).length;

  return (
    <div className="pagina">
      <div className="cabecera-pagina">
        <div>
          <h1>Equipo de pruebas</h1>
          <p className="texto-suave small">
            Quién prueba cada épica y con qué rol. Azure no tiene dónde anotar
            esto: las épicas no las crea el equipo de QA.
          </p>
        </div>
      </div>

      <div className="kpis">
        <Kpi etiqueta="Personas" valor={todas.length} />
        <Kpi etiqueta="Con rol" valor={conRol} tono={conRol === 0 ? "alerta" : "ok"} />
        <Kpi etiqueta="Con épicas" valor={conteo.con_epicas} tono="acento" />
        <Kpi etiqueta="Sin rol" valor={conteo.sin_rol} />
      </div>

      {conRol === 0 && (
        <div className="aviso aviso-info" role="status">
          Nadie tiene rol marcado todavía. Se puede empezar por abajo, con la
          sugerencia, o marcar a quien corresponda.
        </div>
      )}

      {!verSugerencias ? (
        <button
          type="button"
          className="btn secundario"
          onClick={() => setVerSugerencias(true)}
        >
          Ver sugerencias de QA
        </button>
      ) : sugerencia.total > 0 ? (
        <section className="panelSugerencias" aria-label="Sugerencias de rol QA">
          <h2 className="actividad-subtitulo">
            {sugerencia.total === 1
              ? "1 persona parece hacer QA"
              : `${sugerencia.total} personas parecen hacer QA`}
          </h2>
          <p className="texto-suave small">
            Por volumen de activos de prueba que ha tocado cada una. Es una
            heurística, no un dato: el registro de tiempos de Azure no es
            accesible, así que no se puede medir quién hace QA. La decisión es
            tuya.
          </p>
          {sugerencia.total > sugerencia.visibles.length && (
            <p className="texto-suave small">
              Se muestran las {sugerencia.visibles.length} con más actividad de
              las {sugerencia.total}.
            </p>
          )}
          <ul className="lista-sugerencias">
            {sugerencia.visibles.map((s) => (
              <li key={s.guid} className="sugerencia">
                <span className="sugerencia-nombre">{s.nombre}</span>
                <span className="texto-suave small">
                  {s.activos} activo{s.activos === 1 ? "" : "s"} de prueba
                </span>
                <button
                  type="button"
                  className="btn secundario small"
                  disabled={marcar.isPending}
                  onClick={() => {
                    setAceptada(s.guid);
                    setFallo(null);
                    // `forzado: true` es lo que deja claro que la decisión fue
                    // humana y no el valor por defecto del sistema.
                    marcarRol(s.guid, { es_qa: true, forzado: true });
                  }}
                >
                  Marcar como QA
                </button>
                {aceptada === s.guid && (
                  <span className="texto-suave small">marcada</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        // Sin sugerencias no se dice «0 personas parece hacer QA»: es un dato
        // que no aporta nada y ocupa el sitio del botón que sí hace algo.
        <p className="texto-suave small">Nadie parece hacer QA por volumen de activos.</p>
      )}

      <div className="filtros-personas" role="group" aria-label="Filtrar por rol">
        {FILTROS.map((f) => (
          <button
            key={f.clave}
            type="button"
            className="filtro-chip"
            aria-pressed={filtro === f.clave}
            onClick={() => setFiltro(f.clave)}
          >
            {f.etiqueta} ({conteo[f.clave]})
          </button>
        ))}
      </div>

      {fallo && (
        <div className="aviso aviso-error" role="alert">
          {fallo}
        </div>
      )}

      {visibles.length === 0 ? (
        <CajaVacia
          mensaje={
            filtro === "con_epicas"
              ? "Ninguna persona tiene épicas asignadas todavía. Se asigna desde la ficha de cada épica."
              : "No hay nadie en este grupo."
          }
        />
      ) : (
        <div className="tabla-scroll">
          <table className="tabla">
            <caption className="visualmente-oculto">
              Personas del proyecto con su rol en pruebas y su carga
            </caption>
            <thead>
              <tr>
                <th scope="col">Persona</th>
                <th scope="col">Rol</th>
                <th className="td-der" scope="col">Épicas</th>
                <th className="td-der" scope="col">Días laborables</th>
                <th className="td-der" scope="col">Ítems en backlog</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => {
                const rol = textoRol(p);
                const esEsta = abierta === p.guid;
                return (
                  <FilaPersona
                    key={p.guid}
                    persona={p}
                    rol={rol}
                    abierta={esEsta}
                    deshabilitado={marcar.isPending}
                    onAlternar={() => setAbierta(esEsta ? null : p.guid)}
                    onToggle={toggle}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {abierta && (
        <section className="panel-asignaciones-persona" aria-label="Épicas asignadas">
          <h2 className="actividad-subtitulo">Épicas asignadas</h2>
          <AsignacionesDePersona
            estado={asignaciones}
            quitting={quitar.isPending}
            onQuitar={(epica, rol) => {
              setFallo(null);
              quitar.mutate(
                { epica, persona: abierta, rol },
                { onError: (e) => setFallo(explicacion(e)) },
              );
            }}
          />
        </section>
      )}

      <AvisoRegistro />
    </div>
  );
}

/** Fila de una persona. Aislada para que la tabla no crezca con lógica. */
function FilaPersona({
  persona,
  rol,
  abierta,
  deshabilitado,
  onAlternar,
  onToggle,
}: {
  persona: PersonaQA;
  rol: string | null;
  abierta: boolean;
  deshabilitado: boolean;
  onAlternar: () => void;
  onToggle: (p: PersonaQA, campo: "es_qa" | "es_dev") => void;
}) {
  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className="enlace-persona"
            onClick={() => irA({ pagina: "dashboard", filtro: { qa: persona.guid } })}
            title={`Ver las épicas asignadas a ${persona.nombre} en el backlog`}
          >
            {persona.nombre}
          </button>
          {persona.forzado && (
            <span className="texto-suave small" title="El rol se marcó a mano">
              {" "}
              · marcado
            </span>
          )}
        </td>
        <td>
          {rol ? (
            <span className="chip-rol" data-rol={persona.es_qa ? "qa" : "dev"}>
              {rol}
            </span>
          ) : (
            // Se dice «sin marcar» y no se deja la celda vacía: una celda vacía
            // se lee como «no hemos mirado».
            <span className="texto-suave small">sin marcar</span>
          )}
        </td>
        <td className="td-der monospace">{persona.epicas}</td>
        <td className="td-der monospace">{persona.dias_laborables}</td>
        <td className="td-der monospace">{persona.items_backlog}</td>
        <td>
          <div className="acciones-fila">
            <label className="control-filtro" title="Marcar o quitar el rol de QA">
              <input
                type="checkbox"
                checked={persona.es_qa}
                disabled={deshabilitado}
                onChange={() => onToggle(persona, "es_qa")}
              />
              QA
            </label>
            <label className="control-filtro" title="Marcar o quitar el rol de desarrollo">
              <input
                type="checkbox"
                checked={persona.es_dev}
                disabled={deshabilitado}
                onChange={() => onToggle(persona, "es_dev")}
              />
              dev
            </label>
            <button
              type="button"
              className="btn secundario small"
              aria-expanded={abierta}
              onClick={onAlternar}
            >
              {abierta ? "Ocultar" : "Ver épicas"}
            </button>
          </div>
        </td>
      </tr>
    </>
  );
}
