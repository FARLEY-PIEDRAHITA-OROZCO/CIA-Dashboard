/** Página de iniciativas a cargo con su carpeta de OneDrive.
 *
 * Lista todas las iniciativas que tienen estructura de carpetas creada,
 * con acceso rápido a cada una.
 */

import { useState } from "react";

import { Cargando, ErrorAlerta } from "../componentes/retroalimentacion";
import { api } from "../api/cliente";
import type { IniciativaCarpeta } from "../api/tipos";

function formatearFecha(fecha: string): string {
  try {
    return new Date(fecha).toLocaleDateString("es-ES", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return fecha;
  }
}

export default function PaginaIniciativas() {
  // Por ahora usa un estado simple; después se puede migrar a React Query
  const [iniciativas, setIniciativas] = useState<IniciativaCarpeta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useState(() => {
    api
      .listarIniciativas()
      .then((data) => {
        setIniciativas(data.iniciativas);
        setCargando(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setCargando(false);
      });
  });

  async function abrirCarpeta(ruta: string) {
    try {
      await api.abrirIniciativa(0); // TODO: usar el ID correcto
      window.open("file:///" + ruta, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (cargando) return <Cargando texto="Cargando iniciativas…" />;
  if (error) return <ErrorAlerta mensaje={error} />;

  return (
    <div className="pagina">
      <div className="cabecera-pagina">
        <div>
          <h1>Iniciativas a cargo</h1>
          <p className="texto-suave">
            Iniciativas con estructura de carpetas sincronizada con OneDrive.
          </p>
        </div>
      </div>

      {iniciativas.length === 0 ? (
        <p className="texto-suave">
          No hay iniciativas con carpeta creada. Asigna una épica y crea su
          estructura desde la vista de épica.
        </p>
      ) : (
        <div className="rejilla-senales">
          {iniciativas.map((iniciativa) => (
            <article key={iniciativa.epica_id} className="senal">
              <div className="senal-cabecera">
                <h3 className="senal-titulo">
                  {iniciativa.numero} - {iniciativa.nombre}
                </h3>
                <span className="senal-numero" data-tono="neutro">
                  #{iniciativa.epica_id}
                </span>
              </div>
              <p className="senal-nota">
                Creada el {formatearFecha(iniciativa.creada)}
              </p>
              <div className="senal-acciones">
                <button
                  type="button"
                  className="btn secundario small"
                  onClick={() => abrirCarpeta(iniciativa.ruta)}
                >
                  Abrir en explorador
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
