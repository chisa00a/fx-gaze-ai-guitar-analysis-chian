export interface AudioFeatures {
  sample_rate: number;
  duration_seconds: number;
  zcr_mean: number;
  rms_mean: number;
  rms_peak: number;
  rt60_seconds: number | null;
  spectral_centroid_mean_hz: number;
  echo_similarity: number;
  crest_factor_db: number;
}

export interface AiVerdict {
  effect_type: string;
  parameters: Record<string, number | string>;
  description: string;
  advice: string;
  model_used?: string;
  source?: string;
  error?: string;
}

export interface AnalysisPayload {
  features?: { features: AudioFeatures; notes?: Record<string, unknown> };
  ai?: AiVerdict;
}

export interface AnalysisStatusResponse {
  task_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  result: AnalysisPayload | null;
}

// ในไฟล์ frontend/lib/types.ts

export interface EffectChainNode {
  effect_type: string;
  sub_type?: string;
  parameters: Record<string, string | number>;
}

export interface AiVerdict {
  effect_type: EffectKind | string;
  sub_type?: string;                           
  parameters: Record<string, string | number>; 
  effect_chain?: EffectChainNode[];            
  description: string;
  advice: string;
  model_used?: string;
  source?: string;
  error?: string;
}

export type EffectKind =
  | "reverb"
  | "delay"
  | "fuzz"
  | "distortion"
  | "overdrive"
  | "chorus"
  | "clean"
  | "silence";
