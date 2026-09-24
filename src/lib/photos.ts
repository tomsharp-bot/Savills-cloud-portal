import type { PhotoFolder, PhotoFolderActivity, PhotoPoolItem, Prisma, Project } from "@prisma/client";
import { prisma } from "./prisma.js";
import { seededSurveyTypes } from "./programme.js";
import {
  copySpacesObject,
  deleteSpacesObject,
  putSpacesObject,
  spacesObjectKey,
  spacesRequired,
  spacesStatus,
  spacesTargetOk,
  type SpacesCopyResult,
} from "./spaces.js";

const DEMO_ROOMS = ["Kitchen", "Bathroom", "Lounge", "Bedroom", "Hall", "Exterior", "Roof", "Boiler"] as const;

export type PhotoTileProject = {
  id: string;
  name: string;
  leadFirst: string;
  surveyTypes: string;
  stage: "current" | "archive";
  accent: string;
  poolCount: number;
  folderCount: number;
};

export type PhotoPoolView = {
  id: string;
  code: string;
  fileName: string;
  uprn: string;
  spacesKey: string;
  /** data-URI or Spaces URL placeholder for coloured thumb */
  thumbUrl: string;
};

export type PhotoFolderView = {
  id: string;
  name: string;
  kind: "folder" | "zip";
  sizeLabel: string;
  clientAccess: boolean;
  photoCodes: string[];
  contentsLabel: string;
  activities: Array<{
    id: string;
    who: string;
    downloaded: boolean;
    when: string | null;
  }>;
};

/** First name from Project Progress projectManager (e.g. "Tom Sharp" → "Tom", "Greg K" → "Greg"). */
export function leadFirstName(projectManager: string | null | undefined): string {
  const raw = String(projectManager || "").trim();
  if (!raw || raw === "—" || raw.toUpperCase() === "TBC") return "—";
  const first = raw.split(/\s+/)[0] || "";
  return first || "—";
}

