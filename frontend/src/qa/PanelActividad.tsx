/** Panel de actividad registrada de una épica, bajo demanda.
 *
 * Dos decisiones que no son de estilo:
 *
 * 1. **No se pide nada hasta que alguien lo abre.** Es la petición más cara de
 *    la aplicación: una llamada a Azure por ítem del árbol (hasta 254; mediana
 *    medida 1,2 s, máximo 5,8 s). Abrir la ficha de una épica no puede
 *    significa 254 llamadas que nadie pidió.
 *
 * 2. **No separa QA de dev.** La actividad viene de `revisedBy` de Azure, que no
 *    sabe nada del registro local de roles. Cruzar «rol declarado en el registro»
 *    con «tocó el ítem» produciría un reparto que parece medido y en realidad
 *    mezcla dos fuentes: alguien con rol dev que estaba probando contaría como
 *    dev. Se muestra quién tocó cada ítem, que es lo que el dato sí sabe.
 *
 * Cuenta **revisiones**, no horas. No es un matiz: el registro de tiempos de
 * Azure responde 401 con el PAT de lectura, así que no hay horas en ninguna parte
 * de este sistema.
 */

import { useState } from "react";

import type { ActividadEpica } from "../api/tipos";
import { Kpi } from "../componentes/Kpi";
import { irA } from "../navegacion";
import {
  PERSONAS_VISIBLES,
  avisoParcial,
  rangoFechas,
  repartoPorTipo,
} from "./actividad";
import { useActividadEpica } from "./hooks";

export function PanelActividad({ epica, titulo }: { epica: number; titulo: string }) {
  const [abierto, setAbierto] = useState(false);
  const consulta = useActividadEpica(abierto ? epica : null);

  if (!abierto) {
    return (
      <div className="actividad">
        <button
          type="button"
          className="btn secundario small"
          onClick={() => setAbierto(true)}
        >
          Ver actividad registrada
        </button>
        <span className="texto-suave small">
          Revisiones de todos los ítems de la épica. No son horas.
        </span>
      </div>
    );
  }

  if (consulta.isPending) {
    return (
      <div className="actividad">
        <div className="aviso aviso-info" role="status">
          <span className="spinner" aria-hidden="true" />
          Leyendo el historial de {titulo || `la épica #${epica}`}… una petición a
          Azure por ítem, así que puede tardar unos segundos.
        </div>
      </div>
    );
  }

  if (consulta.isError) {
    return (
      <div className="actividad">
        <div className="aviso aviso-error" role="alert">
          No se pudo leer la actividad:{" "}
          {String(consulta.error instanceof Error ? consulta.error.message : consulta.error)}
        </div>
      </div>
    );
  }

  const datos = consulta.data as ActividadEpica;
  const aviso = avisoParcial(datos);
  const reparto = repartoPorTipo(datos.por_tipo);
  const visibles = datos.por_persona.slice(0, PERSONAS_VISIBLES);
  const resto = datos.por_persona.length - visibles.length;

  return (
    <section className="actividad" aria-label={`Actividad de ${titulo || `la épica #${epica}`}`}>
      <header className="actividad-cabecera">
        <h3 className="actividad-titulo">Actividad registrada</h3>
        <button
          type="button"
          className="btn secundario small"
          onClick={() => setAbierto(false)}
        >
          Ocultar
        </button>
      </header>

      <div className="kpis">
        <Kpi etiqueta="Revisiones" valor={datos.revisiones} tono="acento" />
        <Kpi etiqueta="Personas" valor={datos.personas} />
        <Kpi
          etiqueta="Ítems sin tocar"
          valor={datos.items_sin_actividad}
          tono={datos.items_sin_actividad > datos.items_analizados / 2 ? "alerta" : undefined}
          titulo="Solo tienen la revisión de creación"
        />
      </div>

      {/* El rango va como texto y no como KPI: `Kpi` pinta el valor en grande y
          un rango de fechas ahí se lee como un número gigante y equivocado. */}
      <p className="texto-suave small">
        <strong>Revisiones entre</strong> {rangoFechas(datos.primera, datos.ultima)}
      </p>

      {aviso && (
        <div className="aviso aviso-alerta" role="status">
          {aviso}
        </div>
      )}

      {datos.items_sin_actividad > 0 && (
        <p className="texto-suave small">
          {datos.items_sin_actividad} de {datos.items_analizados} ítems están
          <strong> sin tocar desde que se crearon</strong>: solo tienen la revisión
          inicial.
        </p>
      )}

      {reparto.length > 0 && (
        <div className="actividad-tipos">
          <h4 className="actividad-subtitulo">Dónde está el movimiento</h4>
          <ul className="lista-barras">
            {reparto.map((fila) => (
              <li key={fila.tipo} className="barra-fila">
                <span className="barra-etiqueta">{fila.tipo}</span>
                <span className="barra-pista">
                  {/* `width` en porcentaje, no en píxeles: el mismo dato tiene que
                      caber en un panel estrecho sin volverse incalculable. */}
                  <span
                    className="barra-relleno"
                    style={{ width: `${Math.round(fila.tanto * 100)}%` }}
                  />
                </span>
                <span className="barra-valor monospace">{fila.n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {datos.personas > 0 && (
        <div className="actividad-personas">
          <h4 className="actividad-subtitulo">Quién ha tocado la épica</h4>
          <ul className="lista-personas-actividad">
            {visibles.map((persona) => (
              <li key={persona.guid} className="persona-actividad">
                <button
                  type="button"
                  className="enlace-persona"
                  // El GUID es lo que enlaza con el filtro del dashboard. El
                  // nombre no es único ni estable, así que buscar por nombre
                  // daría resultados distintos cada vez que alguien se renombra.
                  onClick={() => irA({ pagina: "dashboard", filtro: { qa: persona.guid } })}
                  title={`Ver las épicas asignadas a ${persona.nombre}`}
                >
                  {persona.nombre}
                </button>
                <span className="barra-revision">
                  <span
                    className="barra-revision-relleno"
                    style={{
                      width: `${Math.round(
                        (persona.revisiones / Math.max(datos.por_persona[0].revisiones, 1)) * 100,
                      )}%`,
                    }}
                  />
                </span>
                <span className="monospace small">{persona.revisiones}</span>
              </li>
            ))}
          </ul>
          {resto > 0 && (
            <p className="texto-suave small">
              y {resto} persona(s) más con menos revisiones.
            </p>
          )}
        </div>
      )}

      <p className="texto-suave small nota-actividad">{datos.nota}</p>
    </section>
  );
}
