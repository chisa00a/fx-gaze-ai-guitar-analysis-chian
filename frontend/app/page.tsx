"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import WaveformPlayer from "@/components/WaveformPlayer";
import RecordButton from "@/components/RecordButton";
import PedalBox from "@/components/PedalBox";
import { submitAnalysis, pollStatus } from "@/lib/api";
import { LivePedalDSPPlayer } from "@/lib/audioDSP";
import type { AnalysisPayload, AudioFeatures } from "@/lib/types";

type Stage = "idle" | "queued" | "processing" | "completed" | "failed";

async function convertBlobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const numOfChan = 1;
    const sampleRate = audioBuffer.sampleRate;
    const samples = audioBuffer.getChannelData(0);
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numOfChan, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numOfChan * 2, true);
    view.setUint16(32, numOfChan * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    await audioCtx.close();
  }
}

function formatErrorMessage(raw: unknown): string {
  if (!raw) return "การวิเคราะห์ล้มเหลว";
  if (typeof raw === "string") return raw;
  if (raw instanceof Error) return raw.message;
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.error === "string") return obj.error;
    if (typeof obj.detail === "string") return obj.detail;
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(obj);
    } catch {
      return "เกิดข้อผิดพลาดในการประมวลผลไฟล์เสียง";
    }
  }
  return String(raw);
}