export function accentClassForName(name: string): string {
  const key = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const known: Record<string, string> = {
    onward: "acc-Onward",
    vico2026: "acc-Vico",
    cornwall2026ph2: "acc-Cornwall",
    a2dph4: "acc-A2D",
    bpha2026acq: "acc-BPHA",
    lfha2026: "acc-LFHA",
    southernblocks: "acc-Southern",
    flagship: "acc-Flagship",
    radiusph1: "acc-Radius",
    saxonwealdph4: "acc-Saxon",
    bristolph2: "acc-Bristol",
  };
  if (known[key]) return known[key];
  const palette = [
    "acc-Onward",
    "acc-Vico",
    "acc-Cornwall",
    "acc-A2D",
    "acc-BPHA",
    "acc-LFHA",
    "acc-Southern",
    "acc-Flagship",
    "acc-Radius",
    "acc-Saxon",
    "acc-Bristol",
  ];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export function uprnFromCode(code: string): string {
  return String(code || "").split("-")[0] || "";
}

export function fileNameForCode(code: string): string {
  return `${String(code || "photo").trim()}.jpg`;
}

/** Deterministic coloured SVG thumb until Spaces serves real images. */
export function placeholderThumbUrl(code: string): string {
  let h = 0;
  const s = String(code || "IMG");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const hue2 = (hue + 40) % 360;
  const label = escapeXml(uprnFromCode(s) || "IMG");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="192" viewBox="0 0 256 192">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="hsl(${hue},42%,62%)"/>` +
    `<stop offset="100%" stop-color="hsl(${hue2},38%,48%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="256" height="192" fill="url(#g)"/>` +
    `<rect x="18" y="18" width="220" height="156" rx="10" fill="rgba(255,255,255,.22)"/>` +
    `<text x="128" y="102" text-anchor="middle" fill="rgba(11,31,51,.55)" font-family="Segoe UI,sans-serif" font-size="22" font-weight="700">${label}</text>` +
    `</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildPoolCodes(prefix: string, count: number): string[] {
  const codes: string[] = [];
  let base = 2000000;
  for (let i = 0; i < prefix.length; i++) base += prefix.charCodeAt(i) * 97;
  base = 2000000 + (base % 7000000);
  for (let i = 0; i < count; i++) {
    const uprn = String(base + Math.floor(i / 2));
    const room = DEMO_ROOMS[i % DEMO_ROOMS.length];
    const seq = (i % 2) + 1;
    codes.push(`${uprn}-${room}-${seq}`);
  }
  return codes;
}

export function parsePhotoCodes(raw: string): string[] {
  const parts = String(raw || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const c of parts) {
    const key = c.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    codes.push(c);
  }
  return codes;
}

export function nextFolderSequence(folderNames: string[]): number {
  let max = 0;
  for (const name of folderNames) {
    const m = String(name).match(/^(\d+)\.\s*/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

export function buildFolderName(seq: number, nameRest: string): string | null {
  let rest = String(nameRest || "").trim();
  if (!rest) return null;
  if (/^\d+\.\s*/.test(rest)) rest = rest.replace(/^\d+\.\s*/, "");
  if (!rest) return null;
  return `${seq}. ${rest}`;
}

export function photoCodesOf(folder: Pick<PhotoFolder, "photoCodes">): string[] {
  const raw = folder.photoCodes;
  if (Array.isArray(raw)) return raw.map(String);
  return [];
}

export function formatActivityWhen(d: Date | null | undefined): string | null {
  if (!d) return null;
  const day = d.getUTCDate();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${mon} ${year} ${hh}:${mm}`;
}

export function toPoolView(item: PhotoPoolItem): PhotoPoolView {
  return {
    id: item.id,
    code: item.code,
    fileName: item.fileName || fileNameForCode(item.code),
    uprn: uprnFromCode(item.code),
    spacesKey: item.spacesKey || "",
    thumbUrl: placeholderThumbUrl(item.code),
  };
}

export function toFolderView(
  folder: PhotoFolder & { activities?: PhotoFolderActivity[] }
): PhotoFolderView {
  const codes = photoCodesOf(folder);
  const kind = folder.kind === "zip" ? "zip" : "folder";
  const contentsLabel =
    kind === "folder"
      ? `${codes.length} photo${codes.length === 1 ? "" : "s"}`
      : folder.sizeLabel || "Zip pack";
  return {
    id: folder.id,
    name: folder.name,
    kind,
    sizeLabel: folder.sizeLabel || "",
    clientAccess: !!folder.clientAccess,
    photoCodes: codes,
    contentsLabel,
    activities: (folder.activities || []).map((a) => ({
      id: a.id,
      who: a.who,
      downloaded: !!a.downloaded,
      when: formatActivityWhen(a.downloadedAt),
    })),
  };
}

type ProjectPhotoSource = Pick<
  Project,
  | "id"
  | "name"
  | "projectManager"
  | "stage"
  | "typeConditionOnly"
  | "typeConditionEpc"
  | "typeBlocks"
  | "typeGarages"
  | "typeCommercial"
  | "typeOther"
  | "typeValidations"
>;

function demoCountForProject(project: ProjectPhotoSource): number {
  const n = project.name.toLowerCase();
  if (n.includes("a2d")) return 22;
  if (n.includes("onward") || n === "test 1" || n === "devon ha") return 36;
  if (project.stage === "archive") return 12;
  return 28;
}

function codePrefixForProject(project: ProjectPhotoSource): string {
  return project.name
    .replace(/[^A-Za-z0-9]+/g, "")
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, "X");
}

/** Seed demo pool + starter folders when a project has no photo rows yet (Spaces not required). */
export async function ensureProjectPhotoDemo(project: ProjectPhotoSource): Promise<void> {
  const existing = await prisma.photoPoolItem.count({ where: { projectId: project.id } });
  if (existing > 0) return;

  const codes = buildPoolCodes(codePrefixForProject(project), demoCountForProject(project));
  if (codes.length) {
    await prisma.photoPoolItem.createMany({
      data: codes.map((code) => ({
        projectId: project.id,
        code,
        fileName: fileNameForCode(code),
        spacesKey: spacesStatus().configured ? spacesObjectKey(project.id, code) : "",
      })),
      skipDuplicates: true,
    });
  }

  const folderCount = await prisma.photoFolder.count({ where: { projectId: project.id } });
  if (folderCount > 0) return;

  const batch1 = codes.slice(0, Math.min(8, codes.length));
  const batch2 = codes.slice(8, Math.min(14, codes.length));
  const who = `Client portal · ${project.name}`;

  if (batch1.length) {
    await prisma.photoFolder.create({
      data: {
        projectId: project.id,
        name: "1. Pictures Batch 1",
        kind: "folder",
        clientAccess: false,
        photoCodes: batch1,
        activities: {
          create: [{ who, downloaded: false }],
        },
      },
    });
  }
  if (batch2.length) {
    await prisma.photoFolder.create({
      data: {
        projectId: project.id,
        name: "2. Pictures Batch 2",
        kind: "folder",
        clientAccess: project.stage === "current",
        photoCodes: batch2,
        activities: {
          create: [
            {
              who,
              downloaded: project.stage === "current",
              downloadedAt: project.stage === "current" ? new Date("2026-09-21T14:32:00Z") : null,
            },
          ],
        },
      },
    });
  }
  if (project.stage === "archive" || project.name.toLowerCase().includes("onward") || project.name === "Test 1") {
    await prisma.photoFolder.create({
      data: {
        projectId: project.id,
        name: `${project.name.replace(/\s+/g, "_").slice(0, 40)}_Pack.zip`,
        kind: "zip",
        sizeLabel: project.stage === "archive" ? "520 MB" : "320 MB",
        clientAccess: project.stage === "current",
        photoCodes: [],
        activities: {
          create: [
            {
              who,
              downloaded: true,
              downloadedAt: new Date("2026-09-18T09:05:00Z"),
            },
          ],
        },
      },
    });
  }
}

export async function listPhotoTiles(
  projects: ProjectPhotoSource[],
  surveyNotes: Map<string, string>
): Promise<PhotoTileProject[]> {
  const ids = projects.map((p) => p.id);
  if (!ids.length) return [];

  await Promise.all(projects.map((p) => ensureProjectPhotoDemo(p)));

  const [poolGroups, folderGroups] = await Promise.all([
    prisma.photoPoolItem.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _count: { _all: true } }),
    prisma.photoFolder.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _count: { _all: true } }),
  ]);
  const poolMap = new Map(poolGroups.map((g) => [g.projectId, g._count._all]));
  const folderMap = new Map(folderGroups.map((g) => [g.projectId, g._count._all]));

  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    leadFirst: leadFirstName(p.projectManager),
    surveyTypes: surveyNotes.has(p.id) ? String(surveyNotes.get(p.id) ?? "") : seededSurveyTypes(p),
    stage: p.stage === "archive" ? "archive" : "current",
    accent: accentClassForName(p.name),
    poolCount: poolMap.get(p.id) || 0,
    folderCount: folderMap.get(p.id) || 0,
  }));
}

