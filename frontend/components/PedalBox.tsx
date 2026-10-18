"use client";

import React, { useState } from "react";
import Knob from "./Knob";
import type { AiVerdict, EffectKind } from "@/lib/types";

interface PedalTheme {
  title: string;
  bg: string; // สีตัวถัง Matte Pastel
  baseShadow: string; // ขอบฐานด้านล่าง
  accent: string;
}

// โทนสี Matte Pastel 50/50 สไตล์เดียวกับรูป Reference
const THEMES: Record<EffectKind, PedalTheme> = {
  chorus: {
    title: "The 80s",
    bg: "bg-[#7599B2]", // Pastel Dusty Blue
    baseShadow: "border-b-[8px] border-[#4A6477]",
    accent: "#ffffff",
  },
  delay: {
    title: "Delay-y-y",
    bg: "bg-[#4CAF58]", // Matte Pastel Green
    baseShadow: "border-b-[8px] border-[#33783B]",
    accent: "#ffffff",
  },
  reverb: {
    title: "The Wash",
    bg: "bg-[#22A3B8]", // Pastel Teal / Cyan
    baseShadow: "border-b-[8px] border-[#177080]",
    accent: "#ffffff",
  },
  fuzz: {
    title: "Velvet Fuzz",
    bg: "bg-[#9B7EDE]", // Pastel Lavender Purple
    baseShadow: "border-b-[8px] border-[#6A52A3]",
    accent: "#ffffff",
  },
  distortion: {
    title: "Iron Drive",
    bg: "bg-[#E06D65]", // Matte Coral Terracotta
    baseShadow: "border-b-[8px] border-[#A34842]",
    accent: "#ffffff",
  },
  overdrive: {
    title: "Warm Tube",
    bg: "bg-[#E6A15C]", // Pastel Ochre / Honey
    baseShadow: "border-b-[8px] border-[#A87038]",
    accent: "#ffffff",
  },
  clean: {
    title: "Pure Boost",
    bg: "bg-[#8FA69E]", // Pastel Sage Grey
    baseShadow: "border-b-[8px] border-[#5E706A]",
    accent: "#ffffff",
  },
  silence: {
    title: "Standby",
    bg: "bg-[#B8B2AE]",
    baseShadow: "border-b-[8px] border-[#857F7B]",
    accent: "#ffffff",
  },
};

interface KnobSpec {
  label: string;
  maxDisplay?: number;
  unit?: string;
}

const KNOB_LABELS: Record<string, KnobSpec> = {
  decay: { label: "Decay" },
  time: { label: "Time", maxDisplay: 1000, unit: "ms" },
  delay: { label: "Time", maxDisplay: 1000, unit: "ms" },
  mix: { label: "Mix" },
  blend: { label: "Blend" },
  drive: { label: "Drive" },
  fuzz: { label: "Fuzz" },
  sustain: { label: "Sustain" },
  gain: { label: "Gain" },
  level: { label: "Level" },
  volume: { label: "Volume" },
  tone: { label: "Tone" },
  feedback: { label: "Feedback" },
  repeats: { label: "Repeats" },
  threshold: { label: "Thresh" },
};

function normalize(value: number | string): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (Number.isNaN(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n > 100 ? n / 10 : n)));
}

