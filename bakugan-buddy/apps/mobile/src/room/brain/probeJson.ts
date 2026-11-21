/**
 * One place that turns a Settings probe's `Response` into either its JSON body
 * or an honest reason. The wording itself lives in settings/probe.ts.
 */
import { probeBodyError, probeResponseError } from "../../settings/probe.ts";

export type ProbeRead<T> = { ok: true; body: T } | { ok: false; error: string };

export async function readProbe<T>(subject: string, res: Response): Promise<ProbeRead<T>> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: probeBodyError(subject, res.status) };
  }
  if (!res.ok) return { ok: false, error: probeResponseError(subject, res.status, body) };
  return { ok: true, body: body as T };
}
