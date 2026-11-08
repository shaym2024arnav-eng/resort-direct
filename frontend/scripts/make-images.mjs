// Generates the placeholder landscape images (layered misty ridges over coffee rows).
// They stand in for real photography (see docs/assumptions.md) and weigh a few KB each,
// which suits slow hill-station networks. Deterministic: same output on every run.
import { mkdirSync, writeFileSync } from "node:fs";

const W = 1600, H = 1000;

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const PALETTES = {
  dawn:     { sky: ["#E9EEF0", "#F6E9DF"], ridges: ["#C9D3D3", "#A9B9B6", "#86A096", "#5F7F6F", "#3E5F4E"], mist: "#F4F1EE", sun: "#F3D9C3" },
  mist:     { sky: ["#E6ECEA", "#F3F5F2"], ridges: ["#CDD7D2", "#B0C0B8", "#8EA699", "#678576", "#425F50"], mist: "#F2F5F2", sun: null },
  morning:  { sky: ["#DCE8EC", "#F1F5F2"], ridges: ["#C3D2D0", "#9DB5AD", "#77998A", "#507565", "#2F5242"], mist: "#EEF3F1", sun: "#F6F1DE" },
  golden:   { sky: ["#EDE6D6", "#F5EFE3"], ridges: ["#D3CDBB", "#B4B399", "#8D977A", "#64775B", "#3F5541"], mist: "#F3EEE3", sun: "#F2DCB0" },
  dusk:     { sky: ["#D9D8E2", "#EDE3E0"], ridges: ["#BFC0CB", "#9EA3AE", "#7C8790", "#58676B", "#36474A"], mist: "#E9E6E8", sun: "#EBCFC4" },
  overcast: { sky: ["#E3E6E4", "#EEF0EE"], ridges: ["#CFD5D1", "#B5BEB8", "#95A39A", "#70827A", "#4A5D53"], mist: "#EFF1EF", sun: null },
};

function ridgePath(r, baseY, amp, freq) {
  const pts = [];
  const phase = r() * Math.PI * 2, phase2 = r() * Math.PI * 2;
  for (let x = 0; x <= W; x += 20) {
    const y = baseY + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 2.7 + phase2) * amp * 0.35 + (r() - 0.5) * amp * 0.08;
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return `M0,${H} L${pts.join(" L")} L${W},${H} Z`;
}

function coffeeRows(r, color, startY) {
  // Contour rows of rounded coffee bushes on the nearest slope.
  let out = "";
  for (let row = 0; row < 9; row++) {
    const y0 = startY + row * 34 + row * row * 2.2;
    const size = 9 + row * 2.6;
    const phase = r() * 6;
    for (let x = -20; x < W + 20; x += size * 1.55) {
      const y = y0 + Math.sin(x / 260 + phase) * 14;
      out += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(size * 0.85).toFixed(1)}" ry="${(size * 0.55).toFixed(1)}"/>`;
    }
  }
  return `<g fill="${color}" opacity="0.9">${out}</g>`;
}

function silverOaks(r, color, baseY, count) {
  let out = "";
  for (let i = 0; i < count; i++) {
    const x = r() * W, h = 160 + r() * 220, y = baseY + r() * 40;
    out += `<path d="M${x.toFixed(0)},${y.toFixed(0)} L${(x + 1.5).toFixed(0)},${(y - h).toFixed(0)}" stroke="${color}" stroke-width="3"/>`;
    for (let k = 0; k < 4; k++) {
      const cy = y - h * (0.55 + k * 0.13), rx = 14 + r() * 10;
      out += `<ellipse cx="${(x + (r() - 0.5) * 16).toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${(rx * 1.5).toFixed(0)}" fill="${color}" opacity="0.85"/>`;
    }
  }
  return out;
}

