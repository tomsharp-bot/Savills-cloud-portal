/**
 * Client email subject/body builders ported from the desktop Reporter
 * (templates.py + the engine helpers it calls). Wording rules stay deterministic.
 */

export class DraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftError";
  }
}

export const ONWARD_TOPICS = [
  "CO",
  "Fire",
  "Electrical",
  "Damp / Mould Growth",
  "Falls on stairs",
  "Falls on level",
  "Falls between levels",
  "Falls Baths",
  "Entrapment",
  "Hygiene",
  "Crowding",
  "Cold",
  "Intruders",
  "Structural",
  "Sanitation",
  "Heat",
  "Asbestos",
  "Hot surfaces",
  "Explosions",
  "Ergonomics",
  "Water Supply",
  "Lighting",
  "Noise",
  "Food Safety",
  "Lead",
  "Fuel gas",
] as const;

export type OnwardTopic = (typeof ONWARD_TOPICS)[number];

export type CallOutcome = "Completed" | "Attempted" | "Not yet called" | "Not required" | "";

export type DraftCase = {
  project: string;
  address: string;
  hazard: string;
  rating: string;
  description: string;
  descriptionReady?: boolean;
  uprn?: string;
  surveyDate?: string;
  callStatus?: CallOutcome | string;
  callRef?: string;
  callNotes?: string;
  suspectedCause?: string;
  includeCause?: boolean;
  vulnerabilities?: string;
  includeVulnerabilities?: boolean;
  escalation?: string;
  workOrder?: string;
  cat1Confirmed?: boolean;
  onwardTopic?: string;
  extraHazards?: DraftCase[];
};

export type TemplateId =
  | "Cornwall"
  | "BPHA"
  | "LFHA"
  | "Onward"
  | "Vico Homes"
  | "A2Dominion"
  | "Bristol"
  | "Standard"
  | "";

const POSTCODE =
  /(?<![A-Z0-9])((?:GIR|[A-PR-UWYZ][A-HK-Y]?\d[\dA-HJKPSTUW]?))\s*(\d[ABD-HJLNP-UW-Z]{2})(?![A-Z0-9])/gi;

const SPELLING_FIXES: Record<string, string> = {
  substatial: "substantial",
  substanial: "substantial",
  substancial: "substantial",
  molud: "mould",
  muold: "mould",
  moud: "mould",
  electical: "electrical",
  eletrical: "electrical",
  elecrical: "electrical",
  hazrads: "hazards",
  hazrad: "hazard",
  hazrard: "hazard",
  proeprty: "property",
  propery: "property",
  proprty: "property",
  througout: "throughout",
  throuhout: "throughout",
  throughtout: "throughout",
  presnt: "present",
  gorwth: "growth",
  celing: "ceiling",
  cieling: "ceiling",
  bathrom: "bathroom",
  kichen: "kitchen",
  kitchn: "kitchen",
  cupbord: "cupboard",
  misssing: "missing",
  missng: "missing",
  damged: "damaged",
  damagd: "damaged",
  exsposed: "exposed",
  expsed: "exposed",
  wireing: "wiring",
  dectector: "detector",
  detecor: "detector",
  detctor: "detector",
  suspeted: "suspected",
  suspeced: "suspected",
  leeking: "leaking",
  resdient: "resident",
  residnet: "resident",
  resdients: "residents",
  disabilites: "disabilities",
  vulnerabilites: "vulnerabilities",
  vunerabilities: "vulnerabilities",
  attemtped: "attempted",
  atempted: "attempted",
  recieved: "received",
  reprot: "report",
  reproted: "reported",
  contatced: "contacted",
  strcutural: "structural",
  strucutral: "structural",
  collpase: "collapse",
  loosee: "loose",
  poiting: "pointing",
  moratr: "mortar",
};

export function templateId(project: string): TemplateId {
  if (project.startsWith("Cornwall")) return "Cornwall";
  if (project.startsWith("BPHA")) return "BPHA";
  if (project.startsWith("LFHA")) return "LFHA";
  if (project.startsWith("Onward")) return "Onward";
  if (/^VICO\b/i.test(project)) return "Vico Homes";
  if (/^(?:A2D|A2Dominion)\b/i.test(project)) return "A2Dominion";
  if (project.startsWith("Bristol")) return "Bristol";
  return project.trim() ? "Standard" : "";
}

