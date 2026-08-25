"use client";

/**
 * Textarea que crece con el texto.
 *
 * Nicolás: "que se pueda expandir el cuadro de descripción o al escribir más
 * que se vaya expandiendo". Las descripciones de una OC son largas —
 * "Desarrollo, revisión y actualización de procedimientos de trabajo seguro y
 * documentación preventiva - PMGD Panimávida"— y en un `<input>` de una línea
 * el operador escribe a ciegas: ve los últimos 40 caracteres y nada más.
 *
 * Cómo funciona: se pone `height: auto` para que `scrollHeight` mida el alto
 * real del contenido —si no, devuelve el alto actual y nunca ENCOGE al
 * borrar— y después se fija ese alto. Hay que recalcular también cuando el
 * valor cambia desde afuera (pegar una planilla llena varios campos a la vez,
 * y ninguno dispara un evento de tecla).
 *
 * `maxRows` existe para que un pegado de tres párrafos no empuje el botón de
 * guardar fuera de la pantalla: pasado ese alto, el textarea scrollea.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> & {
  /** Alto mínimo, en renglones. */
  minRows?: number;
  /** A partir de acá scrollea en vez de seguir creciendo. */
  maxRows?: number;
};

export const TextareaAutosize = forwardRef<HTMLTextAreaElement, Props>(
  function TextareaAutosize(
    { minRows = 1, maxRows = 12, value, className, onChange, ...rest },
    refExterna,
  ) {
    const propia = useRef<HTMLTextAreaElement | null>(null);
    useImperativeHandle(refExterna, () => propia.current as HTMLTextAreaElement);

    const ajustar = useCallback(() => {
      const el = propia.current;
      if (!el) return;
      const estilo = window.getComputedStyle(el);
      const linea = parseFloat(estilo.lineHeight) || 20;
      // `border-box` incluye padding y bordes en `height`; `content-box` no.
      // Sin esta distinción el textarea crece 8px de más en cada render y
      // termina bailando mientras se escribe.
      const extra =
        estilo.boxSizing === "border-box"
          ? parseFloat(estilo.paddingTop) +
            parseFloat(estilo.paddingBottom) +
            parseFloat(estilo.borderTopWidth) +
            parseFloat(estilo.borderBottomWidth)
          : 0;

      // Sin esto `scrollHeight` devuelve el alto ACTUAL y el campo nunca
      // vuelve a achicarse cuando se borra texto.
      el.style.height = "auto";
      const minimo = linea * minRows + extra;
      const maximo = linea * maxRows + extra;
      const deseado = Math.max(minimo, Math.min(el.scrollHeight, maximo));
      el.style.height = `${deseado}px`;
      el.style.overflowY = el.scrollHeight > maximo ? "auto" : "hidden";
    }, [minRows, maxRows]);

    // useLayoutEffect y no useEffect: ajustar después de pintar produce un
    // salto visible del layout en cada tecla.
    useLayoutEffect(ajustar, [ajustar, value]);

    // Al cambiar el ancho del contenedor cambia cuántos renglones ocupa el
    // mismo texto. Sin esto, girar el teléfono deja el campo cortado.
    useEffect(() => {
      const el = propia.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(ajustar);
      ro.observe(el);
      return () => ro.disconnect();
    }, [ajustar]);

    return (
      <textarea
        {...rest}
        ref={propia}
        value={value}
        onChange={(e) => {
          onChange?.(e);
          ajustar();
        }}
        // `resize-none` porque el alto lo maneja el componente: dejar el
        // tirador del navegador encima produce dos fuentes de verdad y el
        // campo vuelve a saltar en la tecla siguiente.
        className={`${className ?? ""} resize-none`}
        style={{ ...rest.style, overflowY: "hidden" }}
      />
    );
  },
);
