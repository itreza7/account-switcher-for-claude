/*! Icons from Lucide (https://lucide.dev), ISC License, Copyright (c) 2026 Lucide Icons and Contributors.
   Some are derived from Feather, MIT License, Copyright (c) 2013-present Cole Bemis.
   Full notices: THIRD_PARTY_NOTICES.txt */

type Shape = [tag: string, attrs: Record<string, string>];

const ICONS = {
  refreshCw: [["path", {"d": "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}], ["path", {"d": "M21 3v5h-5"}], ["path", {"d": "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}], ["path", {"d": "M8 16H3v5"}]],
  settings: [["path", {"d": "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}], ["circle", {"cx": "12", "cy": "12", "r": "3"}]],
  plus: [["path", {"d": "M5 12h14"}], ["path", {"d": "M12 5v14"}]],
  ellipsis: [["circle", {"cx": "12", "cy": "12", "r": "1"}], ["circle", {"cx": "19", "cy": "12", "r": "1"}], ["circle", {"cx": "5", "cy": "12", "r": "1"}]],
  pencil: [["path", {"d": "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}], ["path", {"d": "m15 5 4 4"}]],
  trash2: [["path", {"d": "M10 11v6"}], ["path", {"d": "M14 11v6"}], ["path", {"d": "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}], ["path", {"d": "M3 6h18"}], ["path", {"d": "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],
  check: [["path", {"d": "M20 6 9 17l-5-5"}]],
  x: [["path", {"d": "M18 6 6 18"}], ["path", {"d": "m6 6 12 12"}]],
  arrowRightLeft: [["path", {"d": "m16 3 4 4-4 4"}], ["path", {"d": "M20 7H4"}], ["path", {"d": "m8 21-4-4 4-4"}], ["path", {"d": "M4 17h16"}]],
  circleAlert: [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["line", {"x1": "12", "x2": "12", "y1": "8", "y2": "12"}], ["line", {"x1": "12", "x2": "12.01", "y1": "16", "y2": "16"}]],
  info: [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["path", {"d": "M12 16v-4"}], ["path", {"d": "M12 8h.01"}]],
  externalLink: [["path", {"d": "M15 3h6v6"}], ["path", {"d": "M10 14 21 3"}], ["path", {"d": "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}]],
  keyboard: [["path", {"d": "M10 8h.01"}], ["path", {"d": "M12 12h.01"}], ["path", {"d": "M14 8h.01"}], ["path", {"d": "M16 12h.01"}], ["path", {"d": "M18 8h.01"}], ["path", {"d": "M6 8h.01"}], ["path", {"d": "M7 16h10"}], ["path", {"d": "M8 12h.01"}], ["rect", {"width": "20", "height": "16", "x": "2", "y": "4", "rx": "2"}]],
  puzzle: [["path", {"d": "M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"}]],
  logIn: [["path", {"d": "m10 17 5-5-5-5"}], ["path", {"d": "M15 12H3"}], ["path", {"d": "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"}]],
  shieldCheck: [["path", {"d": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}], ["path", {"d": "m9 12 2 2 4-4"}]],
  bell: [["path", {"d": "M10.268 21a2 2 0 0 0 3.464 0"}], ["path", {"d": "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}]],
  zap: [["path", {"d": "M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"}]],
  chevronDown: [["path", {"d": "m6 9 6 6 6-6"}]],
  chevronsRight: [["path", {"d": "m6 17 5-5-5-5"}], ["path", {"d": "m13 17 5-5-5-5"}]],
  download: [["path", {"d": "M12 15V3"}], ["path", {"d": "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}], ["path", {"d": "m7 10 5 5 5-5"}]],
  userPlus: [["path", {"d": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}], ["circle", {"cx": "9", "cy": "7", "r": "4"}], ["line", {"x1": "19", "x2": "19", "y1": "8", "y2": "14"}], ["line", {"x1": "22", "x2": "16", "y1": "11", "y2": "11"}]],
  loaderCircle: [["path", {"d": "M21 12a9 9 0 1 1-6.219-8.56"}]],
  circleCheck: [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["path", {"d": "m16 9-5.5 5.5L8 12"}]],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A decorative 24x24 stroke icon. Built with DOM APIs, never innerHTML. */
export function icon(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs: Record<string, string> = {
    width: String(size),
    height: String(size),
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    class: `icon icon-${name}`,
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const [tag, a] of ICONS[name] as Shape[]) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}
