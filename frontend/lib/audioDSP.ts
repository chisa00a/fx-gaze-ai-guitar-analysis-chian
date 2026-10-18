// frontend/lib/audioDSP.ts
import type { AiVerdict } from "./types";

/** สร้าง Impulse Response สำหรับจำลองหางเสียง Dream / Hall Reverb */
function createReverbImpulse(
  ctx: BaseAudioContext,
  decaySec: number,
  tonePct: number,
): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.max(Math.floor(sr * 0.2), Math.floor(sr * Math.min(6.0, decaySec)));
  const impulse = ctx.createBuffer(2, length, sr);
  const damping = 0.25 + (tonePct / 100) * 0.7;

  for (let ch = 0; ch < 2; ch++) {
    const channelData = impulse.getChannelData(ch);
    let lastSample = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Envelop แบบ Lush Cloud (มี Pre-swell เล็กน้อยแล้วค่อยๆ จางลง)
      const env = Math.pow(1 - t, 2.2);
      const white = Math.random() * 2 - 1;
      // One-pole lowpass ตามปุ่ม Tone
      lastSample = lastSample + damping * (white - lastSample);
      channelData[i] = lastSample * env * 0.6;
    }
  }
  return impulse;
}

/** สร้าง Curve สำหรับ Waveshaper (Overdrive / Distortion / Fuzz) */
function createDriveCurve(amountPct: number): Float32Array<ArrayBuffer> {
  const n = 8192;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = Math.max(0, amountPct) * 1.4;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = k === 0 ? x : ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

/** อ่านค่า Knob ปัจจุบันเทียบกับค่าเริ่มต้นเพื่อประมวลผลเสียงผ่าน Web Audio Graph */
export class LivePedalDSPPlayer {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private decodedBuffer: AudioBuffer | null = null;
  private lastBlob: Blob | null = null;

  // Nodes ที่ปรับค่าแบบ Real-time ได้ระหว่างที่เสียงกำลังเล่นอยู่
  private dryGain: GainNode | null = null;
  private wetReverbGain: GainNode | null = null;
  private delayTimeNode: DelayNode | null = null;
  private delayFeedbackGain: GainNode | null = null;
  private delayWetGain: GainNode | null = null;
  private toneFilter: BiquadFilterNode | null = null;
  private driveShaper: WaveShaperNode | null = null;
  private masterGain: GainNode | null = null;

  async playProcessed(
    blob: Blob,
    verdict: AiVerdict,
    knobState: Record<string, number>,
    selection: { start: number; end: number } | null,
    onEnded: () => void,
  ) {
    this.stop();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    this.ctx = ctx;

    if (this.lastBlob !== blob || !this.decodedBuffer) {
      const ab = await blob.arrayBuffer();
      this.decodedBuffer = await ctx.decodeAudioData(ab);
      this.lastBlob = blob;
    }

    const src = ctx.createBufferSource();
    src.buffer = this.decodedBuffer;
    this.source = src;

    // สร้าง Nodes สำหรับปรับแต่งโทนเสียง
    this.driveShaper = ctx.createWaveShaper();
    this.driveShaper.oversample = "2x";

    this.toneFilter = ctx.createBiquadFilter();
    this.toneFilter.type = "peaking";
    this.toneFilter.frequency.value = 1800;
    this.toneFilter.Q.value = 0.8;

    this.dryGain = ctx.createGain();
    this.wetReverbGain = ctx.createGain();
    const convolver = ctx.createConvolver();

    this.delayTimeNode = ctx.createDelay(1.5);
    this.delayFeedbackGain = ctx.createGain();
    this.delayWetGain = ctx.createGain();

    this.masterGain = ctx.createGain();

    // ตั้งค่าพารามิเตอร์เริ่มต้นจากปุ่มหมุน
    const params = this.extractMergedParams(verdict, knobState);
    convolver.buffer = createReverbImpulse(ctx, (params.decay / 100) * 4.8 + 0.4, params.tone);
    this.updateParametersRealtime(verdict, knobState);

    // ต่อวงจร: Source -> Drive -> Tone EQ -> (Dry + Delay + Reverb) -> Master -> Output
    src.connect(this.driveShaper);
    this.driveShaper.connect(this.toneFilter);

    // Dry path
    this.toneFilter.connect(this.dryGain);
    this.dryGain.connect(this.masterGain);

    // Delay path
    this.toneFilter.connect(this.delayTimeNode);
    this.delayTimeNode.connect(this.delayFeedbackGain);
    this.delayFeedbackGain.connect(this.delayTimeNode);
    this.delayTimeNode.connect(this.delayWetGain);
    this.delayWetGain.connect(this.masterGain);

    // Reverb path
    this.toneFilter.connect(convolver);
    convolver.connect(this.wetReverbGain);
    this.wetReverbGain.connect(this.masterGain);

    this.masterGain.connect(ctx.destination);

    src.onended = () => {
      onEnded();
    };

    const startOffset = selection ? Math.max(0, selection.start) : 0;
    const duration =
      selection && selection.end > selection.start
        ? selection.end - selection.start
        : undefined;

    src.start(0, startOffset, duration);
  }

  /** เรียกทุกครั้งที่ผู้ใช้หมุนปุ่ม Knob เพื่อให้เสียงเปลี่ยนทันทีขณะกำลังฟัง! */
  updateParametersRealtime(verdict: AiVerdict, knobState: Record<string, number>) {
    if (!this.ctx) return;
    const p = this.extractMergedParams(verdict, knobState);
    const now = this.ctx.currentTime;

    // 1. ปรับ Drive / Fuzz / Gain
    if (this.driveShaper) {
      // คำนวณส่วนต่างที่ผู้ใช้หมุนเพิ่มจากค่าเดิมของไฟล์
      const addedDrive = Math.max(0, p.drive - p.baseDrive * 0.7);
      this.driveShaper.curve = createDriveCurve(addedDrive);
    }

    // 2. ปรับ Tone EQ (-12dB ถึง +12dB ที่ย่านความคมชัด)
    if (this.toneFilter) {
      const dbBoost = ((p.tone - 50) / 50) * 12;
      this.toneFilter.gain.setTargetAtTime(dbBoost, now, 0.03);
    }

    // 3. ปรับ Reverb Mix & Decay
    if (this.wetReverbGain && this.dryGain) {
      const wetRatio = (p.reverbMix / 100) * 0.9;
      this.wetReverbGain.gain.setTargetAtTime(wetRatio, now, 0.03);
      this.dryGain.gain.setTargetAtTime(1.0 - wetRatio * 0.35, now, 0.03);
    }

    // 4. ปรับ Delay Time, Feedback, Mix
    if (this.delayTimeNode && this.delayFeedbackGain && this.delayWetGain) {
      const delaySec = Math.max(0.06, Math.min(0.95, (p.delayTime / 100) * 0.85));
      this.delayTimeNode.delayTime.setTargetAtTime(delaySec, now, 0.04);
      this.delayFeedbackGain.gain.setTargetAtTime(Math.min(0.82, (p.feedback / 100) * 0.8), now, 0.03);
      this.delayWetGain.gain.setTargetAtTime((p.delayMix / 100) * 0.65, now, 0.03);
    }

    // 5. ปรับ Master Level / Volume
    if (this.masterGain) {
      const vol = (p.level / 75) * 0.95;
      this.masterGain.gain.setTargetAtTime(Math.max(0.1, Math.min(1.6, vol)), now, 0.03);
    }
  }

  private extractMergedParams(verdict: AiVerdict, knobState: Record<string, number>) {
    const chain =
      verdict.effect_chain && verdict.effect_chain.length > 0
        ? verdict.effect_chain
        : [{ effect_type: verdict.effect_type, parameters: verdict.parameters ?? {} }];

    let drive = 0;
    let baseDrive = 0;
    let tone = 50;
    let level = 75;
    let reverbMix = 0;
    let decay = 50;
    let delayTime = 35;
    let feedback = 30;
    let delayMix = 0;

    chain.forEach((node, idx) => {
      const eff = (node.effect_type || "").toLowerCase();
      const raw = node.parameters ?? {};
      const getVal = (key: string, fallback: number) => {
        const stateKey = `${idx}:${key}`;
        if (knobState[stateKey] !== undefined) return knobState[stateKey];
        if (idx === 0 && knobState[key] !== undefined) return knobState[key];
        const v = Number(raw[key] ?? raw[key.toUpperCase()] ?? fallback);
        return Number.isFinite(v) ? (v > 100 ? Math.round(v / 10) : v) : fallback;
      };

      if (eff === "fuzz" || eff === "distortion" || eff === "overdrive") {
        const dKey = "fuzz" in raw ? "fuzz" : "gain" in raw ? "gain" : "drive";
        baseDrive = Number(raw[dKey] ?? 50);
        drive = getVal(dKey, baseDrive);
        tone = getVal("tone", tone);
        level = getVal("level" in raw ? "level" : "sustain", level);
      } else if (eff === "reverb") {
        decay = getVal("decay", 65);
        reverbMix = getVal("mix", 45);
        tone = getVal("tone", tone);
      } else if (eff === "delay") {
        delayTime = getVal("time", 40);
        feedback = getVal("feedback", 40);
        delayMix = getVal("mix", 40);
      } else {
        tone = getVal("tone", tone);
        level = getVal("level", level);
      }
    });

    return { drive, baseDrive, tone, level, reverbMix, decay, delayTime, feedback, delayMix };
  }

  stop() {
    try {
      this.source?.stop();
    } catch {}
    this.source = null;
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}