import type { AnalysisStatusResponse } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function submitAnalysis(
  blob: Blob,
  filename: string,
  crop?: { start: number; end: number } | null,
): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, filename);
  if (crop) {
    form.append("start", String(crop.start));
    form.append("end", String(crop.end));
  }
  const res = await fetch(`${API_URL}/api/analyze-tone`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `upload failed (${res.status})`);
  }
  const { task_id } = (await res.json()) as { task_id: string };
  return task_id;
}

export async function pollStatus(taskId: string): Promise<AnalysisStatusResponse> {
  const res = await fetch(`${API_URL}/api/analyze-tone/${taskId}`);
  if (!res.ok) throw new Error(`status check failed (${res.status})`);
  return (await res.json()) as AnalysisStatusResponse;
}

export { API_URL };
