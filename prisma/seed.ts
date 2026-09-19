import { PrismaClient, type AssetKind, type ProjectStage } from "@prisma/client";
import { hashPassword } from "../src/lib/passwords.js";

const prisma = new PrismaClient();

type SeedAsset = {
  kind: AssetKind;
  uprn: string;
  assetStatus: string;
  surveyDate?: string;
  surveyedBy?: string;
  visit1?: string;
  visit2?: string;
  visit3?: string;
  number?: string;
  block?: string;
  street?: string;
  area?: string;
  city?: string;
  postcode?: string;
  archetype?: string;
  yearBuilt?: string;
  patch?: string;
  surveyor?: string;
  surveyType?: string;
  siteComments?: string;
  external?: string;
};

const dwellings: SeedAsset[] = [
  { kind: "dwelling", uprn: "100040123456", assetStatus: "Full Survey", surveyDate: "12/03/2026", surveyedBy: "PM", visit1: "01/03/2026", visit2: "12/03/2026", number: "12", street: "Moor Cross", area: "Bude", city: "Bude", postcode: "EX23 9EH", archetype: "House", yearBuilt: "1968", patch: "Patch 1", surveyor: "PM", surveyType: "Condition Only" },
  { kind: "dwelling", uprn: "100040123457", assetStatus: "Full Survey", surveyDate: "18/03/2026", surveyedBy: "AS", visit1: "10/03/2026", visit2: "18/03/2026", number: "14", street: "Moor Cross", area: "Bude", city: "Bude", postcode: "EX23 9EH", archetype: "House", yearBuilt: "1970", patch: "Patch 1", surveyor: "AS", surveyType: "Condition Only", siteComments: "Access confirmed" },
  { kind: "dwelling", uprn: "100040123890", assetStatus: "Void", visit1: "05/04/2026", number: "3", block: "A", street: "New Road", area: "Bude", city: "Bude", postcode: "EX23 9AP", archetype: "Flat", yearBuilt: "1985", patch: "Patch 1", surveyor: "AS", surveyType: "Condition Only" },
  { kind: "dwelling", uprn: "100040200111", assetStatus: "No Visit", number: "22", street: "Victory Road", area: "Holsworthy", city: "Holsworthy", postcode: "EX22 6RY", archetype: "Bungalow", yearBuilt: "1955", patch: "Patch 2", surveyor: "PM", surveyType: "Condition + EPC" },
  { kind: "dwelling", uprn: "100040200112", assetStatus: "No Access", visit1: "20/02/2026", number: "24", street: "Victory Road", area: "Holsworthy", city: "Holsworthy", postcode: "EX22 6RY", archetype: "House", yearBuilt: "1962", patch: "Patch 2", surveyor: "AS", surveyType: "Condition Only", siteComments: "Letter sent" },
  { kind: "dwelling", uprn: "100040300501", assetStatus: "Appt Made Not Kept", visit1: "15/04/2026", visit2: "22/04/2026", number: "7", block: "B", street: "Trevendon", area: "Callington", city: "Callington", postcode: "PL17 8PF", archetype: "House", yearBuilt: "1978", patch: "Patch 3", surveyor: "AS", surveyType: "Condition Only" },
];

const blocks: SeedAsset[] = [
  { kind: "block", uprn: "BLK-1001", assetStatus: "Full Survey", surveyDate: "08/03/2026", surveyedBy: "AS", visit1: "08/03/2026", number: "1", block: "Harbour Court", street: "Quay Street", area: "Bude", city: "Bude", postcode: "EX23 8JZ", archetype: "Low-rise block", yearBuilt: "1972", patch: "Patch 1", surveyor: "AS", surveyType: "Blocks" },
  { kind: "block", uprn: "BLK-1002", assetStatus: "No Visit", number: "2", block: "Valley View", street: "New Road", area: "Bude", city: "Bude", postcode: "EX23 9AP", archetype: "Walk-up", yearBuilt: "1988", patch: "Patch 1", surveyor: "PM", surveyType: "Blocks", siteComments: "Key safe code pending" },
];

const garages: SeedAsset[] = [
  { kind: "garage", uprn: "GAR-501", assetStatus: "Full Survey", surveyDate: "11/03/2026", surveyedBy: "PM", visit1: "11/03/2026", number: "G12", block: "Harbour Court", street: "Quay Street", area: "Bude", city: "Bude", postcode: "EX23 8JZ", archetype: "Garage", yearBuilt: "1972", patch: "Patch 1", surveyor: "PM", surveyType: "Garages" },
  { kind: "garage", uprn: "GAR-502", assetStatus: "No Visit", number: "G14", block: "Harbour Court", street: "Quay Street", area: "Bude", city: "Bude", postcode: "EX23 8JZ", archetype: "Garage", yearBuilt: "1972", patch: "Patch 1", surveyor: "AS", surveyType: "Garages" },
  { kind: "garage", uprn: "GAR-880", assetStatus: "No Access", visit1: "02/04/2026", number: "G3", street: "Trevendon", area: "Callington", city: "Callington", postcode: "PL17 8PF", archetype: "Garage", yearBuilt: "1978", patch: "Patch 3", surveyor: "AS", surveyType: "Garages", siteComments: "Door sticking" },
];

