import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * Iconos de línea portados 1:1 desde apps/web/src/components/icons.tsx.
 * Mismos paths y viewBox (0 0 20 20). El color se resuelve vía la prop `color`
 * (react-native-svg mapea `currentColor` a esa prop), igual que `currentColor`
 * en la web.
 */
export interface IconProps {
  size?: number;
  color?: string;
}

function PathIcon({
  size = 19,
  color = '#f1f4f6',
  paths,
}: IconProps & { paths: { d: string; w?: number }[] }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" color={color}>
      {paths.map((p, i) => (
        <Path
          key={i}
          d={p.d}
          stroke="currentColor"
          strokeWidth={p.w ?? 1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

export const IcoGrid = (p: IconProps) => (
  <PathIcon {...p} paths={[{ d: 'M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z' }]} />
);
export const IcoList = (p: IconProps) => (
  <PathIcon {...p} paths={[{ d: 'M7 5h10M7 10h10M7 15h10' }, { d: 'M3.5 5h.01M3.5 10h.01M3.5 15h.01', w: 2 }]} />
);
export const IcoRepeat = (p: IconProps) => (
  <PathIcon
    {...p}
    paths={[{ d: 'M4 8a6 6 0 0 1 10-2l2 2M16 12a6 6 0 0 1-10 2l-2-2' }, { d: 'M16 3v3h-3M4 17v-3h3' }]}
  />
);
export const IcoMeter = (p: IconProps) => (
  <PathIcon {...p} paths={[{ d: 'M3 15a7 7 0 0 1 14 0' }, { d: 'M10 15l4-4' }]} />
);
export const IcoDebt = (p: IconProps) => (
  <PathIcon {...p} paths={[{ d: 'M10 3v14M6 6h6a2.5 2.5 0 0 1 0 5H7a2.5 2.5 0 0 0 0 5h7' }]} />
);
export const IcoTag = (p: IconProps) => (
  <PathIcon {...p} paths={[{ d: 'M4 4h6l6 6-6 6-6-6z' }, { d: 'M7.5 7.5h.01', w: 2.2 }]} />
);
export const IcoWallet = (p: IconProps) => (
  <PathIcon
    {...p}
    paths={[
      { d: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H15v3M3 6.5V15a1.5 1.5 0 0 0 1.5 1.5H16V8H4.5A1.5 1.5 0 0 1 3 6.5Z' },
      { d: 'M13.5 11.5h.01', w: 2 },
    ]}
  />
);
export const IcoTarget = (p: IconProps) => (
  <PathIcon
    {...p}
    paths={[
      { d: 'M10 3a7 7 0 1 0 7 7' },
      { d: 'M10 6.5a3.5 3.5 0 1 0 3.5 3.5' },
      { d: 'M10 10l6-6M14 4V2M16 6h2', w: 1.7 },
    ]}
  />
);
export const IcoDoc = (p: IconProps) => (
  <PathIcon {...p} paths={[{ d: 'M6 3h5l4 4v10H6z' }, { d: 'M11 3v4h4M8.5 11h5M8.5 14h3' }]} />
);
export const IcoPlus = (p: IconProps) => <PathIcon {...p} paths={[{ d: 'M10 4v12M4 10h12', w: 2.2 }]} />;
export const IcoMenu = (p: IconProps) => <PathIcon {...p} paths={[{ d: 'M3 5h14M3 10h14M3 15h14', w: 1.8 }]} />;
export const IcoLogout = (p: IconProps) => (
  <PathIcon {...p} paths={[{ d: 'M12 3H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7M14 13l3-3-3-3M17 10H8' }]} />
);

export function IcoSettings({ size = 18, color = '#f1f4f6' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" color={color}>
      <Circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      <Path
        d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export const IcoPause = (p: IconProps) => <PathIcon {...p} paths={[{ d: 'M7 4v12M13 4v12', w: 2.2 }]} />;
export const IcoPlay = (p: IconProps) => <PathIcon {...p} paths={[{ d: 'M6 4l10 6-10 6z', w: 1.7 }]} />;
export const IcoTrash = (p: IconProps) => (
  <PathIcon
    {...p}
    paths={[{ d: 'M4 6h12M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6M6 6l.7 9.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L14 6' }]}
  />
);
export const IcoSpark = (p: IconProps) => (
  <PathIcon
    {...p}
    paths={[{ d: 'M10 2.5l1.8 5.7 5.7 1.8-5.7 1.8L10 17.5l-1.8-5.7-5.7-1.8 5.7-1.8z' }, { d: 'M16 2.5v3M17.5 4h-3', w: 1.4 }]}
  />
);
export const IcoPencil = (p: IconProps) => (
  <PathIcon {...p} paths={[{ d: 'M13.5 4.5l2 2M12.5 3.5l4 4L7 17H3v-4z' }]} />
);

export function IcoSearch({ size = 16, color = '#f1f4f6' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" color={color}>
      <Circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.7" />
      <Path d="M17 17l-3.5-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  );
}

/** Marca de la app: tarjeta con línea y chip, igual que la web (trazo en color `color`). */
export function LogoMark({ size = 18, color = '#012111' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" color={color}>
      <Rect x="2.5" y="4.5" width="15" height="11" rx="2.4" stroke="currentColor" strokeWidth="1.8" />
      <Path d="M2.5 8.2h15" stroke="currentColor" strokeWidth="1.8" />
      <Circle cx="13.6" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  );
}
