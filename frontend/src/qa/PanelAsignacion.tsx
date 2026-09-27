/** Panel para asignar una épica a personas del registro local de pruebas.
 *
 * Es la respuesta a «¿quién prueba esta épica?», y la respuesta tiene que
 * incluir poder **cambiarla**: el filtro del dashboard y la columna «Pruebas» ya
 * sabían leer asignaciones, pero sin este panel no había forma de crear ninguna.
 *
 * Tres decisiones:
 *
 * 1. **Las asignaciones se piden al montar, sin botón de «cargar».** Una épica
 *    solo se abre bajo demanda (fila expandida o página propia) y su árbol ya
 *    cuesta tres lotes. Una petición más por esa épica es del mismo orden de
 *    magnitud y evita un panel vacío que hay que descubrir. Esto no contradice
 *    la regla de revelado progresivo: esa protege de descargar lo que nadie mira
 *    al abrir una vista, no de lo que se mira al decidir.
 *
 * 2. **Un error por código, no un «algo ha fallado».** 422 es del formulario,
 *    409 es de otra pestaña y no se perdió nada, 500 es del fichero del
 *    registro y no lo arregla el formulario. Decir lo mismo para los tres manda
 *    a la puerta equivocada, que es justo lo que el backend evita.
 *
 * 3. **Aviso de git siempre visible.** El registro es un fichero rastreado en
 *    git porque es el único sitio donde existe esa información. Una UI que
 *    escribe sin decirlo parece funcionar y no es cierto: sin `git commit` un
 *    `checkout` se lo lleva.
 */

import { useState } from "react";

import type { AsignacionQA, PersonaQA } from "../api/tipos";
import { ApiError } from "../api/cliente";
import { irA } from "../navegacion";
import { useAsignaciones, useAsignar, usePersonasQA, useQuitarAsignacion } from "./hooks";

/** Fecha local de hoy en formato `YYYY-MM-DD`, sin pasar por UTC.
 *
 * `toISOString()` desplazaría el día: en una zona UTC-5, las 20:00 de un lunes
 * dan «martes» como fecha de inicio, y la asignación se guardaría un día
 * desplazada. El campo es de fecha, no de instante.
 */
function hoyLocal(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function nombreDeRol(rol: string): string {
  return rol === "dev" ? "desarrollo" : "QA";
}

/** Explica el fallo según el código, que es lo único que sabe dónde está el
 * problema. Cualquier otro caso cae en un texto genérico con el detalle.
 */
function explicacion(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return (
        "El registro cambió en otra pestaña o en otra herramienta mientras escribías. " +
        "No se perdió nada: recarga la página y repite el cambio."
      );
    }
    if (error.status === 422) {
      return `No se pudo guardar: ${error.message}`;
    }
    if (error.status === 500) {
      return (
        "El fichero del registro no se puede leer o escribir. Es un problema del " +
        `servidor, no del formulario: ${error.message}`
      );
    }
  }
  const detalle = error instanceof Error ? error.message : String(error);
  return `No se pudo guardar: ${detalle}`;
}

/** `personas` en orden alfabético, que es lo predecible en un desplegable de 35.
 *
 * No se ordenan por volumen como en el filtro del dashboard: aquí se busca a
 * alguien concreto para asignarle algo, no se compara carga.
 */
