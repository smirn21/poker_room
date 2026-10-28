import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 22, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    ...rest,
  };
}

export function IconLobby(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
    </svg>
  );
}

export function IconTables(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="5" width="10" height="14" rx="1.5" />
      <rect x="10.5" y="5" width="10" height="14" rx="1.5" />
      <path d="M13.5 12h4M15.5 10v4" />
    </svg>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 8.5h15A2.5 2.5 0 0 1 21 11v7.5A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3H16" />
      <circle cx="16.5" cy="14.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconProfile(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5 19.5c1.6-3.2 4-4.75 7-4.75s5.4 1.55 7 4.75" />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 12a8 8 0 1 1-2.2-5.5" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

export function IconChip(props: IconProps) {
  return (
    <svg {...base({ ...props, strokeWidth: 1.5 })}>
      <circle cx="12" cy="12" r="8.25" />
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 3.75v2.5M12 17.75v2.5M3.75 12h2.5M17.75 12h2.5M6.4 6.4l1.8 1.8M15.8 15.8l1.8 1.8M17.6 6.4l-1.8 1.8M8.2 15.8l-1.8 1.8" />
    </svg>
  );
}

export function IconSpadeMark(props: IconProps) {
  return (
    <svg
      width={props.size ?? 22}
      height={props.size ?? 22}
      viewBox="0 0 24 24"
      aria-hidden
      {...props}
    >
      <path
        fill="currentColor"
        d="M12 3.2c3.6 3.3 7.2 6.4 7.2 10.1A4.7 4.7 0 0 1 12 16.8 4.7 4.7 0 0 1 4.8 13.3C4.8 9.6 8.4 6.5 12 3.2Zm0 13.6c1.1 0 2 .5 2.6 1.3H9.4c.6-.8 1.5-1.3 2.6-1.3Z"
      />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="2.75" />
      <circle cx="16.5" cy="9" r="2.25" />
      <path d="M3.5 18.5c1.2-2.6 3.1-3.9 5.5-3.9s4.3 1.3 5.5 3.9" />
      <path d="M13.2 14.6c1.4-.5 2.9-.4 4.8.9 1.1.8 1.9 1.9 2.5 3" />
    </svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
    </svg>
  );
}