export async function loadProjectPhotos(projectId: string): Promise<{
  pool: PhotoPoolView[];
  folders: PhotoFolderView[];
}> {
  const [poolRows, folderRows] = await Promise.all([
    prisma.photoPoolItem.findMany({ where: { projectId }, orderBy: { code: "asc" } }),
    prisma.photoFolder.findMany({
      where: { projectId },
      include: { activities: { orderBy: { who: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    pool: poolRows.map(toPoolView),
    folders: folderRows.map(toFolderView),
  };
}

export async function listClientAccessFolders(projectId: string): Promise<PhotoFolderView[]> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (project) await ensureProjectPhotoDemo(project);
  const rows = await prisma.photoFolder.findMany({
    where: { projectId, clientAccess: true },
    include: { activities: { orderBy: { who: "asc" } } },
    orderBy: { name: "asc" },
  });
  return rows.map(toFolderView);
}

export type ExtractResult = {
  found: number;
  skipped: number;
  folderName: string;
  folder: PhotoFolderView;
};

export async function createPhotosExtract(
  projectId: string,
  rawCodes: string,
  nameRest: string
): Promise<{ ok: true; result: ExtractResult } | { ok: false; error: string }> {
  const codes = parsePhotoCodes(rawCodes);
  if (!codes.length) return { ok: false, error: "Paste at least one photo code to extract." };

  const pool = await prisma.photoPoolItem.findMany({
    where: { projectId },
    select: { code: true },
  });
  const byUpper = new Map(pool.map((p) => [p.code.toUpperCase(), p.code]));
  const foundCodes: string[] = [];
  let skipped = 0;
  for (const c of codes) {
    const hit = byUpper.get(c.toUpperCase());
    if (hit) foundCodes.push(hit);
    else skipped++;
  }

  const existing = await prisma.photoFolder.findMany({
    where: { projectId },
    select: { name: true },
  });
  const seq = nextFolderSequence(existing.map((f) => f.name));
  const folderName = buildFolderName(seq, nameRest);
  if (!folderName) return { ok: false, error: "Please enter a name." };

  const folder = await prisma.photoFolder.create({
    data: {
      projectId,
      name: folderName,
      kind: "folder",
      clientAccess: false,
      photoCodes: foundCodes,
      activities: {
        create: [{ who: "Client portal · (no clients yet)", downloaded: false }],
      },
    },
    include: { activities: true },
  });

  return {
    ok: true,
    result: {
      found: foundCodes.length,
      skipped,
      folderName,
      folder: toFolderView(folder),
    },
  };
}

export async function setFolderClientAccess(folderId: string, projectId: string, clientAccess: boolean) {
  return prisma.photoFolder.updateMany({
    where: { id: folderId, projectId },
    data: { clientAccess },
  });
}

export async function markFolderDownloaded(
  folderId: string,
  who: string,
  userId: string
): Promise<void> {
  const existing = await prisma.photoFolderActivity.findFirst({
    where: { folderId, OR: [{ userId: userId || "__none__" }, { who }] },
  });
  const now = new Date();
  if (existing) {
    await prisma.photoFolderActivity.update({
      where: { id: existing.id },
      data: { downloaded: true, downloadedAt: now, who, userId: userId || existing.userId },
    });
    return;
  }
  await prisma.photoFolderActivity.create({
    data: { folderId, who, userId: userId || "", downloaded: true, downloadedAt: now },
  });
}

/** Minimal store-only ZIP of text placeholders (demo until Spaces bytes are available). */
export function buildPlaceholderZip(files: Array<{ name: string; body: string }>): Buffer {
  const partsLocal: Buffer[] = [];
  const partsCentral: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = Buffer.from(f.name, "utf8");
    const data = Buffer.from(f.body, "utf8");
    const crc = crc32(data);
    const size = data.length;
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ]);
    partsLocal.push(local);
    const central = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    partsCentral.push(central);
    offset += local.length;
  }
  const local = Buffer.concat(partsLocal);
  const central = Buffer.concat(partsCentral);
  const end = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(local.length),
    u16(0),
  ]);
  return Buffer.concat([local, central, end]);
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff, 0);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export const PHOTO_NAME_MAX = 120;
export const PHOTO_DELETE_MAX = 500;
/** One image per request. The browser uploads a few at a time. */
export const PHOTO_UPLOAD_MAX_BYTES = 40 * 1024 * 1024;
export const PHOTO_UPLOAD_CONCURRENCY = 4;
export const PHOTO_UPLOAD_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "heif"] as const;

