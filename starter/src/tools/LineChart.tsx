import { useDoc } from "@werkbank/framework";
import { useCallback, useState } from "react";
import { niceTicks, useCanvas, type Surface } from "./canvas";

export interface Point {
  label: string;
  value: number;
}

const PAD = { left: 8, right: 58, top: 10, bottom: 20 };

/**
 * One series over time with a zero baseline and a hover crosshair. Used for
 * P&L, where the sign of the value matters: the line is one colour, and the
 * area between it and zero is tinted by which side of zero it is on.
 */
export function LineChart({ points, format, label }: { points: Point[]; format: (n: number) => string; label: string }) {
  const theme = useDoc((doc) => doc.shell.theme);
  const [hover, setHover] = useState<number | null>(null);
  const at = hover !== null ? points[Math.min(hover, points.length - 1)] : undefined;

  const draw = useCallback(
    ({ g, width, height, token }: Surface) => {
      g.clearRect(0, 0, width, height);
      if (points.length < 2) {
        g.fillStyle = token("--wb-text-dim");
        g.fillText("Waiting for data…", PAD.left, PAD.top + 12);
        return;
      }
      const values = points.map((p) => p.value);
      const lo = Math.min(0, ...values);
      const hi = Math.max(0, ...values);
      const span = hi - lo || 1;
      const plotW = width - PAD.left - PAD.right;
      const plotH = height - PAD.top - PAD.bottom;
      const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
      const y = (v: number) => PAD.top + (1 - (v - lo) / span) * plotH;

      g.textBaseline = "middle";
      g.lineWidth = 1;
      for (const v of niceTicks(lo, hi)) {
        const yy = Math.round(y(v)) + 0.5;
        g.strokeStyle = token("--wb-grid");
        g.beginPath();
        g.moveTo(PAD.left, yy);
        g.lineTo(PAD.left + plotW, yy);
        g.stroke();
        g.fillStyle = token("--wb-text-dim");
        g.fillText(format(v), PAD.left + plotW + 6, yy);
      }
      g.textBaseline = "alphabetic";
      for (const i of [0, Math.floor(points.length / 2), points.length - 1]) {
        const text = points[i]!.label;
        const w = g.measureText(text).width;
        g.fillText(text, Math.min(Math.max(x(i) - w / 2, PAD.left), PAD.left + plotW - w), height - 6);
      }

      // Tint above zero and below zero separately, clipped at the baseline.
      const zero = y(0);
      const area = (top: number, bottom: number, colour: string) => {
        g.save();
        g.beginPath();
        g.rect(PAD.left, top, plotW, bottom - top);
        g.clip();
        g.beginPath();
        g.moveTo(x(0), zero);
        points.forEach((p, i) => g.lineTo(x(i), y(p.value)));
        g.lineTo(x(points.length - 1), zero);
        g.closePath();
        g.globalAlpha = 0.16;
        g.fillStyle = colour;
        g.fill();
        g.restore();
      };
      area(PAD.top, zero, token("--wb-good"));
      area(zero, PAD.top + plotH, token("--wb-bad"));

      g.strokeStyle = token("--wb-text-dim");
      g.beginPath();
      g.moveTo(PAD.left, Math.round(zero) + 0.5);
      g.lineTo(PAD.left + plotW, Math.round(zero) + 0.5);
      g.stroke();

      g.strokeStyle = token("--wb-accent");
      g.lineWidth = 2;
      g.lineJoin = "round";
      g.beginPath();
      points.forEach((p, i) => (i ? g.lineTo(x(i), y(p.value)) : g.moveTo(x(i), y(p.value))));
      g.stroke();

      if (hover !== null && hover < points.length) {
        const hx = Math.round(x(hover)) + 0.5;
        g.lineWidth = 1;
        g.strokeStyle = token("--wb-text-dim");
        g.beginPath();
        g.moveTo(hx, PAD.top);
        g.lineTo(hx, PAD.top + plotH);
        g.stroke();
        g.fillStyle = token("--wb-accent");
        g.beginPath();
        g.arc(x(hover), y(points[hover]!.value), 4, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = token("--wb-canvas");
        g.stroke();
      }
    },
    [points, hover, format, theme],
  );
  const ref = useCanvas(draw);

  return (
    <div className="st-chart">
      <div className="st-readout wb-num" aria-live="off">
        {at ? `${at.label}   ${format(at.value)}` : " "}
      </div>
      <canvas
        ref={ref}
        className="st-canvas"
        role="img"
        aria-label={label}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const t = (e.clientX - rect.left - PAD.left) / (rect.width - PAD.left - PAD.right);
          setHover(points.length ? Math.round(Math.min(1, Math.max(0, t)) * (points.length - 1)) : null);
        }}
        onPointerLeave={() => setHover(null)}
      />
    </div>
  );
}