function paraElegir(personas: PersonaQA[]): PersonaQA[] {
  return [...personas].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export function PanelAsignacion({ epica, titulo }: { epica: number; titulo: string }) {
  const personas = usePersonasQA(true);
  const asignaciones = useAsignaciones({ epica }, true);
  const asignar = useAsignar();
  const quitar = useQuitarAsignacion();

  const [persona, setPersona] = useState("");
  const [rol, setRol] = useState<"qa" | "dev">("qa");
  const [desde, setDesde] = useState(hoyLocal);
  const [nota, setNota] = useState("");
  const [fallo, setFallo] = useState<string | null>(null);

  const actuales: AsignacionQA[] = asignaciones.data?.asignaciones ?? [];
  const lista = paraElegir(personas.data?.personas ?? []);
  // Tres estados y no dos. Un desplegable deshabilitado con el texto «no hay
  // personas» sería una mentira si lo que pasa es que la lista todavía no ha
  // llegado: se leería como un proyecto vacío.
  const cargandoPersonas = personas.isPending;
  const sinPersonas = !cargandoPersonas && lista.length === 0;
  const puedeGuardar = persona !== "" && !asignar.isPending;

  const guardar = () => {
    if (!puedeGuardar) return;
    setFallo(null);
    asignar.mutate(
      { epica, persona, rol, desde, nota: nota.trim() },
      {
        onSuccess: () => {
          // Se limpia solo: la fila recién guardada ya sale de la lista que
          // invalida el hook, y dejarla puesta invitaría a duplicar sin querer.
          setPersona("");
          setNota("");
        },
        onError: (e) => setFallo(explicacion(e)),
      },
    );
  };

  return (
    <section className="asignacion" aria-label={`Responsables de pruebas de ${titulo || `la épica #${epica}`}`}>
      <header className="actividad-cabecera">
        <h3 className="actividad-titulo">Responsables de pruebas</h3>
        <span className="texto-suave small">
          {actuales.length === 0
            ? "nadie asignado"
            : `${actuales.length} persona(s)`}
        </span>
      </header>

      {actuales.length > 0 && (
        <ul className="lista-asignados">
          {actuales.map((a) => (
            <li key={`${a.persona}-${a.rol}`} className="asignado">
              <button
                type="button"
                className="enlace-persona"
                onClick={() => irA({ pagina: "dashboard", filtro: { qa: a.persona } })}
                title={`Ver las épicas asignadas a ${a.nombre_persona}`}
              >
                {a.nombre_persona}
              </button>
              <span className="chip-rol" data-rol={a.rol}>
                {nombreDeRol(a.rol)}
              </span>
              <span className="texto-suave small">
                desde {a.desde}
                {/* 0 días es hoy, no «hace 0 días»: se dice, porque un cero al
                    lado de una fecha se lee como un dato que falta. */}
                {a.dias_laborables === 0 ? " (hoy)" : ` · ${a.dias_laborables} d. laborables`}
              </span>
              {a.nota && <span className="texto-suave small">— {a.nota}</span>}
              <button
                type="button"
                className="btn secundario small"
                disabled={quitar.isPending}
                onClick={() => {
                  setFallo(null);
                  quitar.mutate(
                    { epica, persona: a.persona, rol: a.rol },
                    { onError: (e) => setFallo(explicacion(e)) },
                  );
                }}
                aria-label={`Quitar a ${a.nombre_persona} como ${nombreDeRol(a.rol)}`}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="formulario-asignacion">
        <label className="campo">
          <span className="etiqueta-filtro">Persona</span>
          <select
            value={persona}
            disabled={cargandoPersonas || sinPersonas}
            onChange={(e) => setPersona(e.target.value)}
          >
            <option value="">
              {cargandoPersonas
                ? "Cargando personas…"
                : sinPersonas
                  ? "No hay personas en el proyecto"
                  : `Elegir entre ${lista.length} personas`}
            </option>
            {lista.map((p) => (
              <option key={p.guid} value={p.guid}>
                {p.nombre}
                {p.es_qa ? " · QA" : p.es_dev ? " · dev" : ""}
                {p.epicas > 0 ? ` (${p.epicas})` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="campo">
          <span className="etiqueta-filtro">Rol</span>
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value === "dev" ? "dev" : "qa")}
          >
            <option value="qa">QA</option>
            <option value="dev">Desarrollo</option>
          </select>
        </label>

        <label className="campo">
          <span className="etiqueta-filtro">Desde</span>
          <input type="date" value={desde} max={hoyLocal()} onChange={(e) => setDesde(e.target.value)} />
        </label>

        <label className="campo ancho">
          <span className="etiqueta-filtro">Nota (opcional)</span>
          <input
            type="text"
            value={nota}
            placeholder="p. ej. revisó el contrato en septiembre"
            onChange={(e) => setNota(e.target.value)}
          />
        </label>

        <button type="button" className="btn primario" disabled={!puedeGuardar} onClick={guardar}>
          {asignar.isPending ? "Guardando…" : "Asignar"}
        </button>
      </div>

      {fallo && (
        <div className="aviso aviso-error" role="alert">
          {fallo}
        </div>
      )}

      <p className="texto-suave small nota-actividad">
        Se guarda en <code>backend/datos/asignaciones.json</code>, que está{" "}
        <strong>rastreado en git</strong> porque es el único sitio donde existe esta
        información. Hay que hacer <code>git commit</code> tras cada cambio o se
        pierde al cambiar de rama.
      </p>
    </section>
  );
}