const PHOTO_UPLOAD_EXT_SET = new Set<string>(PHOTO_UPLOAD_EXTS.map((ext) => `.${ext}`));
const PHOTO_UPLOAD_MIME_SET = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export function photoTooLargeMessage(): string {
  const mb = PHOTO_UPLOAD_MAX_BYTES / (1024 * 1024);
  return `That photo is larger than ${mb} MB.`;
}

export type PhotoStorageOps = {
  configured: () => boolean;
  remove: (key: string) => Promise<boolean>;
  copy: (fromKey: string, toKey: string) => Promise<SpacesCopyResult>;
  put: (key: string, body: Buffer, contentType: string) => Promise<boolean>;
};

export function defaultPhotoStorageOps(): PhotoStorageOps {
  return {
    configured: () => spacesStatus().configured,
    remove: (key) => deleteSpacesObject(key),
    copy: (fromKey, toKey) => copySpacesObject(fromKey, toKey),
    put: (key, body, contentType) => putSpacesObject(key, body, contentType),
  };
}

export function fileExtension(fileName: string): string {
  const match = String(fileName || "").match(/(\.[A-Za-z0-9]{1,8})$/);
  return match ? match[1].toLowerCase() : ".jpg";
}

export function extensionOfKey(key: string): string {
  const match = String(key || "").match(/(\.[A-Za-z0-9]{1,8})$/);
  return match ? match[1].toLowerCase() : ".jpg";
}

function normCode(code: string): string {
  return String(code || "").trim().toUpperCase();
}

/**
 * New filename keeps the current extension. A typed matching extension is stripped
 * so the stem is what changes. A different extension is rejected.
 */
export function parseRenamedPhotoName(
  currentFileName: string,
  requested: string
): { ok: true; code: string; fileName: string } | { ok: false; error: string } {
  const ext = fileExtension(currentFileName);
  let raw = String(requested || "").trim();
  if (!raw) return { ok: false, error: "Enter a file name." };
  if (raw.length > 180) return { ok: false, error: "File name is too long." };
  if (/[\u0000-\u001f]/.test(raw)) return { ok: false, error: "File name cannot include control characters." };
  if (/[/\\]/.test(raw) || raw.includes("..")) return { ok: false, error: "File name cannot include a path." };
  if (raw.toLowerCase().endsWith(ext)) {
    raw = raw.slice(0, -ext.length).trim();
  } else if (/\.[A-Za-z0-9]{1,8}$/.test(raw)) {
    return { ok: false, error: `Keep the current extension (${ext}). Rename the name only.` };
  }
  if (!raw || raw === "." || raw === "..") return { ok: false, error: "Enter a file name." };
  if (raw.length > PHOTO_NAME_MAX) return { ok: false, error: "File name is too long." };
  if (/[/\\]/.test(raw) || raw.includes("..")) return { ok: false, error: "File name cannot include a path." };
  return { ok: true, code: raw, fileName: `${raw}${ext}` };
}

/** Object key under this project's pool prefix. Null when the name is not safe to store. */
export function photoObjectKey(projectId: string, code: string, ext: string): string | null {
  if (!projectId || /[/\\]/.test(projectId) || projectId.includes("..")) return null;
  if (!/^\.[a-z0-9]{1,8}$/.test(ext)) return null;
  const safe = String(code || "").trim();
  if (!safe || safe.length > PHOTO_NAME_MAX) return null;
  if (/[/\\]/.test(safe) || safe.includes("..")) return null;
  return `photos/${projectId}/pool/${safe}${ext}`;
}

/** True only for a single object inside photos/{projectId}/pool/. */
export function isProjectPoolKey(projectId: string, key: string): boolean {
  if (!projectId || /[/\\]/.test(projectId) || projectId.includes("..")) return false;
  const prefix = `photos/${projectId}/pool/`;
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  if (!rest || rest.includes("/") || rest.includes("\\") || rest.includes("..")) return false;
  return /\.[A-Za-z0-9]{1,8}$/.test(rest);
}

export function canonicalCodes(
  requested: string[],
  allowed: string[],
  missingError: string
): { ok: true; codes: string[] } | { ok: false; error: string } {
  const seen = new Set<string>();
  const wanted: string[] = [];
  for (const raw of requested) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) continue;
    const key = normCode(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push(trimmed);
  }
  if (!wanted.length) return { ok: false, error: "Select at least one photo." };
  if (wanted.length > PHOTO_DELETE_MAX) return { ok: false, error: "Too many photos selected." };
  const byNorm = new Map<string, string>();
  for (const code of allowed) {
    const key = normCode(code);
    if (key && !byNorm.has(key)) byNorm.set(key, code);
  }
  const codes: string[] = [];
  for (const code of wanted) {
    const hit = byNorm.get(normCode(code));
    if (!hit) return { ok: false, error: missingError };
    codes.push(hit);
  }
  return { ok: true, codes };
}

