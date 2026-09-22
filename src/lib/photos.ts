import type { PhotoFolder, PhotoFolderActivity, PhotoPoolItem, Project } from "@prisma/client";
import { prisma } from "./prisma.js";
import { seededSurveyTypes } from "./programme.js";
import { spacesObjectKey, spacesStatus } from "./spaces.js";

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

export function spacesHint(): string {
  const s = spacesStatus();
  if (s.configured) {
    return `Spaces connected (${s.bucket} / ${s.region}). Real image bytes can replace placeholders when object keys are set.`;
  }
  return `Spaces not configured yet — showing demo placeholders. Set SPACES_ENDPOINT, SPACES_KEY, SPACES_SECRET (bucket ${s.bucket}, region ${s.region}) on App Platform for live photos.`;
}
