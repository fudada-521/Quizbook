import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'settings'
  | 'arrow-left'
  | 'arrow-right'
  | 'chevron-right'
  | 'shuffle'
  | 'compass'
  | 'book'
  | 'grid'
  | 'check'
  | 'x'
  | 'rotate'
  | 'download'
  | 'upload'
  | 'star';

const paths: Record<IconName, ReactNode> = {
  settings: (
    <>
      <path d="M4 7h8M16 7h4" />
      <circle cx="14" cy="7" r="2" />
      <path d="M4 17h4M12 17h8" />
      <circle cx="10" cy="17" r="2" />
      <path d="M4 12h12M20 12h0" />
      <circle cx="18" cy="12" r="2" />
    </>
  ),
  'arrow-left': <path d="M19 12H5M11 18l-6-6 6-6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  shuffle: (
    <>
      <path d="M16 3h5v5" />
      <path d="M4 20L21 3" />
      <path d="M21 16v5h-5" />
      <path d="M15 15l6 6M4 4l5 5" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13z" />
      <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" />
    </>
  ),
  check: <path d="M20 6L9 17l-5-5" />,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  rotate: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M5 21h14" />
    </>
  ),
  star: (
    <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.78l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85L12 3.5z" />
  ),
};

export function Icon({
  name,
  size = 18,
  ...rest
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}