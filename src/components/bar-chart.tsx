/**
 * Gráfico de barras em SVG puro (sem biblioteca), renderizado no servidor.
 * Uma série só: o título do cartão diz o que é, então não há legenda.
 * Barras finas com topo arredondado, grade discreta, rótulo só no maior valor e no último período,
 * dica ao passar o mouse (title) e período em andamento com barra hachurada.
 */
export interface BarDatum {
  key: string;
  label: string;
  value: number;
  tooltip: string;
  partial?: boolean;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}

export function BarChart({
  data,
  color,
  format,
  axisFormat,
  ariaLabel,
  height = 220,
}: {
  data: BarDatum[];
  color: string;
  format: (v: number) => string;
  axisFormat: (v: number) => string;
  ariaLabel: string;
  height?: number;
}) {
  const W = 720;
  const H = height;
  const pad = { top: 22, right: 8, bottom: 26, left: 58 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const slot = iw / Math.max(1, data.length);
  const bw = Math.min(36, slot * 0.6);
  const y = (v: number) => pad.top + ih - (Math.max(0, v) / max) * ih;
  const maxIdx = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const labelIdx = new Set([maxIdx, data.length - 1]);
  const pid = `hatch-${color.replace("#", "")}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
      <defs>
        <pattern id={pid} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill={color} opacity="0.25" />
          <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="2.5" />
        </pattern>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#a8a29e" : "#e7e5e4"} strokeWidth={1} />
          <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#78716c">{axisFormat(t)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = pad.left + slot * i + slot / 2;
        const top = y(d.value);
        const h = Math.max(0, pad.top + ih - top);
        const r = Math.min(4, h / 2, bw / 2);
        // topo arredondado, base reta no eixo
        const path =
          h <= 0
            ? ""
            : `M${cx - bw / 2},${pad.top + ih} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${pad.top + ih} Z`;
        return (
          <g key={d.key} className="group">
            <title>{d.tooltip}</title>
            {/* área de toque maior que a barra */}
            <rect x={pad.left + slot * i} y={pad.top} width={slot} height={ih} fill="transparent" />
            <rect x={pad.left + slot * i + 1} y={pad.top} width={slot - 2} height={ih} fill="#f5f5f4" className="opacity-0 group-hover:opacity-100" />
            {path ? <path d={path} fill={d.partial ? `url(#${pid})` : color} /> : null}
            {labelIdx.has(i) && d.value > 0 ? (
              <text x={cx} y={top - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="#292524">{format(d.value)}</text>
            ) : null}
            <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="#57534e">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
