import DOMPurify from "dompurify";

/** Etiquetas que no aportan al texto y pueden cargar recursos o crear UI activa. */
const ETIQUETAS_BLOQUEADAS = [
  "audio",
  "button",
  "embed",
  "form",
  "iframe",
  "img",
  "input",
  "object",
  "source",
  "svg",
  "video",
];

/** Sanitiza HTML de Azure (DOMPurify remueve scripts, handlers, iframes y estilos inline). */
export function limpiarHtml(html: string): string {
  return DOMPurify.sanitize(html || "", {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ETIQUETAS_BLOQUEADAS,
    FORBID_ATTR: ["style", "srcset", "formaction"],
  });
}

function tieneTexto(htmlLimpio: string): boolean {
  return htmlLimpio.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;
}

/**
 * Renderiza contenido HTML (descripciones de Azure) sanitizado y legible.
 * Si el HTML está vacío muestra un marcador sutil en lugar de nada.
 */
export function ContenidoRico({ html, vacio = "Sin descripción." }: { html: string; vacio?: string }) {
  const limpio = limpiarHtml(html);
  if (!tieneTexto(limpio)) {
    return <p className="texto-suave small">{vacio}</p>;
  }
  return <div className="contenido-rico" dangerouslySetInnerHTML={{ __html: limpio }} />;
}
