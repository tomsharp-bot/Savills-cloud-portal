/**
 * Server-side Ideal Postcodes lookup for the public HHSRS site form.
 * The API key stays on the server (Authorization header, never the browser).
 * Docs: https://docs.ideal-postcodes.co.uk/docs/api/addresses
 */

export const IDEAL_POSTCODES_ADDRESSES_URL = "https://api.ideal-postcodes.co.uk/v1/addresses";

export const POSTCODE_MAX_LENGTH = 12;
export const HOUSE_MAX_LENGTH = 80;
export const ADDRESS_MATCH_LIMIT = 12;

const LOOKUP_WINDOW_MS = 60_000;
export const ADDRESS_LOOKUP_MAX_PER_WINDOW = 30;

type Bucket = { count: number; resetAt: number };
const lookupBuckets = new Map<string, Bucket>();

export type AddressMatch = {
  line: string;
  postcode: string;
  uprn: string;
};

/** Loose Ideal Postcodes address record (PAF / AddressBase fields we rank on). */
export type IdealPostcodeAddress = {
  postcode?: unknown;
  line_1?: unknown;
  line_2?: unknown;
  line_3?: unknown;
  post_town?: unknown;
  building_number?: unknown;
  building_name?: unknown;
  sub_building_name?: unknown;
  premise?: unknown;
  organisation_name?: unknown;
  uprn?: unknown;
  suggestion?: unknown;
};

export type LookupFailure = { ok: false; status: number; error: string };
export type LookupSuccess = { ok: true; matches: AddressMatch[] };
export type LookupResult = LookupSuccess | LookupFailure;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const GENERIC_WORDS = new Set([
  "FLAT",
  "FLATS",
  "APARTMENT",
  "APARTMENTS",
  "APT",
  "UNIT",
  "UNITS",
  "HOUSE",
  "THE",
  "NO",
  "NUMBER",
]);

function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function compact(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function words(value: string): string[] {
  return value.toUpperCase().split(/[^A-Z0-9]+/).filter((word) => word.length > 0);
}

export function formatUkPostcode(input: string): string {
  const compactPc = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compactPc.length < 5 || compactPc.length > 7) return input.toUpperCase().replace(/\s+/g, " ").trim();
  return `${compactPc.slice(0, -3)} ${compactPc.slice(-3)}`;
}

export function isUkPostcode(input: string): boolean {
  const compactPc = input.toUpperCase().replace(/\s+/g, "");
  return /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compactPc);
}

/** Single-line address from Ideal Postcodes lines. Postcode stays a separate field. */
export function formatAddressLine(addr: IdealPostcodeAddress): string {
  const parts = [addr.line_1, addr.line_2, addr.line_3, addr.post_town].map(text).filter(Boolean);
  const line: string[] = [];
  for (const part of parts) {
    if (line.length && line[line.length - 1].toLowerCase() === part.toLowerCase()) continue;
    line.push(part);
  }
  if (line.length) return line.join(", ");
  return text(addr.suggestion);
}

/** Prefer the AddressBase UPRN. UDPRN is a different identifier and is not used. */
export function uprnOf(addr: IdealPostcodeAddress): string {
  const raw = text(addr.uprn);
  if (!raw || raw === "0") return "";
  return raw;
}

export function toAddressMatch(addr: IdealPostcodeAddress, fallbackPostcode = ""): AddressMatch {
  const postcode = text(addr.postcode) || fallbackPostcode;
  return {
    line: formatAddressLine(addr),
    postcode,
    uprn: uprnOf(addr),
  };
}

function premiseNumber(addr: IdealPostcodeAddress): string {
  const fromField = compact(text(addr.building_number));
  if (fromField) return fromField;
  const premiseWords = words(text(addr.premise));
  return premiseWords.find((word) => /^\d+[A-Z]?$/.test(word)) || "";
}

function nameWordsOf(addr: IdealPostcodeAddress): string[] {
  return words(
    [addr.sub_building_name, addr.building_name, addr.organisation_name, addr.premise].map(text).filter(Boolean).join(" ")
  );
}

/**
 * Rank a house number/name against one Ideal Postcodes record.
 * 100 exact premise/number/name, 80 number plus name, 60 number only, 40 name only, 0 no match.
 */