export function replaceCodeInList(codes: string[], from: string, to: string): { codes: string[]; changed: boolean } {
  const key = normCode(from);
  let changed = false;
  const next = codes.map((c) => {
    if (normCode(c) !== key) return c;
    changed = true;
    return to;
  });
  return { codes: next, changed };
}

export function withoutCodes(codes: string[], drop: string[]): string[] {
  const keys = new Set(drop.map((c) => normCode(c)));
  return codes.filter((c) => !keys.has(normCode(c)));
}

export async function deleteStoredPhoto(
  projectId: string,
  spacesKey: string,
  ops: PhotoStorageOps
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = String(spacesKey || "");
  if (!key) return { ok: true };
  if (!isProjectPoolKey(projectId, key)) {
    return { ok: false, error: "Photo is not stored in this project." };
  }
  if (!ops.configured()) return { ok: false, error: "Photo storage is not available." };
  const removed = await ops.remove(key);
  if (!removed) return { ok: false, error: "Could not delete that photo from storage." };
  return { ok: true };
}

/**
 * Move a pool object to a new key in the same project.
 * Copies first, deletes the old key, and deletes the new key if the old one cannot be removed.
 * An empty source key stays empty (placeholder, no object to move).
 * A missing source is treated as nothing to move — the caller may point metadata at the new key.
 */
export async function moveStoredPhoto(
  projectId: string,
  fromKey: string,
  toKey: string,
  ops: PhotoStorageOps
): Promise<{ ok: true; spacesKey: string } | { ok: false; error: string }> {
  const from = String(fromKey || "");
  const to = String(toKey || "");
  if (!from) return { ok: true, spacesKey: "" };
  if (!isProjectPoolKey(projectId, from) || !isProjectPoolKey(projectId, to)) {
    return { ok: false, error: "Photo is not stored in this project." };
  }
  if (from === to) return { ok: true, spacesKey: to };
  if (!ops.configured()) return { ok: false, error: "Photo storage is not available." };
  const copied = await ops.copy(from, to);
  if (copied === "failed") return { ok: false, error: "Could not rename that photo in storage." };
  if (copied === "missing") return { ok: true, spacesKey: to };
  const removed = await ops.remove(from);
  if (!removed) {
    await ops.remove(to);
    return { ok: false, error: "Could not rename that photo in storage." };
  }
  return { ok: true, spacesKey: to };
}

function storageFailureStatus(error: string): number {
  if (error === "Photo storage is not available.") return 503;
  if (error === "Photo is not stored in this project.") return 400;
  return 502;
}

export type PhotoMutationScope = { kind: "pool" } | { kind: "folder"; folderId: string };

/**
 * Permanently delete photos that belong to this project.
 * Folder scope only accepts codes listed on that folder. Pool and folder rows share one
 * Spaces object, so a successful delete removes the pool row and every folder reference.
 */
export async function deleteProjectPhotos(
  projectId: string,
  requested: string[],
  scope: PhotoMutationScope,
  ops: PhotoStorageOps = defaultPhotoStorageOps()
): Promise<
  { ok: true; deletedCodes: string[] } | { ok: false; error: string; status: number; deletedCodes: string[] }
> {
  const pool = await prisma.photoPoolItem.findMany({ where: { projectId } });
  let allowed: string[];
  if (scope.kind === "folder") {
    const folder = await prisma.photoFolder.findFirst({
      where: { id: scope.folderId, projectId },
    });
    if (!folder) return { ok: false, error: "Folder not found.", status: 404, deletedCodes: [] };
    if (folder.kind === "zip") {
      return { ok: false, error: "Zip packs do not contain selectable photos.", status: 400, deletedCodes: [] };
    }
    allowed = photoCodesOf(folder);
  } else {
    allowed = pool.map((p) => p.code);
  }

  const resolved = canonicalCodes(
    requested,
    allowed,
    scope.kind === "folder" ? "One or more photos are not in this folder." : "One or more photos are not in this pool."
  );
  if (!resolved.ok) return { ok: false, error: resolved.error, status: 400, deletedCodes: [] };

  const byNorm = new Map(pool.map((p) => [normCode(p.code), p]));
  const removableIds: string[] = [];
  const deletedCodes: string[] = [];
  let failureStatus = 502;
  let failureError = "Could not delete that photo from storage.";

  for (const code of resolved.codes) {
    const item = byNorm.get(normCode(code));
    if (!item) {
      deletedCodes.push(code);
      continue;
    }
    const stored = await deleteStoredPhoto(projectId, item.spacesKey, ops);
    if (!stored.ok) {
      failureStatus = storageFailureStatus(stored.error);
      failureError = stored.error;
      continue;
    }
    removableIds.push(item.id);
    deletedCodes.push(item.code);
  }

  if (deletedCodes.length) {
    await prisma.$transaction(async (tx) => {
      if (removableIds.length) {
        await tx.photoPoolItem.deleteMany({
          where: { projectId, id: { in: removableIds } },
        });
      }
      const folders = await tx.photoFolder.findMany({ where: { projectId } });
      for (const folder of folders) {
        const current = photoCodesOf(folder);
        const next = withoutCodes(current, deletedCodes);
        if (next.length !== current.length) {
          await tx.photoFolder.update({
            where: { id: folder.id },
            data: { photoCodes: next },
          });
        }
      }
    });
  }

  if (deletedCodes.length !== resolved.codes.length) {
    const removed = deletedCodes.length;
    return {
      ok: false,
      error: removed
        ? `Deleted ${removed} photo${removed === 1 ? "" : "s"}. ${failureError}`
        : failureError,
      status: removed ? 502 : failureStatus,
      deletedCodes,
    };
  }
  return { ok: true, deletedCodes };
}

