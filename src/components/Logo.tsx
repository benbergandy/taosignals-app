"use client";

import { useEffect, useRef } from "react";

export default function Logo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    const FONT = '700 24px "IBM Plex Mono"';
    const LETTER_COLOR = "#c8d8e8";
    const FREQ = 0.028;

    function drawLogo() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);

      ctx.font = FONT;
      const taoW = ctx.measureText("TAO").width;
      const sigW = ctx.measureText("SIGNALS").width;
      const gap = 10;
      const taoX = Math.round((W - taoW - gap - sigW) / 2);
      const sigX = taoX + taoW + gap;
      const bl = Math.round(H * 0.72);
      const mid = H * 0.5;
      const waveX0 = taoX - 8;
      const waveX1 = sigX + sigW + 8;

      const wT = ctx.measureText("T").width;
      const wA = ctx.measureText("A").width;
      const wO = ctx.measureText("O").width;
      const wS = ctx.measureText("S").width;
      const wI = ctx.measureText("I").width;
      const wG = ctx.measureText("G").width;
      const wN = ctx.measureText("N").width;
      const wA2 = ctx.measureText("A").width;
      const wL = ctx.measureText("L").width;
      const xT = taoX;
      const xA = taoX + wT;
      const xO = taoX + wT + wA;
      const xS = sigX;
      const xG = sigX + wS + wI;
      const xN = sigX + wS + wI + wG;
      const xA2 = sigX + wS + wI + wG + wN;
      const xL = sigX + wS + wI + wG + wN + wA2;
      const oCx = xO + wO * 0.5;
      const aCx = xA2 + wA2 * 0.5;

      const phase = -oCx * FREQ + 0.25;

      const pts: [number, number][] = [];
      for (let x = waveX0; x <= waveX1; x++) {
        const t = (x - waveX0) / (waveX1 - waveX0);
        const fade = Math.min(t * 10, 1) * Math.min((1 - t) * 10, 1);
        const mp = (oCx + aCx) / 2;
        const swell = 5.5 * Math.exp(-Math.pow((x - mp) / ((aCx - oCx) * 0.45), 2));
        const amp = (1.8 + swell) * fade;
        pts.push([x, mid + Math.sin((x * FREQ + phase) * Math.PI * 2) * amp]);
      }

      // Letters base
      ctx.fillStyle = LETTER_COLOR;
      ctx.font = FONT;
      ctx.fillText("TAO", taoX, bl);
      ctx.fillText("SIGNALS", sigX, bl);

      // Wave glow + core
      const grad = ctx.createLinearGradient(waveX0, 0, waveX1, 0);
      grad.addColorStop(0, "rgba(160,100,0,0)");
      grad.addColorStop(0.06, "#FFD000");
      grad.addColorStop(0.45, "#FFE566");
      grad.addColorStop(0.55, "#FFE566");
      grad.addColorStop(0.94, "#FFD000");
      grad.addColorStop(1, "rgba(160,100,0,0)");

      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.strokeStyle = "rgba(255,200,0,0.10)";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Redraw behind-letters over wave
      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      const oc = off.getContext("2d");
      if (oc) {
        oc.fillStyle = LETTER_COLOR;
        oc.font = FONT;
        oc.fillText("TAO", taoX, bl);
        oc.fillText("SIGNALS", sigX, bl);

        [
          { x: xT, w: wT },
          { x: xA, w: wA },
          { x: xS, w: wS },
          { x: xG, w: wG },
          { x: xL, w: wL + 2 },
        ].forEach(({ x, w }) => {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x - 1, 0, w + 2, H);
          ctx.clip();
          ctx.drawImage(off, 0, 0);
          ctx.restore();
        });
      }

      // Thread through O and A counters
      function thread(cx: number, cy: number, rx: number, ry: number, xFrom: number, xTo: number) {
        if (!ctx) return;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.clip();
        const seg = pts.filter(([x]) => x >= xFrom - 1 && x <= xTo + 1);
        if (seg.length > 1) {
          ctx.beginPath();
          seg.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
          ctx.strokeStyle = "#FFE566";
          ctx.lineWidth = 1.8;
          ctx.lineCap = "round";
          ctx.stroke();
        }
        ctx.restore();
      }

      thread(oCx, bl - 11, wO * 0.27, 6, xO, xO + wO);
      thread(aCx, bl - 11, wA2 * 0.27, 6, xA2, xA2 + wA2);
    }

    // Wait for font to load
    document.fonts.ready.then(() => setTimeout(drawLogo, 80));
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={48}
      className="block cursor-default mr-2"
    />
  );
}
