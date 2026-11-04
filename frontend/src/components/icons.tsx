import type { SVGProps } from "react";

const P = (d: string | string[]) => (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {(Array.isArray(d) ? d : [d]).map((x, i) => <path key={i} d={x} />)}
  </svg>
);

export const IHome = P(["M3 10.5 12 3l9 7.5", "M5 9.5V21h14V9.5", "M10 21v-6h4v6"]);
export const ISales = P(["M6 3h9l4 4v14H6z", "M15 3v4h4", "M9 12h7M9 16h7M9 8h3"]);
export const IPurchase = P(["M3 5h2l2.2 10.5h11L20 8H6.2", "M9 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01"]);
export const IReturns = P(["M4 4h16v16H4z", "M8 9l2.5 2.5L16 6", "M8 15h8"]);
export const IReports = P(["M4 20V10M10 20V4M16 20v-7M22 20H2"]);
export const IImport = P(["M12 3v12", "M7 10l5 5 5-5", "M4 21h16"]);
export const IDocs = P(["M8 3h8l4 4v14H8z", "M4 7v14h12", "M16 3v4h4"]);
export const IPeople = P(["M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7", "M17 3.5a4 4 0 0 1 0 7.5M22 21c0-3-1.9-5.6-4.5-6.6"]);
export const ISettings = P(["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"]);
export const IHelp = P(["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"]);
export const IPlus = P(["M12 5v14M5 12h14"]);
export const ICheck = P(["M5 12.5l4.5 4.5L19 7"]);
export const IX = P(["M6 6l12 12M18 6L6 18"]);
export const ISearch = P(["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M21 21l-5-5"]);
export const IDownload = P(["M12 4v11", "M7 11l5 5 5-5", "M5 20h14"]);
export const IBack = P(["M15 18l-6-6 6-6"]);
export const INext = P(["M9 18l6-6-6-6"]);
export const IMore = P(["M5 12h.01M12 12h.01M19 12h.01"]);
export const ITrash = P(["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"]);
export const IClip = P(["M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"]);
export const IUndo = P(["M9 14L4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"]);
export const ILock = P(["M5 11h14v10H5z", "M8 11V7a4 4 0 1 1 8 0v4"]);
export const IBook = P(["M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z", "M4 16a4 4 0 0 1 4-4h12"]);
