"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  onRecorded: (blob: Blob) => void;
  disabled?: boolean;
}

export default function RecordButton({ onRecorded, disabled }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const cleanupLiveMonitor = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    return () => cleanupLiveMonitor();
  }, []);

  const drawLiveWave = (analyser: AnalyserNode) => {
    const bufferLen = analyser.fftSize;
    const data = new Uint8Array(bufferLen);

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      analyser.getByteTimeDomainData(data);
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      // เส้นกึ่งกลาง
      ctx.strokeStyle = "rgba(120, 113, 108, 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      // วาดคลื่นเสียงสด (Real-time Oscilloscope)
      ctx.strokeStyle = "#E06D65";
      ctx.lineWidth = 2;
      ctx.beginPath();

      const sliceWidth = width / bufferLen;
      let x = 0;
      for (let i = 0; i < bufferLen; i++) {
        const v = data[i] / 128.0;
        const y = (v * height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.stroke();

      animFrameRef.current = requestAnimationFrame(render);
    };
    render();
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];

      // เชื่อม Web Audio Analyser เพื่อวาดกราฟเส้นคลื่นสด
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        cleanupLiveMonitor();
        setRecording(false);
        setSeconds(0);
        onRecorded(blob);
      };

      recorder.start(100);
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      drawLiveWave(analyser);
    } catch (err) {
      console.error("Mic/Audio Interface Error:", err);
      alert("ไม่สามารถเข้าถึงไมโครโฟนหรือ Audio Interface ได้");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  return (
    <div className="flex items-center gap-2.5">
      {recording && (
        <div className="flex items-center gap-2 rounded-full border border-rose-300 bg-[#FFF5F5] px-3 py-1 shadow-xs">
          <span className="h-2 w-2 animate-ping rounded-full bg-rose-500" />
          <span className="font-mono text-[11px] font-bold text-rose-600">
            {String(Math.floor(seconds / 60)).padStart(2, "0")}:
            {String(seconds % 60).padStart(2, "0")}
          </span>
          <canvas
            ref={canvasRef}
            width={130}
            height={26}
            className="rounded bg-white/80 ring-1 ring-rose-200/70"
          />
        </div>
      )}

      <button
        type="button"
        onClick={recording ? stopRecording : startRecording}
        disabled={disabled}
        className={`rounded-full px-4 py-2 text-xs font-semibold transition disabled:opacity-40 ${
          recording
            ? "bg-[#E06D65] text-white shadow-sm hover:bg-[#c95b53]"
            : "bg-stone-200 text-stone-800 hover:bg-stone-300"
        }`}
      >
        {recording ? "■ หยุดอัดเสียง" : "● อัดเสียงสด"}
      </button>
    </div>
  );
}