export function correctReportSpelling(text: string): string {
  const replaceWord = (word: string): string => {
    const replacement = SPELLING_FIXES[word.toLowerCase()];
    if (!replacement) return word;
    if (word === word.toUpperCase()) return replacement.toUpperCase();
    if (word[0] === word[0].toUpperCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
  };
  return String(text || "").replace(/\S+/g, (value) => {
    if (value.includes("@") || value.includes("/") || value.includes("-") || /\d/.test(value)) {
      return value;
    }
    return value.replace(/\b[A-Za-z]+\b/g, replaceWord);
  });
}

function addressCase(part: string): string {
  return part.replace(/[A-Za-z]+(?:['’][A-Za-z]+)?/g, (word) =>
    word === word.toUpperCase() && word.length > 1
      ? word[0].toUpperCase() + word.slice(1).toLowerCase()
      : word
  );
}

export function formatAddress(value: string): string {
  let text = value.trim().replace(/\b(flat\s+\d+[A-Za-z]?)\s+(?=\d+[A-Za-z]?\s+[A-Za-z])/gi, "$1, ");
  text = text.replace(/\s*,\s*/g, ", ");
  text = text.replace(/\s+/g, " ").replace(/[. ]+$/, "");
  text = text.replace(new RegExp(`\\.\\s*(?=${POSTCODE.source})`, "gi"), ", ");
  const parts: string[] = [];
  let end = 0;
  POSTCODE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = POSTCODE.exec(text))) {
    parts.push(addressCase(text.slice(end, match.index)));
    parts.push(`${match[1].toUpperCase()} ${match[2].toUpperCase()}`);
    end = match.index + match[0].length;
  }
  parts.push(addressCase(text.slice(end)));
  return parts.join("").replace(/\s*,\s*/g, ", ");
}

export function includeVulnerabilities(data: Pick<DraftCase, "project" | "includeVulnerabilities">): boolean {
  return /^VICO(?:\b|_)/i.test(data.project || "") || data.includeVulnerabilities === true;
}

export function splitVulnerabilities(description: string): [string, string, boolean] {
  const facts: string[] = [];
  const retained: string[] = [];
  let mixed = false;
  for (const part of description.split(/(?<=[.!?])\s+|\n+/)) {
    if (!part.trim()) continue;
    const resident = /\bvulnerab\w*\b|\bdisabilit\w*\b|\bdisabled\b|\bwheelchair\b|\byoung children\b/i.test(part);
    const hazard = /\bmould\b|\bdamp\b|\bleak\b|\bwires?\b|\bdetector\b|\broof\b|\bsocket\b|\bfire\b/i.test(part);
    if (resident) {
      facts.push(part.trim());
      if (hazard) {
        retained.push(part.trim());
        mixed = true;
      }
    } else {
      retained.push(part.trim());
    }
  }
  return [facts.length || retained.length ? retained.join(" ") : "", facts.join(" "), mixed];
}

export function sentence(text: string): string {
  text = correctReportSpelling(text).split(/\s+/).join(" ").trim();
  if (text && !/[.!?]$/.test(text)) text += ".";
  return text;
}

export function tidyHazardSentence(text: string): string {
  text = text.split(/\s+/).join(" ").trim();
  const rooms =
    "(?:kitchen|bathroom|bedroom|lounge|hallway|hall|landing|living room|outbuilding|staircase|consumer unit|roof|ceiling)";
  text = text.replace(new RegExp(`\\b(in|to|from|on)\\s+(${rooms})\\b`, "gi"), (_m, prep: string, room: string) => {
    return `${prep} the ${room.toLowerCase()}`;
  });
  if (/\b(?:is|are|was|were|has|have|had)\b/i.test(text)) {
    return sentence(text[0].toUpperCase() + text.slice(1));
  }
  const singular =
    "(?:socket|switch|light fitting|smoke alarm|fire alarm|CO alarm|blanking plate|consumer unit cover|handrail|window restrictor|ridge tile|roof tile|window|door|boundary wall|retaining wall)";
  const plural =
    "(?:sockets|switches|light fittings|smoke alarms|fire alarms|blanking plates|window restrictors|roof tiles|ridge tiles|cables|wires)";
  const fault = "(?:damaged|broken|loose|missing|exposed|unstable)";
  const note = text.replace(/\.+$/, "");
  const location = "(?:\\s+(?:in|on|to|from)\\s+the\\s+[A-Za-z -]+)?";
  let m = note.match(new RegExp(`^(?:an?\\s+)?(${fault})\\s+(${singular})(${location})$`, "i"));
  if (m) return sentence(`The ${m[2].toLowerCase()}${m[3]} is ${m[1].toLowerCase()}`);
  m = note.match(new RegExp(`^(${fault})\\s+(${plural})(${location})$`, "i"));
  if (m) return sentence(`There are ${m[1].toLowerCase()} ${m[2].toLowerCase()}${m[3]}`);
  m = note.match(new RegExp(`^(?:the\\s+)?(${singular})(${location})\\s+(${fault})$`, "i"));
  if (m) return sentence(`The ${m[1].toLowerCase()}${m[2]} is ${m[3].toLowerCase()}`);
  m = note.match(new RegExp(`^(?:the\\s+)?(${plural})(${location})\\s+(${fault})$`, "i"));
  if (m) return sentence(`The ${m[1].toLowerCase()}${m[2]} are ${m[3].toLowerCase()}`);
  return text ? sentence(text[0].toUpperCase() + text.slice(1)) : text;
}

export function causeSentence(text: string): string {
  text = text.trim().replace(/\.+$/, "").trim();
  if (!text) return "";
  text = text.replace(/^(?:Suspected(?: cause)?|Reported cause|Cause)\s*:?\s*/i, "");
  if (!text) return "";
  if (/^(?:a )?leak from (?:the )?flat above$/i.test(text)) text = "a leak from the flat above";
  else if (text[0] === text[0].toUpperCase() && text.split(/\s+/)[0] !== text.split(/\s+/)[0].toUpperCase()) {
    text = text[0].toLowerCase() + text.slice(1);
  }
  return "Suspected cause: " + sentence(text);
}

function roomRegex(): RegExp {
  return /\b(?:(?:children['’]s|main|master|front|rear|first|second|third|upstairs|downstairs|ground[- ]floor|first[- ]floor)\s+)?(?:bedrooms?(?:\s+\d+)?|bathrooms?|kitchens?|living rooms?|lounges?|dining rooms?|hallways?|halls?|landings?|utility rooms?|shower rooms?|toilets?|stairwells?|cellars?|basements?|lofts?|attics?|conservatories|conservatory)\b/gi;
}

function _clientDescription(text: string, hazard: string): string {
  text = correctReportSpelling(text).split(/\s+/).join(" ").trim();
  if (!text) throw new DraftError("Add the hazard description.");
  text = text.replace(/\bhall way\b/gi, "hallway");
  text = text
    .replace(
      /\b(?:the\s+)?tenants?[’']?\s+(?:new\s+)?(?:phone\s+|telephone\s+|mobile\s+|contact\s+)?number\s*:?\s*[+\d][\d ()-]{7,}[.]?/gi,
      ""
    )
    .trim();
  if (hazard === "Electrical Hazards") {
    text = text.replace(/\s+electrical(?:\s+hazard)?[.]?$/i, "");
  }

  if (/\b(?:From|To|Cc|Subject):|<[^<>]*@[^<>]*>/i.test(text)) {
    throw new DraftError(
      "Please check the highlighted text. Keep only what is wrong and where it is; remove names, email addresses and greetings."
    );
  }

  if (hazard === "Fire & Explosions") {
    let m = text.match(/^Smoke alarm fixtures missing (.+?)[.]?$/i);
    if (m) {
      let location = m[1].replace(/\.+$/, "");
      if (location.toLowerCase() === "kitchen landing and top floor") {
        location = "kitchen, landing and top floor";
      }
      return "Smoke alarm fixtures are missing from the " + location + ".";
    }
    m = text.match(
      /^(?:a\s+)?(damaged|broken|faulty|missing) (?:smoke|fire) alarm in (?:the\s+)?(hall|hallway|kitchen|bedroom|landing|living room)[.!]?$/i
    );
    if (m) return "The fire alarm in the " + m[2].toLowerCase() + " is " + m[1].toLowerCase() + ".";
  }

  if (hazard === "Carbon Monoxide & Indoor Air Pollutants") {
    const gas = text.match(/^(?:Slight\s+)?(?:smell|odou?r) of gas in (?:the )?(.+?)(?:\s+Att needed)?[.]?$/i);
    if (gas) return "A smell of gas has been reported in the " + gas[1].toLowerCase().replace(/\.+$/, "") + ".";
    if (/^No carbon(?: monoxide)? alarm[.]?$/i.test(text)) return "There is no carbon monoxide alarm.";
  }

  if (hazard === "Electrical Hazards") {
    let m = text.match(/^No ceiling rose[, ]+exposed wires in (?:the )?(.+?)[.]?$/i);
    if (m) return "The ceiling rose is missing, leaving exposed wires in the " + m[1] + ".";
    const shock = text.match(
      /\btenn?ant experiencing (?:electric|electrical) shocks in (?:the )?([A-Za-z ]+?)(?= which|[.,]|$)/i
    );
    if (shock) {
      let wording = "The tenant reports electric shocks in the " + shock[1].trim();
      const when = text.match(/Incident happened (\d+) months? ago/i);
      if (when) wording += ", with an incident reported " + when[1] + " months ago";
      return wording + ".";
    }
    m = text.match(/^(?:the )?ceiling rose in (?:the )?(.+?) loose from (?:the )?ceiling[.]?$/i);
    if (m) return "The ceiling rose in the " + m[1] + " is loose from the ceiling.";
    m = text.match(/^(?:the )?(.+?) light not working (?:and )?(?:its )?(?:cover missing|missing cover)[.]?$/i);
    if (m) return "The " + m[1].toLowerCase() + " light is not working and its cover is missing.";
    m = text.match(/^Exposed wire to (?:the )?(.+?) ceiling[.]?$/i);
    if (m) return "There is an exposed wire on the " + m[1] + " ceiling.";
    if (/^Missing fuse in (?:the )?consumer unit[.]?$/i.test(text)) {
      return "There is a missing fuse in the consumer unit.";
    }
    m = text.match(/^Broken electrical socket (?:in )?(?:the )?(.+?)[.]?$/i);
    if (m) return "There is a broken electrical socket in the " + m[1].replace(/\.+$/, "") + ".";
    m = text.match(
      /^(?:a\s+)?(damaged|broken|loose) light fitting in (?:the\s+)?(lounge|kitchen|bedroom|bathroom|hall|hallway|living room|outbuilding)[.!]?$/i
    );
    if (m) return "The light fitting in the " + m[2].toLowerCase() + " is " + m[1].toLowerCase() + ".";
    m = text.match(
      /^Exposed wiring\s*[-–—]\s*(?:a\s+)?strip light in (?:the\s+)?(kitchen|bedroom|bathroom|hallway|living room|outbuilding)[.!]?$/i
    );
    if (m) return "There is exposed wiring to the strip light in the " + m[1].toLowerCase() + ".";
    m = text.match(
      /^(?:a\s+)?(damaged|broken|loose) socket in (?:the\s+)?(outbuilding|kitchen|bedroom|bathroom|living room|hallway)[.!]?$/i
    );
    if (m) return "There is a " + m[1].toLowerCase() + " socket in the " + m[2].toLowerCase() + ".";
    if (
      /^Exposed cables in (?:the )?bathroom ceiling[.]?\s*(?:(?:The )?Tenn?ant says (?:they (?:are|are not)|not) live[.]?)?$/i.test(
        text
      )
    ) {
      let wording = "There are exposed cables in the bathroom ceiling.";
      if (/\bTenn?ant says (?:they are not|not) live/i.test(text)) {
        wording += " The tenant reports that the cables are not live.";
      } else if (/\bTenn?ant says they are live/i.test(text)) {
        wording += " The tenant reports that the cables are live.";
      }
      return wording;
    }
    if (/^(?:an?\s+)?electrical socket hanging from (?:the\s+)?ceiling in (?:the\s+)?cupboard[.!]?$/i.test(text)) {
      return "An electrical socket is hanging from the ceiling in the cupboard.";
    }
    if (
      /^(?:the\s+)?shower cover is missing\s*(?:,?\s*and\s+there are exposed electrics|,?\s*exposing electrical components)(?:[.,]?\s*(?:however\s+)?(?:the\s+)?shower has been isolated from the consumer unit)?[.!]?$/i.test(
        text
      )
    ) {
      let wording = "The shower cover is missing, exposing electrical components.";
      if (/shower has been isolated from the consumer unit/i.test(text)) {
        wording += " The shower has been isolated from the consumer unit.";
      }
      return wording;
    }
    if (
      /^(?:the\s+)?(?:CUU?|consumer unit(?:'s)?)\s+front housing\s+(?:fell off|became detached)\s+when\s+(?:I|we)\s+(?:tried to open|opened)\s+(?:the\s+)?front cover[.!]?$/i.test(
        text
      )
    ) {
      return "The consumer unit’s front housing became detached when the front cover was opened.";
    }
  }

  if (hazard === "Entry By Intruders") {
    let observation = text.replace(/\bgrnd\s+fl\./gi, "ground-floor").replace(/\bgnd\s+fl\./gi, "ground-floor");
    const window = observation.match(
      /\b(?:(ground-floor|first-floor)\s+)?window to (?:the )?(living room|bedroom|kitchen|bathroom|lounge)\s+(?:has (?:a )?)?broken (handle\s*\/\s*mechanism|handle|mechanism)\b/i
    );
    if (window && !/\b(?:not|no longer|repaired|replaced)\b/i.test(observation)) {
      const location = ((window[1] ? window[1].toLowerCase() + " " : "") + window[2].toLowerCase()).trim();
      const fault = window[3].toLowerCase().replace(/\s*\/\s*/g, "/");
      let detail = "The " + location + " window has a broken " + fault;
      if (/\bpermanently unlocked\b/i.test(observation)) detail += ", leaving it unlocked";
      if (/possible to pull open from (?:a )?publicly accessible area/i.test(observation)) {
        detail +=
          (/\bpermanently unlocked\b/i.test(observation) ? " and openable" : ", openable") +
          " from a publicly accessible area";
      }
      return detail + ".";
    }
  }

  if (/\bX{3,}\b/i.test(text)) {
    throw new DraftError("Replace XXXX with the room or location mentioned in the email.");
  }

  if (/damp|mould/i.test(hazard)) {
    const conditionText = text.replace(/\b(?:no|not|without|free of)\s+(?:signs? of\s+)?(?:damp(?:ness)?|mould|mold)\b/gi, "");
    const damp = /\bdamp(?:ness)?\b/i.test(conditionText);
    const mould = /\b(?:mould|mold)\b/i.test(conditionText);
    const condition = damp && mould ? "damp / mould" : mould ? "mould" : "damp";
    let m = text.match(/^(?:black\s+)?(mould|mold|damp) in (?:the )?cupboard in (?:the )?(.+?)[.]?$/i);
    if (m) {
      return (
        "There is " +
        m[1].toLowerCase().replace("mold", "mould") +
        " in the cupboard in the " +
        m[2].toLowerCase().replace(/\.+$/, "") +
        "."
      );
    }
    if (
      /^(?:severe\s+)?damp (?:black\s+)?mould witnessed in all bedrooms and in (?:add\/wc|additional WC) on (?:the )?wall behind (?:the )?toilet (?:system|cistern)\s+as well as (?:the )?main bathroom\s+walls and ceiling[.]?$/i.test(
        text
      )
    ) {
      return "There is damp / mould in all bedrooms, on the wall behind the toilet cistern in the additional WC, and on the main bathroom walls and ceiling.";
    }
    if (/bathroom has\s+(?:severe\s+)?mould growth on the ceiling and the lounge walls? (?:are|is) also damp/i.test(text)) {
      return "There is mould on the bathroom ceiling and damp on the lounge walls.";
    }
    const located = text.match(
      /\b(damp|mould|mold)(?: growth)?(?: identified)?\s+(?:in|on)\s+(?:the )?((?:(?:upstairs|downstairs|rear|front|main)\s+)?(?:shower room|bathroom|bedroom|kitchen|lounge))\s+(?:on (?:the )?)?(ceiling|walls?)\b/i
    );
    if (located && (text.match(/\b(?:damp|mould|mold)\b/gi) || []).length === 1) {
      return (
        "There is " +
        located[1].toLowerCase().replace("mold", "mould") +
        " on the " +
        located[2].toLowerCase() +
        " " +
        located[3].toLowerCase() +
        "."
      );
    }
    const locations: string[] = [];
    const excluded: string[] = [];
    let throughout = false;
    let allRooms = false;
    let found = false;
    const room = roomRegex();
    for (let part of text.split(/(?<=[.!?])\s+/)) {
      part = part.split(/\b(?:leading to|resulting in|causing|because|due to)\b/i)[0];
      if (!/\b(?:damp|mould|mold)\b/i.test(part)) continue;
      if (/\b(?:no|not|without|free of)\b.{0,25}\b(?:damp|mould|mold)\b/i.test(part)) continue;
      if (/\b(?:suspected|possible|potential|may be|might be)\b.{0,30}\b(?:damp|mould|mold)\b/i.test(part)) {
        throw new DraftError(
          "The damp / mould is described as uncertain. Check and enter a factual description before preparing the client email."
        );
      }
      found = true;
      const exception = part.match(/\b(?:apart from|except(?: for)?|excluding|other than|(?:but )?not in|with the exception of)\b/i);
      if (exception && exception.index !== undefined) {
        const scope = part.slice(0, exception.index);
        const exclusions = part.slice(exception.index + exception[0].length);
        if (/\b(?:but|however|although)\b/i.test(exclusions)) {
          throw new DraftError("Please check which rooms have damp or mould and which do not.");
        }
        const roomsFound = [...exclusions.matchAll(roomRegex())].map((x) => x[0].toLowerCase());
        if (!roomsFound.length) {
          throw new DraftError("Please check which rooms have damp or mould and which do not.");
        }
        for (const location of roomsFound) {
          if (!excluded.includes(location)) excluded.push(location);
        }
        part = scope;
      }
      if (/\b(?:all|every)\s+(?:the\s+)?rooms?\b/i.test(part)) allRooms = true;
      part = part.split(/\b(?:but|although|however)\b|\b(?:not in|none in|no evidence in)\b/i)[0];
      if (
        /\b(?:throughout|across (?:the )?(?:whole|entire))\s+(?:(?:the|this)\s+)?(?:whole\s+|entire\s+)?(?:property|home|house|flat|dwelling)\b/i.test(
          part
        )
      ) {
        throughout = true;
      }
      room.lastIndex = 0;
      for (const rm of part.matchAll(roomRegex())) {
        let location = rm[0].toLowerCase();
        if (/\bboth\s+(?:of\s+)?(?:the\s+)?(?:(?:big|large|small)\s+)?$/i.test(part.slice(0, rm.index))) {
          location = "both " + location;
        }
        if (!locations.includes(location)) locations.push(location);
      }
    }
    if (!found) {
      throw new DraftError("Please check the surveyor’s email and describe where damp or mould is present.");
    }
    if (locations.some((location) => excluded.includes(location))) {
      throw new DraftError(
        "A room is both included and excluded in the damp / mould description. Check the locations before preparing the email."
      );
    }
    if (excluded.length && (allRooms || throughout)) {
      const where =
        excluded.length === 1 ? excluded[0] : excluded.slice(0, -1).join(", ") + " and " + excluded[excluded.length - 1];
      const scope = allRooms ? "in all rooms" : "throughout the property";
      return "There is " + condition + " " + scope + " except the " + where + ".";
    }
    if (excluded.length && !locations.length) {
      throw new DraftError("Please say which rooms have damp or mould.");
    }
    if (allRooms) return "There is " + condition + " in all rooms.";
    if (throughout) return "There is " + condition + " throughout the property.";
    if (locations.length) {
      const where =
        locations.length === 1
          ? locations[0]
          : locations.slice(0, -1).join(", ") + " and " + locations[locations.length - 1];
      return "There is " + condition + " in " + (where.startsWith("both ") ? "" : "the ") + where + ".";
    }
    const level = text.match(/\b(upstairs|downstairs)\b/i);
    if (level) return "There is " + condition + " " + level[1].toLowerCase() + ".";
    return "There is " + condition + " in the property.";
  }

  if (hazard === "Falling On Stairs Etc." && /^Top floor staircase large gap in timber potential trip[.\s]*$/i.test(text)) {
    return "There is a large gap in the timber on the top-floor staircase, presenting a potential trip hazard.";
  }

  if (hazard === "Structural Collapse & Falling Elements") {
    if (/^internal wall cracks\s*[-–—]?\s*bedroom ceiling witnessed[.]?$/i.test(text)) {
      return "Cracks have been reported in the internal wall and bedroom ceiling.";
    }
    if (/^Retaining\s+wall\s*[-–—]?\s*pillars\s+(?:completely\s+)?split at (?:the )?joints?[.]?$/i.test(text)) {
      return "The retaining wall pillars are split at the joints.";
    }
    if (/\bConcrete pillar has come away from (?:the )?bay window at first floor level[.]?/i.test(text)) {
      let wording = "The concrete pillar has come away from the bay window at first-floor level.";
      if (/\bIt has been shored up with timber bracing\b/i.test(text)) {
        wording += " It has been shored up with timber bracing.";
      }
      return wording;
    }
    if (/^(?:the )?lintels to the rear appear to be breaking away\b/i.test(text)) {
      return "The lintels at the rear of the property appear to be breaking away.";
    }
  }

  let first = text.split(/(?<=[.!?])\s+/, 2)[0];
  first = first.replace(
    /\b(?:substantial|substantially|extensive|extensively|significant|significantly|minor|major|severe|severely)\s+/gi,
    ""
  );
  if (
    /blanking plates?\b.{0,35}\bmissing\b|missing\s+blanking plates?\b/i.test(first) &&
    /\bconsumer unit\b/i.test(first) &&
    !/\b(?:not|no longer)\s+missing\b/i.test(first)
  ) {
    first = first.replace(
      /,?\s+(?:and|which|that)\s+(?:(?:it|this|the opening|the gap)\s+)?(?:has\s+(?:only\s+)?been|is|was)\s+(?:only\s+)?covered\s+(?:only\s+)?(?:with|by|in)\s+(?:electrical|insulation|insulating)\s+tape\b/gi,
      ""
    );
  }
  first = first.split(/,?\s+\b(?:leading to|resulting in|allowing access to)\b/i)[0];
  first = first.replace(/^[,; ]+|[,; ]+$/g, "");
  if (!first) throw new DraftError("Enter a brief factual hazard description.");
  return sentence(first[0].toUpperCase() + first.slice(1));
}

export function clientDescription(text: string, hazard: string): string {
  return tidyHazardSentence(_clientDescription(text, hazard));
}

export function callUpdate(data: DraftCase): string {
  const outcome = data.callStatus || "";
  const reference = (data.callRef || "").trim();
  let notes = sentence(data.callNotes || "");
  const centre = templateId(data.project) === "Onward" ? "the Onward Call Centre" : "the contact centre";
  if (outcome === "Completed") {
    let text = reference
      ? `Call reference: ${reference}.`
      : `Called ${centre}. No reference supplied.`;
    if (reference && templateId(data.project) === "Onward") text = `Onward Call Reference: ${reference}`;
    return text + (notes ? " " + notes : "");
  }
  if (outcome === "Attempted") {
    if (!notes) {
      notes =
        templateId(data.project) === "Onward"
          ? "We were unable to contact the Onward Call Centre to report the issue."
          : "Attempted to call; unable to make contact.";
    }
    const noAnswer =
      /^(?:(?:I |We )?(?:tried|attempted) to call(?: the (?:call|contact) centre)?\s*[,;–—-]?\s*)?(?:no answer|no response|no one answered)[.!]?$/i.test(
        notes
      );
    if (templateId(data.project) === "Onward") {
      const wording = "We were unable to contact the Onward Call Centre to report the issue.";
      if (
        noAnswer ||
        /^(?:Unable to (?:contact|call|get through)(?: the Onward Call Centre)?|Could not get through|We were unable to contact the Onward Call Centre to report the issue)[.!]?$/i.test(
          notes
        )
      ) {
        notes = wording;
      }
    } else if (noAnswer) {
      notes = `Attempted to contact ${centre}; no answer.`;
    }
    const label = templateId(data.project) === "Onward" ? "Onward Call Reference: " : "Call reference: ";
    return notes + (reference ? " " + label + reference : "");
  }
  if (outcome === "Not yet called") return "Contact centre call pending." + (notes ? " " + notes : "");
  if (outcome === "Not required") {
    if (reference || notes) {
      throw new DraftError("Call details are entered but the call is marked Not required. Check the outcome.");
    }
    return "";
  }
  if (reference || notes) {
    throw new DraftError("Select the call outcome so an attempted call is not described as completed.");
  }
  return "";
}

function normalKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mapHazardName(hazard: string, template: TemplateId): string {
  const names: Record<string, string> = {
    dampmould: "Damp / Mould Growth",
    dampmouldgrowth: "Damp / Mould Growth",
    fire: "Fire",
    electricalhazards: "Electrical Hazards",
    carbonmonoxideandfuelcombustion: "Carbon Monoxide & Fuel Combustion",
    carbonmonoxidefuelcombustion: "Carbon Monoxide & Fuel Combustion",
    structuralcollapseandfallingelements: "Structural Collapse & Falling Elements",
    structuralcollapsefallingelements: "Structural Collapse & Falling Elements",
    fallsassociatedwithstairsandsteps: "Falls Associated with Stairs & Steps",
    fallsbetweenlevels: "Falls Between Levels",
  };
  let mapped = names[normalKey(hazard)] || hazard;
  if (
    template === "Onward" &&
    ["carbonmonoxidefuelcombustion", "carbonmonoxideandfuelcombustion", "fuelcombustionproductsco"].includes(
      normalKey(hazard)
    )
  ) {
    mapped = "Fuel Combustion Products (CO)";
  }
  return mapped;
}

export function baseProjectDraft(data: DraftCase, photos: string[]): { subject: string; body: string } {
  const template = templateId(data.project);
  if (!template) throw new DraftError("No client email template has been supplied for this project yet.");
  const address = formatAddress(data.address || "");
  if (!address) throw new DraftError("Add the property address before preparing the client email.");

  let description = data.descriptionReady
    ? (data.description || "").trim()
    : clientDescription(data.description || "", data.hazard || "");

  if (/\b(?:From|To|Cc|Subject):|<[^<>]*@[^<>]*>/i.test(description)) {
    throw new DraftError("Keep only the fault and location in the hazard description.");
  }

  if (
    template === "Vico Homes" &&
    !data.descriptionReady &&
    data.hazard !== "Entry By Intruders" &&
    data.hazard !== "Electrical Hazards"
  ) {
    const observation = correctReportSpelling(data.description || "")
      .trim()
      .split(/(?<=[.!?])\s+/, 2)[0];
    if (!/\bthroughout the property\b/i.test(observation)) {
      description = tidyHazardSentence(
        observation.replace(/\b(?:substantial|extensive|significant|severe)\s+/gi, "")
      );
    }
  }

  if (!description) throw new DraftError("Add the short hazard description.");
  if (splitVulnerabilities(description)[1]) {
    throw new DraftError(
      "Move resident vulnerability details out of the hazard description and into the separate vulnerabilities box before preparing the email."
    );
  }
  if (/\bX{3,}\b/i.test(description)) {
    throw new DraftError("Replace XXXX with the room or location mentioned in the email.");
  }

  const rating = (data.rating || "").trim();
  if (!rating) throw new DraftError("Select the surveyor’s rating.");

  let hazard = mapHazardName(data.hazard, template);
  let prefix = template === "Cornwall" ? "Cornwall 2026" : template;
  if (template === "Standard") prefix = data.project.trim();
  let subject = `${prefix} - HHSRS – ${address}`;

  if (template === "Vico Homes") {
    subject =
      "Vico Homes - HHSRS" +
      (/damp|mould/i.test(data.hazard) ? " D&M" : "") +
      " - " +
      address;
    if (data.hazard.includes("Carbon Monoxide")) hazard = "Carbon Monoxide and Fuel Combustion";
  }
  if (template === "Onward" && data.hazard === "Fire & Explosions") hazard = "Fire";
  if (template === "Bristol") {
    const year = data.project.match(/\b20\d{2}\b/);
    prefix = "Bristol" + (year ? " " + year[0] : "");
    const uprn = (data.uprn || "").trim();
    if (!uprn) throw new DraftError("Bristol’s supplied subject requires the UPRN.");
    subject =
      `${prefix} - HHSRS - ` + (year && year[0] === "2025" ? "UPRN " : "") + uprn + " - " + address;
  }
  if (template === "Onward") {
    if (!data.cat1Confirmed) {
      throw new DraftError(
        "Confirm Category 1 from the survey information before using Onward’s CAT1 subject. Severe alone is not treated as confirmation."
      );
    }
    const uprn = (data.uprn || "").trim();
    const topic = data.onwardTopic || "";
    if (!uprn) throw new DraftError("Onward’s subject requires the UPRN.");
    if (!(ONWARD_TOPICS as readonly string[]).includes(topic)) {
      throw new DraftError("Select the Onward subject hazard from the list.");
    }
    subject = `Onward 2026 – HHSRS CAT1 (${topic}) – UPRN ${uprn} - ${address}`;
    if (!data.surveyDate) {
      throw new DraftError("Check the survey date for Onward. It defaults to the original email date.");
    }
    // Validate ISO date (YYYY-MM-DD or full ISO)
    const survey = new Date(data.surveyDate);
    if (Number.isNaN(survey.getTime())) throw new DraftError("Check the survey date for Onward.");
    if (!data.callStatus) {
      throw new DraftError(
        "Select the actual call outcome for Onward, including Not yet called if it is still pending."
      );
    }
  }

  let intro =
    (photos.length === 1
      ? "Attached is a photo taken from "
      : photos.length > 1
        ? "Attached are photos taken from "
        : "One of our surveyors has visited ") +
    (photos.length ? address + "." : address + ".");
  if (template === "BPHA") intro = "One of our surveyors has visited " + address + ".";

  let lines: string[] = [
    "Hi all,",
    "",
    intro,
    description + ` We have recorded this as ${rating} for ${hazard} on the HHSRS.`,
  ];
  if (template === "Onward") {
    const iso = data.surveyDate!.slice(0, 10);
    lines.push("", "Survey date: " + iso);
  }
  const call = callUpdate(data);
  if (call) lines.push(call);

  if (template === "Vico Homes") {
    lines = ["Hi all,", "", intro, description];
    if (data.suspectedCause && data.includeCause !== false) lines.push(causeSentence(data.suspectedCause));
    if ((data.vulnerabilities || "").trim()) lines.push(sentence(data.vulnerabilities || ""));
    lines.push(`We have recorded this as ${rating} for ${hazard} on the HHSRS.`);
    if (data.escalation) {
      const a = "aeiou".includes(data.escalation[0].toLowerCase()) ? "an " : "a ";
      lines.push("We have categorised this as " + a + data.escalation + " hazard.");
    }
    if (call) lines.push(call);
  }
  if (template !== "Vico Homes" && data.suspectedCause && data.includeCause !== false) {
    lines.push(causeSentence(data.suspectedCause));
  }
  if (template !== "Vico Homes" && includeVulnerabilities(data) && (data.vulnerabilities || "").trim()) {
    lines.push("", "Resident vulnerabilities: " + sentence(data.vulnerabilities || ""));
  }
  if ((data.workOrder || "").trim()) lines.push("Work order number: " + data.workOrder!.trim());
  if (template === "A2Dominion" && (data.uprn || "").trim()) lines.push("UPRN: " + data.uprn!.trim());

  return { subject, body: lines.join("\n") };
}

function caseFindings(data: DraftCase): DraftCase[] {
  const extras = data.extraHazards || [];
  return [{ ...data, extraHazards: [] }, ...extras.map((item) => ({ ...data, ...item, extraHazards: [] }))];
}

export function projectDraft(data: DraftCase, photos: string[]): { subject: string; body: string } {
  if (!data.extraHazards?.length) return baseProjectDraft(data, photos);
  const findings = caseFindings(data);
  const drafts = findings.map((f) => baseProjectDraft(f, photos));
  let subject = drafts[0].subject;
  const template = templateId(data.project);
  if (template === "Onward") {
    const topics = [...new Set(findings.map((f) => f.onwardTopic || "").filter(Boolean))];
    subject = subject.replace("(" + (findings[0].onwardTopic || "") + ")", "(" + topics.join(" / ") + ")");
  }
  if (template === "Vico Homes" && findings.some((f) => !f.hazard.includes("Damp"))) {
    subject = subject.replace("HHSRS D&M", "HHSRS");
  }
  const firstLines = drafts[0].body.split("\n");
  const lines = firstLines.slice(0, 3);
  const tail: string[] = [];
  for (const draft of drafts) {
    const parts = draft.body.split("\n").slice(3);
    const end = parts.findIndex((line) => line.includes("on the HHSRS."));
    if (end < 0) throw new DraftError("Check the hazard wording before combining this email.");
    lines.push("", ...parts.slice(0, end + 1));
    for (const line of parts.slice(end + 1)) {
      if (line.trim() && !tail.includes(line)) tail.push(line);
    }
  }
  if (tail.length) lines.push("", ...tail);
  return { subject, body: lines.join("\n") };
}

/** Build a draft from a portal HHSRS site submission (+ office review fields). */
export type SubmissionDraftInput = {
  projectName: string;
  fullAddress: string;
  postcode: string;
  uprn: string;
  surveyDate: string;
  category: string;
  rating: string;
  comment: string;
  clientDescription?: string;
  clientCallReference?: string;
  callOutcome?: string;
  workOrder?: string;
  suspectedCause?: string;
  includeCause?: boolean;
  vulnerabilities?: string;
  escalation?: string;
  onwardTopic?: string;
  cat1Confirmed?: boolean;
  photoCount: number;
};

export function submissionToDraftCase(input: SubmissionDraftInput): DraftCase {
  const address = [input.fullAddress.trim(), input.postcode.trim()].filter(Boolean).join(", ");
  const ready = Boolean((input.clientDescription || "").trim());
  let callStatus = (input.callOutcome || "").trim();
  if (!callStatus && (input.clientCallReference || "").trim()) callStatus = "Completed";
  return {
    project: input.projectName,
    address,
    hazard: input.category,
    rating: input.rating,
    description: ready ? input.clientDescription!.trim() : input.comment,
    descriptionReady: ready,
    uprn: input.uprn,
    surveyDate: input.surveyDate,
    callStatus,
    callRef: input.clientCallReference || "",
    workOrder: input.workOrder || "",
    suspectedCause: input.suspectedCause || "",
    includeCause: input.includeCause !== false,
    vulnerabilities: input.vulnerabilities || "",
    escalation: input.escalation || "",
    onwardTopic: input.onwardTopic || "",
    cat1Confirmed: Boolean(input.cat1Confirmed),
  };
}

export function draftFromSubmission(input: SubmissionDraftInput): { subject: string; body: string } {
  const photos = Array.from({ length: Math.max(0, input.photoCount) }, (_, i) => `photo-${i + 1}`);
  return projectDraft(submissionToDraftCase(input), photos);
}