function scene({ seed, palette, extra = "" }) {
  const r = rng(seed);
  const p = PALETTES[palette];
  const [a, b, c, d, e] = p.ridges;
  const sun = p.sun ? `<circle cx="${(300 + r() * 1000).toFixed(0)}" cy="${(180 + r() * 120).toFixed(0)}" r="70" fill="${p.sun}" opacity="0.9"/>` : "";
  const mist = (y, h, o) => `<rect x="0" y="${y}" width="${W}" height="${h}" fill="url(#m)" opacity="${o}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset="1" stop-color="${p.sky[1]}"/></linearGradient>
<linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.mist}" stop-opacity="0"/><stop offset=".5" stop-color="${p.mist}"/><stop offset="1" stop-color="${p.mist}" stop-opacity="0"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#s)"/>${sun}
<path d="${ridgePath(r, 430, 55, 0.004)}" fill="${a}"/>${mist(380, 160, 0.8)}
<path d="${ridgePath(r, 520, 60, 0.0035)}" fill="${b}"/>${mist(480, 150, 0.7)}
<path d="${ridgePath(r, 610, 50, 0.005)}" fill="${c}"/>${mist(580, 120, 0.55)}
<path d="${ridgePath(r, 700, 45, 0.0042)}" fill="${d}"/>
${silverOaks(r, e, 760, 6)}
<path d="${ridgePath(r, 780, 30, 0.003)}" fill="${e}"/>
${coffeeRows(r, d, 800)}
${extra}
</svg>`;
}

// Overlays that hint at the room type without pretending to be a photograph.
const windowFrame = `<g fill="none" stroke="#2A2F2B" stroke-width="34"><rect x="17" y="17" width="1566" height="966"/><path d="M800 0V1000M0 500H1600"/></g><rect x="0" y="930" width="1600" height="70" fill="#3A3A34"/>`;
const villaRoof = `<g fill="#3B3A35"><path d="M980 760 L1180 640 L1380 760 Z"/><rect x="1010" y="760" width="340" height="110"/></g><rect x="1130" y="790" width="60" height="80" fill="#E9D9A8"/>`;
const poolEdge = `<rect x="0" y="880" width="1600" height="120" fill="#7FA8A6"/><rect x="0" y="872" width="1600" height="12" fill="#E6E2D8"/>`;

const IMAGES = {
  "hero": { seed: 7, palette: "morning" },
  "estate-room-1": { seed: 11, palette: "morning" },
  "estate-room-2": { seed: 12, palette: "mist", extra: windowFrame },
  "estate-room-3": { seed: 13, palette: "golden" },
  "valley-view-room-1": { seed: 21, palette: "dawn" },
  "valley-view-room-2": { seed: 22, palette: "mist", extra: windowFrame },
  "valley-view-room-3": { seed: 23, palette: "dusk" },
  "coffee-suite-1": { seed: 31, palette: "golden" },
  "coffee-suite-2": { seed: 32, palette: "overcast", extra: windowFrame },
  "coffee-suite-3": { seed: 33, palette: "morning" },
  "plantation-villa-1": { seed: 41, palette: "mist", extra: villaRoof },
  "plantation-villa-2": { seed: 42, palette: "golden", extra: villaRoof },
  "plantation-villa-3": { seed: 43, palette: "dawn" },
  "pool-villa-1": { seed: 51, palette: "dusk", extra: poolEdge },
  "pool-villa-2": { seed: 52, palette: "morning", extra: poolEdge },
  "pool-villa-3": { seed: 53, palette: "dawn", extra: villaRoof },
  "events": { seed: 61, palette: "golden" },
};

mkdirSync("public/images/rooms", { recursive: true });
for (const [name, opts] of Object.entries(IMAGES)) {
  const file = name === "hero" || name === "events" ? `public/images/${name}.svg` : `public/images/rooms/${name}.svg`;
  writeFileSync(file, scene(opts).replace(/\n/g, ""));
}
console.log(`Wrote ${Object.keys(IMAGES).length} images.`);
