"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer, { type WaveSurferOptions } from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";

interface Props {
  url: string;
  onSelectionChange: (sel: { start: number; end: number } | null) => void;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "00:00.0";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`;
}

export default function WaveformPlayer({ url, onSelectionChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeRegion, setActiveRegion] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#C5B4AE",
      progressColor: "#22A3B8",
      cursorColor: "#E06D65",
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1.5,
      barRadius: 2,
      height: 88,
      normalize: true,
      url,
    } as WaveSurferOptions);

    const regions = ws.registerPlugin(RegionsPlugin.create());
    wsRef.current = ws;
    regionsRef.current = regions;

    ws.on("ready", () => {
      if (cancelled) return;
      setReady(true);
      setDuration(ws.getDuration());
      regions.enableDragSelection({
        color: "rgba(34, 163, 184, 0.18)",
      });
    });

    ws.on("timeupdate", (t) => {
      if (!cancelled) setCurrentTime(t);
    });
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => setPlaying(false));

    const syncRegion = (region: { id: string; start: number; end: number }) => {
      regions.getRegions().forEach((r) => {
        if (r.id !== region.id) r.remove();
      });
      const sel = { start: region.start, end: region.end };
      setActiveRegion(sel);
      onSelectionChange(sel);
    };

    regions.on("region-created", syncRegion);
    regions.on("region-updated", syncRegion);
    regions.on("region-clicked", (region, e) => {
      e.stopPropagation();
      region.play();
    });

    return () => {
      cancelled = true;
      ws.destroy();
      wsRef.current = null;
      regionsRef.current = null;
      setReady(false);
      setPlaying(false);
      setCurrentTime(0);
      setActiveRegion(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const clearSelection = () => {
    regionsRef.current?.getRegions().forEach((r) => r.remove());
    setActiveRegion(null);
    onSelectionChange(null);
  };

  return (
    <div className="w-full space-y-2.5">
      <div className="rounded-2xl bg-[#FAF4F2] p-3 ring-1 ring-stone-200/80">
        <div className="mb-1.5 flex items-center justify-between font-mono text-[11px] text-stone-500">
          <span>
            <b className="text-stone-800">{formatTime(currentTime)}</b> / {formatTime(duration)}
          </span>
          {activeRegion ? (
            <span className="rounded-full bg-[#22A3B8]/15 px-2.5 py-0.5 font-semibold text-[#177080]">
              {activeRegion.start.toFixed(1)}s – {activeRegion.end.toFixed(1)}s
            </span>
          ) : (
            <span>ลากคลุมบนกราฟเพื่อตัดช่วง</span>
          )}
        </div>
        <div ref={containerRef} className="min-h-[88px] cursor-crosshair" />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => wsRef.current?.playPause()}
          disabled={!ready}
          className="rounded-full bg-stone-800 px-4 py-1.5 font-semibold text-white transition hover:bg-stone-700 disabled:opacity-40"
        >
          {playing ? "พัก" : "เล่นเสียง"}
        </button>
        {activeRegion && (
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-full bg-stone-200 px-3.5 py-1.5 font-medium text-stone-700 transition hover:bg-stone-300"
          >
            ล้างช่วงที่เลือก
          </button>
        )}
      </div>
    </div>
  );
}