export default function Home() {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobName, setBlobName] = useState("clip.wav");
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [payload, setPayload] = useState<AnalysisPayload | null>(null);
  const [knobState, setKnobState] = useState<Record<string, number>>({});
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dspPlayerRef = useRef<LivePedalDSPPlayer | null>(null);

  useEffect(() => {
    dspPlayerRef.current = new LivePedalDSPPlayer();
    return () => dspPlayerRef.current?.stop();
  }, []);

  const loadBlob = useCallback(
    (b: Blob, name: string) => {
      dspPlayerRef.current?.stop();
      setPreviewPlaying(false);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBlob(b);
      setBlobName(name);
      setObjectUrl(URL.createObjectURL(b));
      setStage("idle");
      setPayload(null);
      setKnobState({});
      setError(null);
      setSelection(null);
    },
    [objectUrl],
  );

  const handleRecorded = useCallback(
    async (recordedBlob: Blob) => {
      try {
        const wavBlob = await convertBlobToWav(recordedBlob);
        loadBlob(wavBlob, "live_take.wav");
      } catch {
        loadBlob(recordedBlob, "live_take.webm");
      }
    },
    [loadBlob],
  );

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    loadBlob(f, f.name);
    e.target.value = "";
  };

  const analyze = async () => {
    if (!blob) return;
    dspPlayerRef.current?.stop();
    setPreviewPlaying(false);
    setError(null);
    setStage("queued");
    setPayload(null);
    try {
      const taskId = await submitAnalysis(blob, blobName, selection);
      const poll = async () => {
        try {
          const status = await pollStatus(taskId);
          if (status.status === "completed" || status.status === "failed") {
            setStage(status.status);
            setPayload(status.result);
            if (status.status === "failed") {
              setError(
                formatErrorMessage(
                  (status as unknown as Record<string, unknown>).error ?? status.result,
                ),
              );
            }
            return;
          }
          setStage(status.status === "processing" ? "processing" : "queued");
          pollTimer.current = setTimeout(poll, 1200);
        } catch (err) {
          setStage("failed");
          setError(formatErrorMessage(err));
        }
      };
      poll();
    } catch (err) {
      setStage("failed");
      setError(formatErrorMessage(err));
    }
  };

  const verdict = payload?.ai;
  const features = payload?.features?.features;
  const isBusy = stage === "queued" || stage === "processing";

  // อัปเดตเสียง DSP แบบเรียลไทม์ทันทีที่ผู้ใช้หมุนปุ่ม Knob
  const handleKnobChange = (name: string, val: number) => {
    setKnobState((prev) => {
      const next = { ...prev, [name]: val };
      if (verdict && previewPlaying) {
        dspPlayerRef.current?.updateParametersRealtime(verdict, next);
      }
      return next;
    });
  };

  const toggleDspPreview = async () => {
    if (!blob || !verdict || !dspPlayerRef.current) return;
    if (previewPlaying) {
      dspPlayerRef.current.stop();
      setPreviewPlaying(false);
    } else {
      setPreviewPlaying(true);
      await dspPlayerRef.current.playProcessed(
        blob,
        verdict,
        knobState,
        selection,
        () => setPreviewPlaying(false),
      );
    }
  };

  return (
    <div className="min-h-screen bg-[#F6EAE6] text-stone-800 selection:bg-[#22A3B8]/20">
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8">
        {/* ---------------- MINIMAL TOP BAR ---------------- */}
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[#FDF9F7] px-6 py-4 shadow-sm ring-1 ring-stone-200/80">
          <div className="flex items-center gap-3">
            <span className="text-lg font-black tracking-tight text-stone-900">FxGaze</span>
            <span className="h-4 w-px bg-stone-300" />
            <span className="text-xs font-medium text-stone-500">
              AI Guitar Signal Chain
            </span>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white px-4 py-1.5 text-xs font-semibold text-stone-700 shadow-2xs">
            {verdict
              ? `* ${verdict.sub_type || verdict.effect_type.toUpperCase()}`
              : `* ${blob ? blobName : "Select Audio Input"}`}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="rounded-full bg-stone-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-stone-700 disabled:opacity-40"
            >
              อัปโหลดไฟล์
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".wav,.mp3,.webm,.flac,.ogg,.m4a,audio/*"
              className="hidden"
              onChange={onFilePick}
            />
            <RecordButton onRecorded={handleRecorded} disabled={isBusy} />
          </div>
        </header>

        {/* ---------------- WAVEFORM & ANALYZE BAR ---------------- */}
        {objectUrl && (
          <section className="rounded-2xl bg-[#FDF9F7] p-5 shadow-sm ring-1 ring-stone-200/80">
            <WaveformPlayer url={objectUrl} onSelectionChange={setSelection} />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200/70 pt-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={analyze}
                  disabled={isBusy}
                  className="rounded-full bg-[#22A3B8] px-6 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#1B899B] disabled:opacity-40"
                >
                  {isBusy ? "กำลังวิเคราะห์..." : "วิเคราะห์ Signal Chain"}
                </button>

                {verdict && stage === "completed" && (
                  <button
                    type="button"
                    onClick={toggleDspPreview}
                    className={`rounded-full px-5 py-2 text-xs font-bold transition ${
                      previewPlaying
                        ? "bg-[#E06D65] text-white shadow-sm"
                        : "bg-stone-900 text-white hover:bg-stone-700"
                    }`}
                  >
                    {previewPlaying
                      ? "⏹ หยุดฟังเสียงที่ปรับ"
                      : "🔊 ฟังเสียงที่ปรับ Knob (DSP Preview)"}
                  </button>
                )}

                {Object.keys(knobState).length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setKnobState({});
                      if (verdict && previewPlaying) {
                        dspPlayerRef.current?.updateParametersRealtime(verdict, {});
                      }
                    }}
                    className="rounded-full bg-stone-200 px-3.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-300"
                  >
                    รีเซ็ตค่าปุ่ม
                  </button>
                )}
              </div>

              {features && <CompactTelemetry features={features} />}
            </div>

            {error && (
              <p className="mt-3 rounded-xl bg-rose-100 px-4 py-2 text-xs font-medium text-rose-700">
                {error}
              </p>
            )}
          </section>
        )}

        {/* ---------------- PEDALBOARD STAGE ---------------- */}
        {verdict && stage === "completed" && (
          <section className="flex flex-col items-center gap-6 rounded-3xl bg-[#FDF9F7]/70 px-4 py-8 ring-1 ring-stone-200/70">
            <PedalBox
              verdict={verdict}
              knobState={knobState}
              onKnobChange={handleKnobChange}
            />

            <div className="grid w-full max-w-4xl grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-2xl bg-white/90 p-4 ring-1 ring-stone-200/80">
                <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
                  SIGNAL CHAIN &amp; PARAMETERS
                </div>
                <p className="mt-1 text-xs leading-relaxed text-stone-700">
                  {verdict.description}
                </p>
              </div>
              <div className="rounded-2xl bg-white/90 p-4 ring-1 ring-stone-200/80">
                <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
                  TONE ADVICE
                </div>
                <p className="mt-1 text-xs leading-relaxed text-stone-700">
                  {verdict.advice}
                </p>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function CompactTelemetry({ features }: { features: AudioFeatures }) {
  const items = [
    ["ZCR", features.zcr_mean?.toFixed(3) ?? "—"],
    ["RT60", features.rt60_seconds ? `${features.rt60_seconds.toFixed(2)}s` : "Dry"],
    ["Echo", features.echo_similarity?.toFixed(2) ?? "—"],
    ["Centroid", features.spectral_centroid_mean_hz ? `${Math.round(features.spectral_centroid_mean_hz)}Hz` : "—"],
    ["Crest", features.crest_factor_db ? `${features.crest_factor_db.toFixed(1)}dB` : "—"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-stone-500">
      {items.map(([k, v]) => (
        <span key={k} className="rounded-md bg-stone-100 px-2 py-0.5 font-mono">
          <b className="text-stone-700">{k}:</b> {v}
        </span>
      ))}
    </div>
  );
}