/**
 * The Yes/No card detail for browser_file_upload: every file's name, full
 * path and size, and the site the files are being uploaded to (the last page
 * the task opened with browser_navigate). Pure text; the card renders it as-is.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveSafePath } from "../safeFs.mjs";

/** "1.2 KB" style sizes, one decimal, smallest units first. */
export function formatBytes(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : Math.round(kb * 10) / 10} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  const gb = mb / 1024;
  return `${gb >= 100 ? Math.round(gb) : Math.round(gb * 10) / 10} GB`;
}

/** The URL of the page the task last opened; "" when it never navigated. */
export function lastNavigationUrl(task) {
  const steps = Array.isArray(task?.steps) ? task.steps : [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const tool = steps[index]?.tool;
    const url = tool?.args?.url;
    if (tool && tool.name === "browser_navigate" && typeof url === "string" && url.trim()) return url.trim();
  }
  return "";
}

/** One "- name — full path (size)" line per upload entry. */
function fileLines(paths, fsRoot, repoRoot) {
  const roots = [fsRoot, repoRoot].filter((root) => typeof root === "string" && root);
  return paths.map((target) => {
    let size = null;
    for (const root of roots) {
      try {
        const resolved = resolveSafePath(target, root);
        const stat = fs.statSync(resolved);
        if (stat.isFile()) {
          size = stat.size;
          break;
        }
      } catch {
        /* next root */
      }
    }
    return `- ${path.basename(target)} — ${target}${size === null ? "" : ` (${formatBytes(size)})`}`;
  });
}

/**
 * The upload card detail: "Uploading N files to <site>:" plus one line per
 * file with its name, full path and size. Files that cannot be resolved
 * still appear (without a size) so the card never hides an entry.
 */
export function uploadCardDetail(args, { fsRoot = "", repoRoot = "", task = null } = {}) {
  const paths = (Array.isArray(args?.paths) ? args.paths : []).filter((entry) => typeof entry === "string");
  if (paths.length === 0) return "";
  const site = lastNavigationUrl(task);
  const lines = [`Uploading ${paths.length} file${paths.length === 1 ? "" : "s"}${site ? ` to ${site}` : ""}:`];
  return lines.concat(fileLines(paths, fsRoot, repoRoot)).join("\n");
}
