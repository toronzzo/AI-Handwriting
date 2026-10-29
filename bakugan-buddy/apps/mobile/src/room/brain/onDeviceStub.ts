import type { AdvisorInput, AdvisorSuggestion } from "../../../../../packages/alive/src/advisor.ts";

/** Expo Go and normal dev builds. The Mac brain is the path that works here. */
export const onDeviceBrainEnabled = false;

export async function adviseOnDevice(_input: AdvisorInput): Promise<AdvisorSuggestion | null> {
  return null;
}
