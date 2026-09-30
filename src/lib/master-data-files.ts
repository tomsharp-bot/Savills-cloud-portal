import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { prisma } from "./prisma.js";

/** Macro-enabled workbook. Download serves these bytes unchanged. */
export const MASTER_DATA_MIME = "application/vnd.ms-excel.sheet.macroEnabled.12";

/** Large enough for a master with Vision raw rows and the VBA project. */
export const MASTER_DATA_MAX_BYTES = 150 * 1024 * 1024;

/**
 * Same safe-name rule as the Data Review practice page (`safeName`).
 * The live file is "{Project name}-Master Data File-V1.xlsm", then V2, V3.
 */
export function safeMasterProjectName(projectName: string): string {
  return String(projectName || "Project").replace(/[\\/:*?"<>|]+/g, "-").trim() || "Project";
}

export function masterDataFileName(projectName: string, version: number): string {
  return `${safeMasterProjectName(projectName)}-Master Data File-V${version}.xlsm`;
}

export function parseMasterDataFileName(name: string): { projectKey: string; version: number } | null {
  const base = String(name || "").split(/[/\\]/).pop() || "";
  const match = /^(.*)-Master Data File-V(\d+)\.xlsm$/i.exec(base);
  if (!match) return null;
  const projectKey = match[1].trim();
  const version = Number(match[2]);
  if (!projectKey || !Number.isInteger(version) || version < 1) return null;
  return { projectKey, version };
}

export function isLiveMaster(file: { current: boolean; archivedAt: Date | null }): boolean {
  return file.current && file.archivedAt == null;
}

export function masterContentDisposition(filename: string): string {
  const ascii = filename.replace(/[\r\n"]/g, "").replace(/[^\x20-\x7E]/g, "_") || "master.xlsm";
  return `attachment; filename="${ascii}"`;
}

export function masterDataDir(): string {
  return path.join(process.cwd(), config.uploadDir, "master-data");
}

export function masterStoredPath(storedName: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(storedName)) {
    throw new Error("Invalid stored name");
  }
  const base = path.resolve(masterDataDir());
  const dest = path.resolve(base, storedName);
  if (dest !== base && !dest.startsWith(base + path.sep)) {
    throw new Error("Invalid path");
  }
  return dest;
}

export type LiveMasterRow = {
  id: string;
  name: string;
  version: number;
  size: number;
  projectName: string;
};

export async function listLiveMasterDataFiles(): Promise<LiveMasterRow[]> {
  const rows = await prisma.masterDataFile.findMany({
    where: { current: true, archivedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      version: true,
      size: true,
      project: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    size: row.size,
    projectName: row.project.name,
  }));
}

async function projectForMasterName(fileName: string): Promise<{ id: string; name: string; version: number } | null> {
  const parsed = parseMasterDataFileName(fileName);
  if (!parsed) return null;
  const projects = await prisma.project.findMany({ select: { id: true, name: true } });
  const want = parsed.projectKey.toLowerCase();
  const matches = projects.filter((project) => safeMasterProjectName(project.name).toLowerCase() === want);
  if (matches.length !== 1) return null;
  return { id: matches[0].id, name: matches[0].name, version: parsed.version };
}

async function writeStoredBytes(storedName: string, bytes: Buffer): Promise<void> {
  const dest = masterStoredPath(storedName);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const temp = `${dest}.${randomUUID()}.part`;
  await fs.writeFile(temp, bytes);
  await fs.rename(temp, dest);
}

/** Take every other live file for the project off the list without deleting it or archiving it. */
async function demoteOtherLive(projectId: string, keepId?: string): Promise<void> {
  await prisma.masterDataFile.updateMany({
    where: {
      projectId,
      current: true,
      archivedAt: null,
      ...(keepId ? { id: { not: keepId } } : {}),
    },
    data: { current: false },
  });
}

export type StoreMasterResult =
  | { ok: true; id: string; name: string; version: number; projectId: string; replaced: boolean }
  | { ok: false; status: number; message: string };

/**
 * Store the macro-enabled workbook as the live master for its project.
 * `replaceId` overwrites that live file (Save Master).
 * `asNew` keeps the previous file and makes this version the live one (Save as New Master).
 * Bytes are written as given. Nothing is re-exported.
 */
export async function storeMasterDataFile(input: {
  bytes: Buffer;
  fileName: string;
  replaceId?: string;
  asNew?: boolean;
}): Promise<StoreMasterResult> {
  if (!input.bytes.length) {
    return { ok: false, status: 400, message: "The master file is empty." };
  }
  if (input.bytes.length > MASTER_DATA_MAX_BYTES) {
    return { ok: false, status: 413, message: "That master file is too large to store." };
  }
  const parsed = parseMasterDataFileName(input.fileName);
  if (!parsed) {
    return {
      ok: false,
      status: 400,
      message: "The live file must be named {Project name}-Master Data File-V1.xlsm (or a later version).",
    };
  }
  const project = await projectForMasterName(input.fileName);
  if (!project) {
    return {
      ok: false,
      status: 400,
      message: "No single project matches that master file name.",
    };
  }
  const name = masterDataFileName(project.name, project.version);

  if (input.replaceId && !input.asNew) {
    const existing = await prisma.masterDataFile.findUnique({ where: { id: input.replaceId } });
    if (!existing || !isLiveMaster(existing)) {
      return { ok: false, status: 404, message: "That live file is not on the list." };
    }
    if (existing.projectId !== project.id) {
      return { ok: false, status: 400, message: "This master belongs to a different project." };
    }
    await writeStoredBytes(existing.storedName, input.bytes);
    const saved = await prisma.masterDataFile.update({
      where: { id: existing.id },
      data: { name, version: project.version, size: input.bytes.length },
    });
    return {
      ok: true,
      id: saved.id,
      name: saved.name,
      version: saved.version,
      projectId: saved.projectId,
      replaced: true,
    };
  }

  if (!input.asNew) {
    const live = await prisma.masterDataFile.findFirst({
      where: { projectId: project.id, current: true, archivedAt: null },
    });
    if (live && live.version === project.version) {
      await writeStoredBytes(live.storedName, input.bytes);
      const saved = await prisma.masterDataFile.update({
        where: { id: live.id },
        data: { name, version: project.version, size: input.bytes.length },
      });
      return {
        ok: true,
        id: saved.id,
        name: saved.name,
        version: saved.version,
        projectId: saved.projectId,
        replaced: true,
      };
    }
    if (live && live.version > project.version) {
      return {
        ok: false,
        status: 409,
        message: "A later live master is already stored for this project.",
      };
    }
  }

  const storedName = `${randomUUID()}.xlsm`;
  await writeStoredBytes(storedName, input.bytes);
  try {
    const created = await prisma.masterDataFile.create({
      data: {
        projectId: project.id,
        name,
        version: project.version,
        storedName,
        size: input.bytes.length,
        current: true,
      },
    });
    await demoteOtherLive(project.id, created.id);
    return {
      ok: true,
      id: created.id,
      name: created.name,
      version: created.version,
      projectId: created.projectId,
      replaced: false,
    };
  } catch (error) {
    await fs.unlink(masterStoredPath(storedName)).catch(() => undefined);
    throw error;
  }
}

/**
 * Take a live file off the list. The workbook stays on disk, so the file and
 * the validations inside it are not deleted.
 */
export async function archiveLiveMaster(id: string): Promise<{ ok: true; name: string } | { ok: false; status: number; message: string }> {
  const row = await prisma.masterDataFile.findUnique({ where: { id } });
  if (!row || !isLiveMaster(row)) {
    return { ok: false, status: 404, message: "That live file is not on the list." };
  }
  await prisma.masterDataFile.update({
    where: { id: row.id },
    data: { current: false, archivedAt: new Date() },
  });
  return { ok: true, name: row.name };
}

export async function readStoredMaster(
  id: string
): Promise<{ id: string; name: string; storedName: string; bytes: Buffer; live: boolean } | null> {
  const row = await prisma.masterDataFile.findUnique({ where: { id } });
  if (!row) return null;
  try {
    const bytes = await fs.readFile(masterStoredPath(row.storedName));
    return { id: row.id, name: row.name, storedName: row.storedName, bytes, live: isLiveMaster(row) };
  } catch {
    return null;
  }
}

export async function findMasterRecord(
  id: string
): Promise<{ id: string; name: string; storedName: string; live: boolean } | null> {
  const row = await prisma.masterDataFile.findUnique({ where: { id } });
  if (!row) return null;
  return { id: row.id, name: row.name, storedName: row.storedName, live: isLiveMaster(row) };
}

export async function readLiveMaster(
  id: string
): Promise<{ id: string; name: string; storedName: string } | null> {
  const row = await findMasterRecord(id);
  if (!row || !row.live) return null;
  return { id: row.id, name: row.name, storedName: row.storedName };
}
