"use client";
import { useEffect, useRef } from "react";

// Fondo estilo TradingView: velas japonesas con tendencia alcista,
// media móvil dorada, rejilla sutil. Canvas autocontenido (sin librerías).
export default function LoginBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const context = cv.getContext("2d");
    if (!context) return;
    const ctx: CanvasRenderingContext2D = context;
    const el: HTMLCanvasElement = cv;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let raf = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function resize() {
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = w * dpr;
      el.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const N = 68;
    let price = 90;
    const candles: { o: number; h: number; l: number; c: number }[] = [];
    function nextCandle() {
      const drift = 0.7;
      const vol = 6.5;
      const o = price;
      let c = o + (Math.random() - 0.4) * vol + drift; // sesgo alcista
      if (c < 15) c = 15 + Math.random() * 5;
      const hi = Math.max(o, c) + Math.random() * vol * 0.6;
      const lo = Math.min(o, c) - Math.random() * vol * 0.6;
      price = c;
      return { o, h: hi, l: lo, c };
    }
    for (let i = 0; i < N; i++) candles.push(nextCandle());

    let last = performance.now();
    let acc = 0;
    const step = 1500; // ms por nueva vela

    function draw(now: number) {
      const dt = now - last;
      last = now;
      if (!reduce) {
        acc += dt;
        if (acc > step) {
          acc = 0;
          candles.push(nextCandle());
          candles.shift();
        }
      }

      let min = Infinity;
      let max = -Infinity;
      for (const k of candles) {
        if (k.l < min) min = k.l;
        if (k.h > max) max = k.h;
      }
      const pad = (max - min) * 0.12 || 1;
      min -= pad;
      max += pad;

      const cw = w / (N - 8);
      const x0 = reduce ? 0 : -(acc / step) * cw;
      const Y = (v: number) => h - ((v - min) / (max - min)) * h * 0.82 - h * 0.09;

      ctx.clearRect(0, 0, w, h);

      // rejilla
      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      ctx.lineWidth = 1;
      for (let g = 0; g <= 6; g++) {
        const y = (h * g) / 6;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // EMA dorada
      const ema: number[] = [];
      let e = candles[0].c;
      const kf = 2 / (14 + 1);
      for (const k of candles) {
        e = k.c * kf + e * (1 - kf);
        ema.push(e);
      }

      // velas
      for (let i = 0; i < candles.length; i++) {
        const k = candles[i];
        const x = x0 + i * cw + cw / 2;
        const up = k.c >= k.o;
        const col = up ? "rgba(74,222,128,0.85)" : "rgba(248,113,113,0.8)";
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, Y(k.h));
        ctx.lineTo(x, Y(k.l));
        ctx.stroke();
        const bw = Math.max(cw * 0.62, 2);
        const yo = Y(k.o);
        const yc = Y(k.c);
        ctx.fillRect(x - bw / 2, Math.min(yo, yc), bw, Math.max(Math.abs(yc - yo), 1.5));
      }

      // línea EMA con glow
      ctx.shadowColor = "rgba(225,202,113,0.5)";
      ctx.shadowBlur = 8;
      ctx.strokeStyle = "rgba(225,202,113,0.75)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < ema.length; i++) {
        const x = x0 + i * cw + cw / 2;
        const y = Y(ema[i]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (!reduce) raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="login-bg" aria-hidden="true" />;
}
