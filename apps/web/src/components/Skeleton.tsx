/**
 * Bloque gris animado para estados de carga: reemplaza un placeholder de
 * texto ("Cargando…") por una silueta del contenido real, del mismo alto/ancho
 * que ocupará el dato una vez llegue. Genérico a propósito para reusarse en
 * cualquier página, no solo el dashboard.
 */

import type { CSSProperties } from 'react';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  style?: CSSProperties;
}

export function Skeleton({ width = '100%', height = 14, style }: SkeletonProps) {
  return <span className="mf-skeleton" aria-hidden="true" style={{ width, height, ...style }} />;
}