export function rankHouseMatch(addr: IdealPostcodeAddress, house: string): number {
  const query = house.trim();
  const qCompact = compact(query);
  const qWords = words(query);
  if (!qCompact || !qWords.length) return 0;

  const fields = [
    text(addr.premise),
    text(addr.building_number),
    text(addr.building_name),
    text(addr.sub_building_name),
    text(addr.organisation_name),
    `${text(addr.sub_building_name)} ${text(addr.building_number)}`.trim(),
    `${text(addr.sub_building_name)} ${text(addr.building_name)}`.trim(),
  ];
  if (fields.some((field) => field && compact(field) === qCompact)) return 100;

  const numberWord = qWords.find((word) => /^\d+[A-Z]?$/.test(word));
  const otherWords = qWords.filter((word) => word !== numberWord);
  const buildingNumber = premiseNumber(addr);
  if (buildingNumber && numberWord && buildingNumber === numberWord) {
    if (!otherWords.length || otherWords.every((word) => GENERIC_WORDS.has(word))) return 60;
    const names = nameWordsOf(addr);
    if (otherWords.every((word) => names.includes(word))) return 80;
    return 0;
  }

  if (qWords.length === 1 && !GENERIC_WORDS.has(qWords[0])) {
    const parts = words(
      [addr.premise, addr.building_number, addr.building_name, addr.sub_building_name, addr.organisation_name]
        .map(text)
        .join(" ")
    );
    if (parts.includes(qWords[0])) return 70;
  }

  if (!numberWord && qCompact.length >= 3 && qWords.some((word) => !GENERIC_WORDS.has(word))) {
    const names = nameWordsOf(addr);
    const specific = qWords.filter((word) => !GENERIC_WORDS.has(word));
    if (specific.length && specific.every((word) => names.includes(word))) return 40;
  }

  return 0;
}

export function matchAddresses(addresses: IdealPostcodeAddress[], house: string, fallbackPostcode = ""): AddressMatch[] {
  const ranked = addresses
    .map((addr, index) => ({ addr, index, rank: rankHouseMatch(addr, house) }))
    .filter((row) => row.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.index - b.index);
  if (!ranked.length) return [];

  const best = ranked[0].rank;
  const floor = best >= 100 ? 100 : best >= 70 ? 70 : best >= 60 ? 60 : 40;
  const seen = new Set<string>();
  const matches: AddressMatch[] = [];
  for (const row of ranked) {
    if (row.rank < floor) continue;
    const match = toAddressMatch(row.addr, fallbackPostcode);
    if (!match.line) continue;
    const key = `${match.uprn}|${match.line}|${match.postcode}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(match);
    if (matches.length >= ADDRESS_MATCH_LIMIT) break;
  }
  return matches;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function extractIdealAddresses(body: unknown): IdealPostcodeAddress[] {
  if (!isRecord(body)) return [];
  const result = body.result;
  if (Array.isArray(result)) return result.filter(isRecord);
  if (!isRecord(result)) return [];
  for (const key of ["hits", "addresses", "results"] as const) {
    const list = result[key];
    if (Array.isArray(list)) return list.filter(isRecord);
  }
  if (text(result.line_1) || text(result.premise) || text(result.uprn)) return [result];
  return [];
}

/** In-memory per-IP limit so a public form cannot burn the Ideal Postcodes quota. */
export function allowAddressLookup(key: string, now = Date.now()): boolean {
  const id = key.trim() || "unknown";
  const current = lookupBuckets.get(id);
  if (!current || now >= current.resetAt) {
    if (lookupBuckets.size > 5000) lookupBuckets.clear();
    lookupBuckets.set(id, { count: 1, resetAt: now + LOOKUP_WINDOW_MS });
    return true;
  }
  if (current.count >= ADDRESS_LOOKUP_MAX_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

export function resetAddressLookupLimits(): void {
  lookupBuckets.clear();
}

function failure(status: number, error: string): LookupFailure {
  return { ok: false, status, error };
}

export async function lookupIdealPostcodes(input: {
  postcode: string;
  house: string;
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
}): Promise<LookupResult> {
  const postcode = input.postcode.replace(/\s+/g, " ").trim();
  const house = input.house.trim();
  if (!postcode || !house) {
    return failure(400, "Enter a postcode and house number or name.");
  }
  if (postcode.length > POSTCODE_MAX_LENGTH || house.length > HOUSE_MAX_LENGTH) {
    return failure(400, "Postcode or house number is too long.");
  }
  if (!isUkPostcode(postcode)) {
    return failure(400, "Enter a valid UK postcode.");
  }
  const apiKey = text(input.apiKey);
  if (!apiKey) {
    return failure(503, "Address lookup is not configured.");
  }

  const compactPc = postcode.toUpperCase().replace(/\s+/g, "");
  const url = `${IDEAL_POSTCODES_ADDRESSES_URL}?postcode=${encodeURIComponent(compactPc)}`;
  const fetchImpl = input.fetchImpl || fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Authorization: `api_key="${apiKey.replace(/"/g, "")}"`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return failure(502, "Address lookup is unavailable. Try again or enter the address manually.");
  }

  if (response.status === 404) {
    await response.text().catch(() => "");
    return { ok: true, matches: [] };
  }
  if (response.status === 402) {
    await response.text().catch(() => "");
    return failure(503, "Address lookup has no lookups remaining.");
  }
  if (!response.ok) {
    await response.text().catch(() => "");
    return failure(502, "Address lookup is unavailable. Try again or enter the address manually.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return failure(502, "Address lookup returned an unexpected response.");
  }

  const code = isRecord(body) && body.code !== undefined ? Number(body.code) : 2000;
  if (code === 4040 || code === 404) return { ok: true, matches: [] };

  const fallback = formatUkPostcode(compactPc);
  return { ok: true, matches: matchAddresses(extractIdealAddresses(body), house, fallback) };
}