/**
 * Rename one photo. The extension is kept. The new name must be unique in the project
 * (pool code and file name), which also covers the folder that listed it.
 * Folder photoCodes that cite the old code are updated so captions stay in step.
 */
export async function renameProjectPhoto(
  projectId: string,
  requestedCode: string,
  requestedName: string,
  scope: PhotoMutationScope,
  ops: PhotoStorageOps = defaultPhotoStorageOps()
): Promise<
  { ok: true; photo: PhotoPoolView; previousCode: string } | { ok: false; error: string; status: number }
> {
  const pool = await prisma.photoPoolItem.findMany({ where: { projectId } });
  const folders = await prisma.photoFolder.findMany({ where: { projectId } });
  let allowed: string[];
  if (scope.kind === "folder") {
    const folder = folders.find((f) => f.id === scope.folderId);
    if (!folder) return { ok: false, error: "Folder not found.", status: 404 };
    if (folder.kind === "zip") {
      return { ok: false, error: "Zip packs do not contain selectable photos.", status: 400 };
    }
    allowed = photoCodesOf(folder);
  } else {
    allowed = pool.map((p) => p.code);
  }

  const resolved = canonicalCodes(
    [requestedCode],
    allowed,
    scope.kind === "folder" ? "That photo is not in this folder." : "That photo is not in this pool."
  );
  if (!resolved.ok) return { ok: false, error: resolved.error, status: 400 };
  const currentCode = resolved.codes[0];
  const item = pool.find((p) => normCode(p.code) === normCode(currentCode));
  if (!item) return { ok: false, error: "That photo is not in this pool.", status: 404 };

  const parsed = parseRenamedPhotoName(item.fileName || fileNameForCode(item.code), requestedName);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };

  const sameName = parsed.code === item.code && parsed.fileName === String(item.fileName || "");
  if (sameName) return { ok: true, photo: toPoolView(item), previousCode: item.code };

  if (scope.kind === "folder") {
    const folder = folders.find((f) => f.id === scope.folderId);
    const folderClash = folder
      ? photoCodesOf(folder).some((c) => normCode(c) === normCode(parsed.code) && normCode(c) !== normCode(item.code))
      : false;
    if (folderClash) {
      return { ok: false, error: "A photo with that name already exists in this folder.", status: 409 };
    }
  }

  const projectClash = pool.some(
    (p) =>
      p.id !== item.id &&
      (normCode(p.code) === normCode(parsed.code) ||
        String(p.fileName || "").toLowerCase() === parsed.fileName.toLowerCase())
  );
  const listedElsewhere = folders.some((f) =>
    photoCodesOf(f).some((c) => normCode(c) === normCode(parsed.code) && normCode(c) !== normCode(item.code))
  );
  if (projectClash || listedElsewhere) {
    return { ok: false, error: "A photo with that name already exists in this project.", status: 409 };
  }

  const ext = item.spacesKey ? extensionOfKey(item.spacesKey) : fileExtension(parsed.fileName);
  const nextKey = item.spacesKey ? photoObjectKey(projectId, parsed.code, ext) : "";
  if (item.spacesKey && !nextKey) return { ok: false, error: "File name cannot include a path.", status: 400 };

  let storedKey = item.spacesKey;
  if (item.spacesKey) {
    const moved = await moveStoredPhoto(projectId, item.spacesKey, nextKey || "", ops);
    if (!moved.ok) return { ok: false, error: moved.error, status: storageFailureStatus(moved.error) };
    storedKey = moved.spacesKey;
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.photoPoolItem.update({
        where: { id: item.id },
        data: { code: parsed.code, fileName: parsed.fileName, spacesKey: storedKey },
      });
      const freshFolders = await tx.photoFolder.findMany({ where: { projectId } });
      for (const folder of freshFolders) {
        const current = photoCodesOf(folder);
        const next = replaceCodeInList(current, item.code, parsed.code);
        if (next.changed) {
          await tx.photoFolder.update({
            where: { id: folder.id },
            data: { photoCodes: next.codes },
          });
        }
      }
      return row;
    });
    return { ok: true, photo: toPoolView(updated), previousCode: item.code };
  } catch (err) {
    if (item.spacesKey && storedKey && storedKey !== item.spacesKey) {
      await moveStoredPhoto(projectId, storedKey, item.spacesKey, ops);
    }
    const message = err instanceof Error ? err.message : "";
    if (/unique/i.test(message) || (typeof err === "object" && err && "code" in err && (err as { code?: string }).code === "P2002")) {
      return { ok: false, error: "A photo with that name already exists in this project.", status: 409 };
    }
    return { ok: false, error: "Could not rename that photo.", status: 500 };
  }
}

