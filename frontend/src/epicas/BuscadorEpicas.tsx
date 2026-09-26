import { useEffect, useRef } from "react";

/**
 * Campo de búsqueda de épicas.
 *
 * Es **presentacional**: el texto vive en `Dashboard` para que el filtrado y el
 * resaltado puedan vivir junto a los datos. Añade varias ayudas de uso sobre
 * un `<input>` normal:
 *
 * - `Escape` limpia el campo.
 * - El botón «×» aparece solo cuando hay texto, y `/` enfoca el buscador.
 * - `aria-controls` apunta al contenedor filtrado, para que los lectores de
 *   pantalla anuncien cuántas filas quedan.
 */
export function BuscadorEpicas({
  consulta,
  onCambio,
  resultados,
  total,
  idContenedor = "resultados-busqueda",
}: {
  consulta: string;
  onCambio: (valor: string) => void;
  /** Épicas que coinciden con la consulta. */
  resultados: number;
  /** Épicas disponibles antes de filtrar. */
  total: number;
  idContenedor?: string;
}) {
  const referencia = useRef<HTMLInputElement>(null);

  /** Atajo «/» para saltar al buscador sin soltar el teclado. */
  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent) => {
      const destino = evento.target as HTMLElement | null;
      const escribiendo =
        destino?.tagName === "INPUT" ||
        destino?.tagName === "TEXTAREA" ||
        destino?.isContentEditable === true;
      if (evento.key === "/" && !escribiendo) {
        evento.preventDefault();
        referencia.current?.focus();
      }
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, []);

  return (
    <div className="buscador-epicas">
      <label className="visualmente-oculto" htmlFor="buscar-epica">
        Buscar épica por título, ID de Azure o estado
      </label>
      <input
        id="buscar-epica"
        ref={referencia}
        type="search"
        className="buscador"
        placeholder="Buscar épica por título, ID o estado…  ( / )"
        value={consulta}
        autoComplete="off"
        aria-controls={idContenedor}
        onChange={(evento) => onCambio(evento.target.value)}
        onKeyDown={(evento) => {
          if (evento.key === "Escape" && consulta !== "") {
            evento.preventDefault();
            onCambio("");
          }
        }}
      />
      {consulta !== "" && (
        <button
          type="button"
          className="btn-icono"
          aria-label="Limpiar la búsqueda"
          onClick={() => {
            onCambio("");
            referencia.current?.focus();
          }}
        >
          ×
        </button>
      )}
      <output className="texto-suave small" aria-live="polite">
        {consulta === ""
          ? `${total} épica${total === 1 ? "" : "s"}`
          : `${resultados} de ${total}`}
      </output>
    </div>
  );
}
