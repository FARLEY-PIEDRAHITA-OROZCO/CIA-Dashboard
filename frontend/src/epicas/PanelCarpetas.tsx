/** Panel plegable de carpetas de OneDrive en la vista de épica.
 *
 * Muestra la estructura de carpetas de la iniciativa y permite gestionar
 * archivos. Plegado por defecto para no saturar la vista.
 */

import { useState } from "react";

import { Cargando, ErrorAlerta } from "../componentes/retroalimentacion";
import { api } from "../api/cliente";
import type { ArchivoIniciativa, IniciativaCarpeta } from "../api/tipos";

function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

export function PanelCarpetas({
  epicaId,
  nombreEpica,
  carpeta,
  onCambio,
}: {
  epicaId: number;
  nombreEpica: string;
  carpeta: IniciativaCarpeta | null;
  onCambio: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [carpetaActiva, setCarpetaActiva] = useState<string | null>(null);
  const [archivos, setArchivos] = useState<ArchivoIniciativa[]>([]);
  const [subiendo, setSubiendo] = useState(false);

  async function crearEstructura() {
    setCargando(true);
    setError(null);
    try {
      await api.crearEstructuraIniciativa(epicaId, nombreEpica);
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }

  async function eliminarEstructura() {
    if (!window.confirm("¿Eliminar la carpeta y todo su contenido?")) return;
    setCargando(true);
    setError(null);
    try {
      await api.eliminarEstructuraIniciativa(epicaId);
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }

  async function abrirCarpeta(nombre: string) {
    setCarpetaActiva(nombre);
    setCargando(true);
    setError(null);
    try {
      const resultado = await api.listarArchivosIniciativa(epicaId, nombre);
      setArchivos(resultado.archivos);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }

  async function abrirEnExplorador() {
    try {
      await api.abrirIniciativa(epicaId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function subirArchivo(carpeta: string, archivo: File) {
    setSubiendo(true);
    setError(null);
    try {
      await api.subirArchivoIniciativa(epicaId, carpeta, archivo);
      await abrirCarpeta(carpeta);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubiendo(false);
    }
  }

  const subcarpetas = [
    "Documentos",
    "HU",
    "Casos de prueba",
    "Archivos de evidencias",
    "Certificaciones",
  ];

  return (
    <div className="panel-monitor" style={{ margin: "8px 0" }}>
      <button
        type="button"
        className="btn secundario small"
        onClick={() => setAbierto(!abierto)}
        aria-expanded={abierto}
      >
        {carpeta
          ? `📁 Carpetas ${carpeta.numero} ${abierto ? "▲" : "▼"}`
          : "📁 Crear estructura de carpetas"}
      </button>

      {abierto && (
        <div style={{ marginTop: 8 }}>
          {cargando && <Cargando texto="Cargando…" />}
          {error && <ErrorAlerta mensaje={error} />}

          {!carpeta && !cargando && (
            <div>
              <p className="texto-suave small">
                No existe estructura de carpetas para esta iniciativa.
              </p>
              <button
                type="button"
                className="btn primario small"
                onClick={crearEstructura}
              >
                Crear estructura
              </button>
            </div>
          )}

          {carpeta && !cargando && (
            <div>
              <p className="texto-suave small" style={{ marginBottom: 8 }}>
                📁 {carpeta.numero} - {carpeta.nombre}
              </p>

              <ul className="lista-barras">
                {subcarpetas.map((subcarpeta) => (
                  <li key={subcarpeta} className="barra-fila">
                    <span className="barra-etiqueta">📄 {subcarpeta}</span>
                    <span className="barra-valor">
                      <button
                        type="button"
                        className="btn secundario small"
                        onClick={() => abrirCarpeta(subcarpeta)}
                      >
                        Ver
                      </button>
                    </span>
                  </li>
                ))}
              </ul>

              {carpetaActiva && (
                <div style={{ marginTop: 8 }}>
                  <h4 className="texto-suave small">
                    {carpetaActiva} ({archivos.length} archivos)
                  </h4>
                  {archivos.length === 0 ? (
                    <p className="texto-suave small">Sin archivos.</p>
                  ) : (
                    <ul className="lista-barras">
                      {archivos.map((archivo) => (
                        <li key={archivo.nombre} className="barra-fila">
                          <span className="barra-etiqueta">
                            {archivo.nombre}
                          </span>
                          <span className="barra-valor texto-suave small">
                            {formatearTamano(archivo.tamano)} ·{" "}
                            {formatearFecha(archivo.modificado)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <label className="btn secundario small">
                      Subir archivo
                      <input
                        type="file"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const archivo = e.target.files?.[0];
                          if (archivo) subirArchivo(carpetaActiva, archivo);
                        }}
                        disabled={subiendo}
                      />
                    </label>
                  </div>
                </div>
              )}

              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn secundario small"
                  onClick={abrirEnExplorador}
                >
                  Abrir en explorador
                </button>
                <button
                  type="button"
                  className="btn peligro small"
                  onClick={eliminarEstructura}
                >
                  Eliminar estructura
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
