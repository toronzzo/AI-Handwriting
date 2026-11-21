/**
 * The Brain view's small RAM readout.
 *
 * /v1/power/status is the same controller snapshot Settings > Power uses:
 * one row per service with a real resident-memory figure. This module only
 * turns those rows into the map's compact labels; it never guesses a value
 * for a service that is stopped or absent.
 */
import {
  POWER_SERVICE_LABELS,
  POWER_SERVICE_ORDER,
  ramLabel,
  type PowerStatus,
} from "../settings/power.ts";

export type RamRow = {
  name: string;
  label: string;
  value: string;
  running: boolean;
};

/** One row per service the controller reported, in the Settings order. */
export function ramRows(status: PowerStatus | null): RamRow[] {
  if (!status) return [];
  return [...status.services]
    .sort((left, right) => {
      const a = POWER_SERVICE_ORDER.indexOf(left.name);
      const b = POWER_SERVICE_ORDER.indexOf(right.name);
      return (a < 0 ? 99 : a) - (b < 0 ? 99 : b);
    })
    .map((service) => ({
      name: service.name,
      label: POWER_SERVICE_LABELS[service.name] || service.label,
      value: !service.running
        ? service.available === false
          ? "not set up"
          : "stopped"
        : ramLabel(service.ramMb),
      running: service.running,
    }));
}

/** "checked 21:40", or empty when the Mac has not answered yet. */
export function ramCheckedLine(status: PowerStatus | null): string {
  if (!status?.checkedAt) return "";
  const date = new Date(status.checkedAt);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `checked ${hours}:${minutes}`;
}
