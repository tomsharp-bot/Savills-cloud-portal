import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export const ALLOWED_DOC_EXTS = ["xlsx", "xls", "doc", "docx", "pdf"] as const;

export function extOf(name: string): string {
  const m = String(name || "")
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function safeOriginalName(name: string): string {
  return String(name || "file")
    .replace(/[/\\]/g, "")
    .replace(/[^\w.\- ()]+/g, "_")
    .slice(0, 180);
}

export function projectUploadDir(projectId: string): string {
  return path.join(process.cwd(), config.uploadDir, "projects", projectId);
}

export async function saveProjectFile(projectId: string, storedName: string, buffer: Buffer): Promise<string> {
  const dir = projectUploadDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, storedName);
  await fs.writeFile(dest, buffer);
  return dest;
}

export function projectFilePath(projectId: string, storedName: string): string {
  const base = path.resolve(projectUploadDir(projectId));
  const dest = path.resolve(base, storedName);
  if (!dest.startsWith(base + path.sep) && dest !== base) {
    throw new Error("Invalid path");
  }
  return dest;
}

export async function removeProjectFile(projectId: string, storedName: string): Promise<void> {
  try {
    await fs.unlink(projectFilePath(projectId, storedName));
  } catch {
    // file already gone
  }
}

export function formatBytes(n: number): string {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

/** TODO: store and serve these from DigitalOcean Spaces bucket cloud-portal-vault (LON1). */
