"use client";

import { useCallback, useRef, useState } from "react";

interface Props {
  label: string;
  value: number; // 0..100
  unit?: string;
  maxDisplay?: number;
  onChange: (v: number) => void;
  accent?: string;
  variant?: "pedal" | "strip";
}

const SIZE = 66;
const SWEEP = 270;
const DOTS = 11;

export default function Knob({
  label,
  value,
  unit = "",
  maxDisplay,
  onChange,
  accent = "#ffffff",
  variant = "pedal",
}: Props) {
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ y: 0, value: 0 });

  const clamp = useCallback((v: number) => Math.max(0, Math.min(100, Math.round(v))), []);

  const display =
    maxDisplay !== undefined
      ? `${Math.round((value / 100) * maxDisplay)}${unit ? ` ${unit}` : ""}`
      : `${value}${unit ? unit : "%"}`;

  const angle = -135 + (value / 100) * SWEEP;
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragStart.current = { y: e.clientY, value };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const delta = dragStart.current.y - e.clientY;
    onChange(clamp(dragStart.current.value + delta * 0.65));
  };

  const onPointerUp = () => setDragging(false);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    onChange(clamp(value + (e.deltaY < 0 ? 2 : -2)));
  };

  return (
    <div className="flex select-none flex-col items-center gap-0.5">
      {/* ชื่อปุ่มด้านบนสไตล์插件 Neural DSP */}
      <span
        className={`text-[10px] font-semibold tracking-wider ${
          variant === "strip" ? "uppercase text-stone-500" : "text-white/95"
        }`}
      >
        {label}
      </span>

      <svg
        width={SIZE}
        height={SIZE}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={() => onChange(50)}
        className={dragging ? "cursor-grabbing" : "cursor-grab"}
        role="slider"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/* จุดสเกลรอบปุ่ม (Minimal Scale Dots) */}
        {Array.from({ length: DOTS }).map((_, idx) => {
          const a = -135 + (idx / (DOTS - 1)) * SWEEP;
          const rad = ((a - 90) * Math.PI) / 180;
          const r = SIZE / 2 - 4;
          const x = cx + r * Math.cos(rad);
          const y = cy + r * Math.sin(rad);
          const active = a <= angle + 1;
          return (
            <circle
              key={idx}
              cx={x}
              cy={y}
              r={idx % 5 === 0 ? 1.7 : 1.2}
              fill={
                variant === "strip"
                  ? active
                    ? "#d97757"
                    : "#e7d8d2"
                  : active
                    ? "#ffffff"
                    : "rgba(255,255,255,0.35)"
              }
            />
          );
        })}

        {/* ตัวปุ่มหมุน (Flat Matte Cap) */}
        <circle
          cx={cx}
          cy={cy}
          r={SIZE / 2 - 11}
          fill={variant === "strip" ? "#fffaf8" : "#232326"}
          stroke={variant === "strip" ? "#e5d4ce" : "rgba(0,0,0,0.45)"}
          strokeWidth={2}
        />

        {/* ฝาด้านในสีอ่อนลงเล็กน้อย */}
        <circle
          cx={cx}
          cy={cy}
          r={SIZE / 2 - 16}
          fill={variant === "strip" ? "#ffffff" : "#2f3035"}
        />

        {/* เข็มชี้ค่า (Clean Line Indicator) */}
        <g transform={`rotate(${angle} ${cx} ${cy})`}>
          <line
            x1={cx}
            y1={cy - 3}
            x2={cx}
            y2={13}
            stroke={variant === "strip" ? "#292524" : accent}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </g>
      </svg>

      {/* ค่าตัวเลขด้านล่าง */}
      <span
        className={`font-mono text-[10px] font-medium ${
          variant === "strip" ? "text-stone-600" : "text-white/90"
        }`}
      >
        {display}
      </span>
    </div>
  );
}