/** ไอคอน Minimal Line-art กลางก้อนตามสไตล์รูป Reference */
function MinimalEmblem({ kind }: { kind: EffectKind }) {
  switch (kind) {
    case "reverb":
      // คลื่น Sine + เส้นสะท้อน (แบบก้อน The Wash ขวาสุดในรูป)
      return (
        <svg viewBox="0 0 120 55" className="h-12 w-28 stroke-white" fill="none">
          <path
            d="M25 38 C32 8, 42 8, 48 28 C54 48, 64 48, 72 20 C78 6, 86 12, 92 38"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="M29 42 C36 12, 46 12, 52 32 C58 52, 68 52, 76 24 C82 10, 90 16, 96 42"
            strokeWidth="1.2"
            strokeOpacity="0.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case "delay":
      // สัญลักษณ์ Infinity ∞ (แบบก้อน Delay-y-y กลางรูป)
      return (
        <svg viewBox="0 0 120 50" className="h-11 w-28 stroke-white" fill="none">
          <path
            d="M42 25 C30 12, 16 14, 16 25 C16 36, 30 38, 42 25 L78 25 C90 12, 104 14, 104 25 C104 36, 90 38, 78 25 Z"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      );
    case "fuzz":
    case "distortion":
      // คลื่นหยัก Square/Sawtooth มินิมอล
      return (
        <svg viewBox="0 0 120 50" className="h-11 w-28 stroke-white" fill="none">
          <path
            d="M18 32 L30 32 L30 14 L50 14 L50 36 L70 36 L70 14 L90 14 L90 32 L102 32"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "overdrive":
    case "chorus":
    default:
      // โค้งสปริง Slinky (แบบก้อน The 80s ซ้ายสุดในรูป)
      return (
        <svg viewBox="0 0 120 55" className="h-12 w-28 stroke-white" fill="none">
          {[-30, -20, -10, 0, 10, 20, 30].map((offset, i) => (
            <ellipse
              key={i}
              cx={60 + offset * 0.8}
              cy={34 - Math.cos((offset / 35) * (Math.PI / 2)) * 12}
              rx="10"
              ry="16"
              transform={`rotate(${offset * 1.8} ${60 + offset * 0.8} 34)`}
              strokeWidth="1.6"
              strokeOpacity="0.9"
            />
          ))}
        </svg>
      );
  }
}

interface Props {
  verdict: AiVerdict;
  onKnobChange?: (name: string, value: number) => void;
  knobState?: Record<string, number>;
}

export default function PedalBox({ verdict, onKnobChange, knobState }: Props) {
  const chain =
    verdict.effect_chain && verdict.effect_chain.length > 0
      ? verdict.effect_chain
      : [
          {
            effect_type: verdict.effect_type,
            sub_type: verdict.sub_type || verdict.effect_type,
            parameters: verdict.parameters ?? {},
          },
        ];

  const [bypassed, setBypassed] = useState<Record<number, boolean>>({});

  return (
    <div className="flex w-full flex-col items-center gap-6">
      {/* แถบผังลำดับการต่อสาย Signal Flow จากหน้าไปหลัง */}
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-full bg-white/80 px-5 py-2 text-xs font-medium text-stone-600 shadow-sm ring-1 ring-stone-200/80">
        <span className="font-bold text-stone-800">🎸 GUITAR IN</span>
        {chain.map((node, idx) => (
          <React.Fragment key={idx}>
            <span className="text-stone-400">➔</span>
            <span className="rounded-full bg-stone-100 px-3 py-0.5 font-semibold text-stone-800 ring-1 ring-stone-300/70">
              #{idx + 1} {node.effect_type.toUpperCase()}
              {node.sub_type ? ` · ${node.sub_type}` : ""}
            </span>
          </React.Fragment>
        ))}
        <span className="text-stone-400">➔</span>
        <span className="font-bold text-stone-800">🔊 AMP OUT</span>
      </div>

      {/* บอร์ดก้อนเอฟเฟกต์เรียงต่อกันทุกก้อนตามลำดับ Signal Chain */}
      <div className="flex flex-wrap items-center justify-center gap-y-8">
        {chain.map((node, idx) => {
          const kind = ((node.effect_type || "clean").toLowerCase() as EffectKind) in THEMES
            ? ((node.effect_type || "clean").toLowerCase() as EffectKind)
            : "clean";
          const theme = THEMES[kind];
          const isOff = !!bypassed[idx];

          const entries = Object.entries(node.parameters ?? {}).filter(
            ([k]) => KNOB_LABELS[k.toLowerCase()] !== undefined,
          );

          return (
            <div key={`${node.effect_type}-${idx}`} className="flex items-center">
              {/* หัวแจ็คด้านซ้าย (กรณีเป็นก้อนแรกสุด) */}
              {idx === 0 && (
                <div className="flex items-center">
                  <div className="h-2 w-4 rounded-l bg-stone-700" />
                  <div className="h-9 w-3 rounded-l-sm bg-stone-800" />
                </div>
              )}

              {/* ตัวก้อน Stompbox สไตล์ Matte Pastel */}
              <div
                className={`relative flex w-[235px] flex-col justify-between rounded-[22px] ${theme.bg} ${theme.baseShadow} p-5 text-white shadow-[0_18px_35px_-12px_rgba(60,40,35,0.28)] ring-1 ring-white/25 transition-transform duration-200 hover:-translate-y-0.5`}
              >
                {/* ป้ายลำดับ Chain มุมบน */}
                <div className="mb-2 flex items-center justify-between">
                  <span className="rounded-full bg-black/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">
                    STAGE 0{idx + 1} · {node.effect_type}
                  </span>
                  {/* ไฟสถานะ LED สีขาวนวลแบบรูปตัวอย่าง */}
                  <span
                    className={`h-2.5 w-2.5 rounded-full transition ${
                      isOff
                        ? "bg-black/30"
                        : "bg-white shadow-[0_0_10px_2px_rgba(255,255,255,0.9)]"
                    }`}
                  />
                </div>

                {/* แผงปุ่มหมุน (Knobs) */}
                <div className="my-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                  {entries.map(([key, raw]) => {
                    const spec = KNOB_LABELS[key.toLowerCase()];
                    const stateKey = `${idx}:${key}`;
                    const value =
                      knobState?.[stateKey] ??
                      (idx === 0 ? knobState?.[key] : undefined) ??
                      normalize(raw);

                    return (
                      <Knob
                        key={stateKey}
                        label={spec.label}
                        unit={spec.unit}
                        maxDisplay={spec.maxDisplay}
                        value={value}
                        accent={theme.accent}
                        onChange={(v) => onKnobChange?.(stateKey, v)}
                      />
                    );
                  })}
                </div>

                {/* ลวดลาย Minimal Line Art ตรงกลางก้อน */}
                <div className="my-2 flex flex-col items-center justify-center">
                  <MinimalEmblem kind={kind} />
                  <span className="mt-0.5 text-center text-[11px] font-semibold tracking-wide text-white/95">
                    {node.sub_type || theme.title}
                  </span>
                </div>

                {/* ส่วนล่าง: ชื่อรุ่น + Footswitch โลหะ */}
                <div className="mt-2 flex items-end justify-between pt-1">
                  <div className="leading-tight">
                    <div className="text-xs font-extrabold tracking-tight text-white">
                      {theme.title}
                    </div>
                    <div className="text-[9px] uppercase tracking-widest text-white/70">
                      {node.effect_type}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setBypassed((p) => ({ ...p, [idx]: !p[idx] }))}
                    title="Toggle Engage / Bypass"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-b from-stone-200 to-stone-400 shadow-md ring-2 ring-black/25 active:scale-95"
                  >
                    <span className="h-6 w-6 rounded-full bg-gradient-to-tr from-stone-300 to-white shadow-inner ring-1 ring-stone-500/40" />
                  </button>

                  <div className="text-right text-[8px] font-bold uppercase tracking-widest text-white/70">
                    9VDC
                  </div>
                </div>
              </div>

              {/* สายพ่วง (Patch Cable) เชื่อมระหว่างก้อนที่ 1 -> 2 -> 3 */}
              {idx < chain.length - 1 ? (
                <div className="flex items-center">
                  <div className="h-9 w-2.5 bg-stone-800" />
                  <div className="flex h-3 w-8 items-center justify-center bg-stone-700 text-[9px] font-bold text-white">
                    ➔
                  </div>
                  <div className="h-9 w-2.5 bg-stone-800" />
                </div>
              ) : (
                <div className="flex items-center">
                  <div className="h-9 w-3 rounded-r-sm bg-stone-800" />
                  <div className="h-2 w-4 rounded-r bg-stone-700" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}