export type UploadedPhotoName = {
  code: string;
  fileName: string;
  ext: string;
};

/**
 * Photo code is the file stem. The extension is kept on the file name and the Spaces key,
 * matching pool rows such as code `2245623-Kitchen-1` and file `2245623-Kitchen-1.jpg`.
 * `.jpeg` is stored as `.jpg`. Path segments are rejected rather than stripped.
 */
export function parseUploadedPhotoName(
  originalName: string
): { ok: true; name: UploadedPhotoName } | { ok: false; error: string } {
  const raw = String(originalName || "").trim();
  if (!raw) return { ok: false, error: "That file needs a name." };
  if (raw.length > 200) return { ok: false, error: "File name is too long." };
  if (/[\u0000-\u001f]/.test(raw)) return { ok: false, error: "File name cannot include control characters." };
  if (/[/\\]/.test(raw) || raw.includes("..")) return { ok: false, error: "File name cannot include a path." };
  const extMatch = raw.match(/(\.[A-Za-z0-9]{1,8})$/);
  if (!extMatch) return { ok: false, error: "Photos must be JPEG, PNG, WebP, or HEIC." };
  const ext = extMatch[1].toLowerCase();
  if (!PHOTO_UPLOAD_EXT_SET.has(ext)) return { ok: false, error: "Photos must be JPEG, PNG, WebP, or HEIC." };
  const storedExt = ext === ".jpeg" ? ".jpg" : ext;
  const code = raw.slice(0, -extMatch[1].length).trim();
  if (!code || code === "." || code === "..") return { ok: false, error: "That file needs a name." };
  if (code.length > PHOTO_NAME_MAX) return { ok: false, error: "File name is too long." };
  if (/[/\\]/.test(code) || code.includes("..")) return { ok: false, error: "File name cannot include a path." };
  return { ok: true, name: { code, fileName: `${code}${storedExt}`, ext: storedExt } };
}

/** Empty or generic MIME is allowed. A declared non-image type is not. */
export function uploadMimeAllowed(mime: string | undefined): boolean {
  const type = String(mime || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!type || type === "application/octet-stream") return true;
  return PHOTO_UPLOAD_MIME_SET.has(type);
}

export function contentTypeForPhotoExt(ext: string): string {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    default:
      return "image/jpeg";
  }
}

export type PhotoUploadFile = {
  originalName: string;
  buffer: Buffer;
  mime?: string;
};

type PhotoDb = Prisma.TransactionClient | typeof prisma;

function prismaErrorCode(err: unknown): string {
  if (typeof err === "object" && err && "code" in err) return String((err as { code?: string }).code || "");
  return "";
}

class UploadAbort extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function findPhotoNameClash(db: PhotoDb, projectId: string, code: string, fileName: string) {
  return db.photoPoolItem.findFirst({
    where: {
      projectId,
      OR: [
        { code: { equals: code, mode: "insensitive" } },
        { fileName: { equals: fileName, mode: "insensitive" } },
      ],
    },
    select: { id: true, code: true, spacesKey: true },
  });
}

function folderPhotoLabel(count: number): string {
  return `${count} photo${count === 1 ? "" : "s"}`;
}

async function rollbackUploadedPhoto(
  projectId: string,
  itemId: string,
  code: string,
  key: string,
  ops: PhotoStorageOps
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.photoPoolItem.deleteMany({ where: { id: itemId, projectId } });
    const folders = await tx.photoFolder.findMany({ where: { projectId } });
    for (const folder of folders) {
      const current = photoCodesOf(folder);
      const next = withoutCodes(current, [code]);
      if (next.length !== current.length) {
        await tx.photoFolder.update({
          where: { id: folder.id },
          data: { photoCodes: next },
        });
      }
    }
  });
  if (key) await ops.remove(key);
}

/**
 * Store one image in the project pool. The Spaces key is always
 * `photos/{projectId}/pool/{code}{ext}` from the file name — never a client-supplied key.
 * An existing code or file name is left untouched. Folder uploads append that code to the
 * folder list (extracts store codes, not a second object) and still create the pool row.
 * The database row is written first so a failed put cannot overwrite an existing object;
 * if the put fails, the new row and folder code are removed.
 */
export async function uploadProjectPhoto(
  projectId: string,
  file: PhotoUploadFile,
  scope: PhotoMutationScope,
  ops: PhotoStorageOps = defaultPhotoStorageOps()
): Promise<
  | {
      ok: true;
      photo: PhotoPoolView;
      folder?: { id: string; photoCodes: string[]; contentsLabel: string };
    }
  | { ok: false; error: string; status: number }
