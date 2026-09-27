/** Tarjeta de señal de analítica: un número grande, una frase y la lista bajo
 * demanda.
 *
 * Antes cada señal era una fila de KPIs más dos o tres listas de hasta 20
 * elementos, todas desplegadas a la vez: tres señales sumaban un muro. Aquí cada
 * señal ocupa una tarjeta y sus ejemplos se abren solo si alguien los pide, con
 * un contador que dice cuántos hay detrás.
 *
 * Presentacional: recibe lo ya calculado y emite `onAlternar`.
 */

import type { ReactNode } from "react";

export function TarjetaSenal({
  titulo,
  numero,
  tono = "neutro",
  nota,
  abierta = false,
  totalEjemplos = 0,
  nombreEjemplos = "casos",
  onAlternar,
  children,
}: {
  titulo: string;
  /** Cifra grande: lo único que hace falta leer para orientarse. */
  numero: ReactNode;
  tono?: "ok" | "alerta" | "acento" | "neutro";
  /** Una frase que da contexto al número. */
  nota?: string;
  /** Si la lista de ejemplos está desplegada. */
  abierta?: boolean;
  /** Cuántos ejemplos hay detrás del botón, aunque no se muestren. */
  totalEjemplos?: number;
  /**
   * Sustantivo del botón: «Ver los 41 casos» o «Ver los 2 sprints». Distingue
   * los botones entre sí, que si no dos señales con el mismo recuento ofrecen
   * un botón idéntico y no se sabe cuál es cuál.
   */
  nombreEjemplos?: string;
  onAlternar?: () => void;
  /**
   * Se renderiza **siempre**. Quien llama decide qué pone: la lista de
   * ejemplos solo cuando la tarjeta está abierta, pero un error o un «cargando»
   * también son hijos y deben verse aunque esté cerrada. Ocultarlos por
   * defecto hacía que una señal caída no dijera por qué.
   */
  children?: ReactNode;
}) {
  const hayEjemplos = totalEjemplos > 0;
  const pluralEjemplos = totalEjemplos === 1 ? nombreEjemplos.replace(/s$/, "") : nombreEjemplos;
  return (
    <article className="senal">
      <div className="senal-cabecera">
        <h3 className="senal-titulo">{titulo}</h3>
        <span className="senal-numero" data-tono={tono}>
          {numero}
        </span>
      </div>
      {nota && <p className="senal-nota">{nota}</p>}
      {hayEjemplos && onAlternar && (
        <div className="senal-acciones">
          <button
            type="button"
            className="btn secundario small"
            onClick={onAlternar}
            aria-expanded={abierta}
          >
            {abierta ? "Ocultar" : `Ver los ${totalEjemplos} ${pluralEjemplos}`}
          </button>
        </div>
      )}
      {children}
    </article>
  );
}
