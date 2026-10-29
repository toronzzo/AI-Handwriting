declare module "bakugan-on-device-brain" {
  import type { AdvisorInput, AdvisorSuggestion } from "../../../../../packages/alive/src/advisor.ts";
  export const onDeviceBrainEnabled: boolean;
  export function adviseOnDevice(input: AdvisorInput): Promise<AdvisorSuggestion | null>;
}
