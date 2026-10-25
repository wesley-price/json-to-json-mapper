// A few line icons (16px, current text colour), so buttons don't mix emoji styles.

const PATHS: Record<string, string> = {
  spec: "M9 2h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2V3a1 1 0 0 1 1-1zm0 2v1h6V4H9zm-1 6h8m-8 4h8m-8 4h5",
  note: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4V5z",
  translate: "M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3",
  contrast: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 0v18",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-2.5-11.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14m0 3h.01",
};

export function Icon({ name, className = "" }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`inline-block shrink-0 align-[-2px] ${className}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