async function main() {
  await prisma.completion.deleteMany();
  await prisma.visitLog.deleteMany();
  await prisma.loaderHistory.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.projectAccess.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  const phil = await prisma.user.create({
    data: {
      username: "phil.m",
      email: "phil.m@savills.com",
      name: "Phil Moon",
      role: "admin",
      passwordHash: await hashPassword("PhilMoon2468"),
      lastTempPassword: "PhilMoon2468",
    },
  });
  const peter = await prisma.user.create({
    data: {
      username: "peter.m",
      name: "Peter May",
      role: "surveyor",
      initials: "PM",
      agency: "Savills",
      passwordHash: await hashPassword("PeterMay2468"),
      lastTempPassword: "PeterMay2468",
    },
  });
  const alex = await prisma.user.create({
    data: {
      username: "alex.s",
      name: "Alex Surveyor",
      role: "surveyor",
      initials: "AS",
      agency: "Savills",
      passwordHash: await hashPassword("AlexSurveyor2468"),
      lastTempPassword: "AlexSurveyor2468",
    },
  });
  const jordan = await prisma.user.create({
    data: {
      username: "client.j",
      name: "Jordan Jones",
      role: "client",
      company: "Cornwall CC",
      clientRole: "Client Contact",
      passwordHash: await hashPassword("ClientJones2468"),
      lastTempPassword: "ClientJones2468",
    },
  });

  const defs = { typeConditionOnly: true, typeConditionEpc: false, typeBlocks: true, typeGarages: true };

  const projects: { name: string; projectManager: string; stage: ProjectStage; extra?: Record<string, boolean> }[] = [
    { name: "Test 1", projectManager: "Greg K", stage: "current" },
    { name: "Test 2", projectManager: "Greg K", stage: "current", extra: { typeConditionEpc: true } },
    { name: "Test 3", projectManager: "Carly M", stage: "upcoming", extra: { typeGarages: false, typeCommercial: true } },
    { name: "Old Demo Job", projectManager: "Tom S", stage: "archive", extra: { typeValidations: true } },
    { name: "Test 4", projectManager: "Greg K", stage: "current" },
    { name: "Test 5", projectManager: "Carly M", stage: "current", extra: { typeConditionEpc: true } },
    { name: "Devon HA", projectManager: "Greg K", stage: "current", extra: { typeGarages: false } },
  ];

  const created = [];
  for (const p of projects) {
    created.push(
      await prisma.project.create({
        data: { ...defs, ...p.extra, name: p.name, projectManager: p.projectManager, stage: p.stage },
      })
    );
  }

  const test1 = created.find((p) => p.name === "Test 1")!;
  const test2 = created.find((p) => p.name === "Test 2")!;
  const old = created.find((p) => p.name === "Old Demo Job")!;

  await prisma.projectAccess.createMany({
    data: [
      { userId: peter.id, projectId: test1.id },
      { userId: peter.id, projectId: test2.id },
      { userId: alex.id, projectId: test1.id },
      { userId: alex.id, projectId: test2.id },
      { userId: jordan.id, projectId: test1.id },
      { userId: jordan.id, projectId: old.id },
    ],
  });

  const stock = [...dwellings, ...blocks, ...garages].map((a) => ({
    projectId: test1.id,
    kind: a.kind,
    uprn: a.uprn,
    assetStatus: a.assetStatus,
    surveyDate: a.surveyDate || "",
    surveyedBy: a.surveyedBy || "",
    visit1: a.visit1 || "",
    visit2: a.visit2 || "",
    visit3: a.visit3 || "",
    number: a.number || "",
    block: a.block || "",
    street: a.street || "",
    area: a.area || "",
    city: a.city || "",
    postcode: a.postcode || "",
    archetype: a.archetype || "",
    yearBuilt: a.yearBuilt || "",
    patch: a.patch || "",
    surveyor: a.surveyor || "",
    surveyType: a.surveyType || "",
    siteComments: a.siteComments || "",
    external: a.external || "",
  }));
  await prisma.asset.createMany({ data: stock });

  await prisma.asset.create({
    data: {
      projectId: test2.id,
      kind: "dwelling",
      uprn: "200040111000",
      assetStatus: "No Visit",
      number: "4",
      street: "Fore Street",
      city: "Holsworthy",
      postcode: "EX22 6EB",
      archetype: "House",
      surveyType: "Condition + EPC",
      surveyor: "PM",
    },
  });

  const demoReports = [
    { name: "Completion Report — Dwellings", type: "PDF", generatedAt: new Date("2026-04-12T10:00:00Z") },
    { name: "Stock Export — Full", type: "XLSX", generatedAt: new Date("2026-04-10T16:30:00Z") },
    { name: "External-only Summary", type: "PDF", generatedAt: new Date("2026-03-28T09:15:00Z") },
  ];
  for (const pid of [test1.id, test2.id, old.id]) {
    await prisma.completion.createMany({
      data: demoReports.map((d) => ({ projectId: pid, ...d, status: "Ready" })),
    });
  }

  console.log("Seeded Savills Cloud Portal demo data.");
  console.log("  Admin     phil.m / PhilMoon2468");
  console.log("  Surveyor  peter.m / PeterMay2468");
  console.log("  Surveyor  alex.s / AlexSurveyor2468");
  console.log("  Client    client.j / ClientJones2468");
  void phil;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
