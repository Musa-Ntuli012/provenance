/** Hand-drawn 24×24 stroke icon set, 1.6px stroke, square caps: quiet,
 *  architectural line weight that sits well with the serif wordmark. */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
});

export const Mark = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="M5 20V4.5l7 6 7-6V20" />
  </svg>
);

export const Grid = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </svg>
);

export const Folder = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 7.5v10a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-7l-2-2.5h-4a2 2 0 0 0-2 2.5Z" />
  </svg>
);

export const Board = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="4" width="17" height="16" rx="2" />
    <path d="M9 4v16M15 4v10" />
  </svg>
);

export const Calendar = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </svg>
);

export const Chart = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20V10M10 20V4M16 20v-8M21 20H3" />
  </svg>
);

export const MapPin = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 21s7-5.1 7-11a7 7 0 0 0-14 0c0 5.9 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.6" />
  </svg>
);

export const File = (p: P) => (
  <svg {...base(p)}>
    <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z" />
    <path d="M13.5 3.5V9H19" />
  </svg>
);

export const Users = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19.5c.6-3.2 2.9-4.8 5.5-4.8s4.9 1.6 5.5 4.8" />
    <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 15.1c1.6.7 2.7 2.1 3 4.4" />
  </svg>
);

export const Shield = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.5 5 6v6c0 4.5 3 7.7 7 8.5 4-.8 7-4 7-8.5V6l-7-2.5Z" />
    <path d="m9.2 12 2 2 3.6-4" />
  </svg>
);

export const Gear = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.35.95a7 7 0 0 0-2.42-1.4L13.73 2.5h-3.46l-.36 2.64a7 7 0 0 0-2.42 1.4l-2.35-.95-2 3.46 2 1.55a7.06 7.06 0 0 0 0 2.8l-2 1.55 2 3.46 2.35-.95a7 7 0 0 0 2.42 1.4l.36 2.64h3.46l.36-2.64a7 7 0 0 0 2.42-1.4l2.35.95 2-3.46-2-1.55c.1-.45.14-.92.14-1.4Z" />
  </svg>
);

export const Check = (p: P) => (
  <svg {...base(p)} strokeWidth={2.1}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const CheckCircle = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.5 12.4 2.4 2.4 4.8-5" />
  </svg>
);

export const X = (p: P) => (
  <svg {...base(p)} strokeWidth={2}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const Alert = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4 2.8 19.5h18.4L12 4Z" />
    <path d="M12 10v4.2M12 17.2v.4" />
  </svg>
);

export const Clock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2.4" />
  </svg>
);

export const Plus = (p: P) => (
  <svg {...base(p)} strokeWidth={2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Search = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.3-4.3" />
  </svg>
);

export const Download = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M4.5 20h15" />
  </svg>
);

export const Upload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M4.5 20h15" />
  </svg>
);

export const Chevron = (p: P) => (
  <svg {...base(p)}>
    <path d="m9 5.5 6.5 6.5L9 18.5" />
  </svg>
);

export const ArrowLeft = (p: P) => (
  <svg {...base(p)}>
    <path d="M19.5 12h-15m0 0 5.5-5.5M4.5 12l5.5 5.5" />
  </svg>
);

export const Stamp = (p: P) => (
  <svg {...base(p)}>
    <path d="M6.5 21h11M5 17.5h14v-1.6a1.9 1.9 0 0 0-1.9-1.9h-.6l-1-4.5a3.5 3.5 0 1 0-7 0l-1 4.5h-.6a1.9 1.9 0 0 0-1.9 1.9v1.6Z" />
  </svg>
);

export const Coins = (p: P) => (
  <svg {...base(p)}>
    <ellipse cx="9" cy="7.5" rx="5.5" ry="2.5" />
    <path d="M3.5 7.5v9c0 1.38 2.46 2.5 5.5 2.5 1.14 0 2.2-.16 3.08-.44M3.5 12c0 1.38 2.46 2.5 5.5 2.5 1.1 0 2.13-.15 3-.42" />
    <path d="M15.5 11.5c2.8.2 5 1.24 5 2.5v5c0 1.38-2.46 2.5-5.5 2.5-2.6 0-4.77-.83-5.37-1.95" />
  </svg>
);

export const Logout = (p: P) => (
  <svg {...base(p)}>
    <path d="M14.5 4h-8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8M16 8l4 4-4 4M20 12H9.5" />
  </svg>
);

export const Layers = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 3.5 9 5-9 5-9-5 9-5Z" />
    <path d="m4.5 12.8 7.5 4.2 7.5-4.2M4.5 16.8l7.5 4.2 7.5-4.2" />
  </svg>
);