> {
  const buffer = file.buffer;
  if (!buffer || buffer.length === 0) return { ok: false, error: "That file is empty.", status: 400 };
  if (buffer.length > PHOTO_UPLOAD_MAX_BYTES) {
    return { ok: false, error: photoTooLargeMessage(), status: 413 };
  }
  const parsed = parseUploadedPhotoName(file.originalName);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
  if (!uploadMimeAllowed(file.mime)) {
    return { ok: false, error: "Photos must be JPEG, PNG, WebP, or HEIC.", status: 400 };
  }

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return { ok: false, error: "Project not found.", status: 404 };

  const { code, fileName, ext } = parsed.name;
  const key = photoObjectKey(projectId, code, ext);
  if (!key || !isProjectPoolKey(projectId, key)) {
    return { ok: false, error: "File name cannot include a path.", status: 400 };
  }

  if (scope.kind === "folder") {
    const folder = await prisma.photoFolder.findFirst({
      where: { id: scope.folderId, projectId },
      select: { id: true, kind: true },
    });
    if (!folder) return { ok: false, error: "Folder not found.", status: 404 };
    if (folder.kind === "zip") {
      return { ok: false, error: "Upload into a photo folder, not a zip pack.", status: 400 };
    }
  }

  const clash = await findPhotoNameClash(prisma, projectId, code, fileName);
  if (clash) {
    return { ok: false, error: "A photo with that name already exists in this project.", status: 409 };
  }

  if (!ops.configured()) return { ok: false, error: "Photo storage is not available.", status: 503 };

  let created: { row: PhotoPoolItem; photoCodes?: string[]; folderId?: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      if (scope.kind === "folder") {
        await tx.$queryRaw`SELECT id FROM "PhotoFolder" WHERE id = ${scope.folderId} AND "projectId" = ${projectId} FOR UPDATE`;
        const folder = await tx.photoFolder.findFirst({ where: { id: scope.folderId, projectId } });
        if (!folder) throw new UploadAbort(404, "Folder not found.");
        if (folder.kind === "zip") throw new UploadAbort(400, "Upload into a photo folder, not a zip pack.");
      }
      const again = await findPhotoNameClash(tx, projectId, code, fileName);
      if (again) throw new UploadAbort(409, "A photo with that name already exists in this project.");
      const row = await tx.photoPoolItem.create({
        data: { projectId, code, fileName, spacesKey: key },
      });
      if (scope.kind !== "folder") return { row };
      const folder = await tx.photoFolder.findFirst({ where: { id: scope.folderId, projectId } });
      if (!folder || folder.kind === "zip") throw new UploadAbort(404, "Folder not found.");
      const current = photoCodesOf(folder);
      const already = current.some((c) => normCode(c) === normCode(code));
      const photoCodes = already ? current : [...current, row.code];
      if (!already) {
        await tx.photoFolder.update({
          where: { id: folder.id },
          data: { photoCodes },
        });
      }
      return { row, photoCodes, folderId: folder.id };
    });
  } catch (err) {
    if (err instanceof UploadAbort) return { ok: false, error: err.message, status: err.status };
    if (prismaErrorCode(err) === "P2002") {
      return { ok: false, error: "A photo with that name already exists in this project.", status: 409 };
    }
    if (prismaErrorCode(err) === "P2003") return { ok: false, error: "Project not found.", status: 404 };
    return { ok: false, error: "Could not save that photo.", status: 500 };
  }

  const stored = await ops.put(key, buffer, contentTypeForPhotoExt(ext));
  if (!stored) {
    try {
      await rollbackUploadedPhoto(projectId, created.row.id, code, key, ops);
    } catch (err) {
      console.error(`Photo upload rollback failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { ok: false, error: "Could not store that photo.", status: 502 };
  }

  const folder =
    created.folderId && created.photoCodes
      ? {
          id: created.folderId,
          photoCodes: created.photoCodes,
          contentsLabel: folderPhotoLabel(created.photoCodes.length),
        }
      : undefined;
  return { ok: true, photo: toPoolView(created.row), folder };
}

export function spacesHint(): string {
  const s = spacesStatus();
  if (s.configured && spacesTargetOk(s)) {
    return `Spaces connected (${s.bucket} / ${s.region}). Real image bytes can replace placeholders when object keys are set.`;
  }
  if (s.configured) {
    return `Spaces connected (${s.bucket} / ${s.region}). Production file storage must use bucket cloud-portal-vault in lon1.`;
  }
  if (spacesRequired()) {
    return `Spaces is required but not configured. Set SPACES_ENDPOINT, SPACES_KEY, and SPACES_SECRET (bucket ${s.bucket}, region ${s.region}). Uploads fail instead of using local disk.`;
  }
  return `Spaces not configured yet — showing demo placeholders. Set SPACES_ENDPOINT, SPACES_KEY, SPACES_SECRET (bucket ${s.bucket}, region ${s.region}) on App Platform for live photos.`;
}
