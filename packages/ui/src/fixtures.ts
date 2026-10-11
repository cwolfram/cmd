// Pictures for the kit's stories (Picture, Thumb, Filmstrip, Scrubber): SVGs drawn here as
// data URLs, a gradient in a hue with a horizon, so no image files ship for them.
export function picture(hue: number, label = "", w = 640, h = 400): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 72%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 60% 38%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><path d="M0 ${h * 0.72} Q ${w * 0.3} ${h * 0.55} ${w * 0.55} ${h * 0.7} T ${w} ${h * 0.62} V ${h} H 0 Z" fill="hsl(${(hue + 80) % 360} 35% 22%)" opacity=".8"/><text x="24" y="${h - 24}" font-family="-apple-system, sans-serif" font-size="${Math.round(h / 12)}" fill="white" opacity=".85">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
