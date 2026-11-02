/**
 * Confirm cards for anything risky or paid. The card is pure data: the caller
 * renders Yes/No and nothing happens until Yes is tapped.
 */

export type ConfirmAction =
  | { kind: "delete_notes"; count: number }
  | { kind: "paid"; costUsd?: number; promptChars?: number };

export type ConfirmCard = {
  kind: ConfirmAction["kind"];
  title: string;
  body: string;
  yes: string;
  no: string;
  danger: boolean;
};

/** DeepSeek flash off-peak: $0.15 per 1M input, $0.60 per 1M output. */
export function estimatePaidCostUsd(promptChars = 0, maxTokens = 2048): number {
  const promptTokens = Math.ceil(Math.max(0, promptChars) / 4);
  return (promptTokens * 0.15 + Math.max(0, maxTokens) * 0.6) / 1_000_000;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.001";
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(3)}`;
}

export function confirmFor(action: ConfirmAction): ConfirmCard {
  if (action.kind === "paid") {
    const cost = action.costUsd ?? estimatePaidCostUsd(action.promptChars ?? 0);
    return {
      kind: "paid",
      title: "Ask DeepSeek for this?",
      body: `About ${formatUsd(cost)}. Your notes and the local model stay free.`,
      yes: "Yes",
      no: "No",
      danger: false,
    };
  }
  const count = Math.max(1, Math.floor(action.count));
  return {
    kind: "delete_notes",
    title: `Delete ${count} note${count === 1 ? "" : "s"}?`,
    body: "This cannot be undone.",
    yes: "Yes",
    no: "No",
    danger: true,
  };
}
