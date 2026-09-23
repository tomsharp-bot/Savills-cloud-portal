import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ADDRESS_LOOKUP_MAX_PER_WINDOW,
  allowAddressLookup,
  extractIdealAddresses,
  formatAddressLine,
  lookupIdealPostcodes,
  matchAddresses,
  rankHouseMatch,
  resetAddressLookupLimits,
  uprnOf,
  type IdealPostcodeAddress,
} from "./ideal-postcodes.js";

const FIXTURE: IdealPostcodeAddress[] = [
  {
    postcode: "SE1 2AA",
    line_1: "10 Example Road",
    post_town: "London",
    building_number: "10",
    premise: "10",
    uprn: "100021300010",
    udprn: 111,
  } as IdealPostcodeAddress,
  {
    postcode: "SE1 2AA",
    line_1: "12 Example Road",
    post_town: "London",
    building_number: "12",
    premise: "12",
    uprn: "100021300012",
    udprn: 222,
  } as IdealPostcodeAddress,
  {
    postcode: "SE1 2AA",
    line_1: "Flat 1",
    line_2: "12 Example Road",
    post_town: "London",
    building_number: "12",
    sub_building_name: "Flat 1",
    premise: "Flat 1, 12",
    uprn: "100021300121",
  },
  {
    postcode: "SE1 2AA",
    line_1: "Flat 12",
    line_2: "Campion House",
    line_3: "Example Road",
    post_town: "London",
    building_number: "12",
    building_name: "Campion House",
    sub_building_name: "Flat 12",
    premise: "Flat 12, Campion House, 12",
    uprn: "100021312345",
  },
  {
    postcode: "SE1 2AA",
    line_1: "120 Example Road",
    post_town: "London",
    building_number: "120",
    premise: "120",
    uprn: "100021300120",
  },
  {
    postcode: "SE1 2AA",
    line_1: "12A Example Road",
    post_town: "London",
    building_number: "12A",
    premise: "12A",
    uprn: 100021300124,
  },
  {
    postcode: "SW1A 2AA",
    line_1: "Prime Minister & First Lord Of The Treasury",
    line_2: "10 Downing Street",
    post_town: "London",
    building_number: "10",
    organisation_name: "Prime Minister & First Lord Of The Treasury",
    premise: "10",
    uprn: "100023336956",
    udprn: 23747771,
  } as IdealPostcodeAddress,
];

describe("matchAddresses", () => {
  it("ranks an exact house number above neighbours and ignores UDPRN", () => {
    const matches = matchAddresses(FIXTURE, "12");
    assert.ok(matches.length >= 2);
    assert.ok(matches.every((match) => match.line.startsWith("12 ") || match.line.startsWith("Flat ")));
    assert.ok(matches.some((match) => match.uprn === "100021300012"));
    assert.ok(matches.some((match) => match.uprn === "100021312345"));
    assert.equal(
      matches.some((match) => match.uprn === "100021300120" || match.uprn === "100021300010"),
      false
    );
    assert.equal(matches.some((match) => match.uprn === "222" || match.uprn === "111"), false);
  });

  it("returns a single flat when the house name matches that sub-building", () => {
    const matches = matchAddresses(FIXTURE, "Flat 12");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].uprn, "100021312345");
    assert.equal(matches[0].line, "Flat 12, Campion House, Example Road, London");
    assert.equal(matches[0].postcode, "SE1 2AA");
  });

  it("matches a building name and keeps UPRN editable-source text", () => {
    const matches = matchAddresses(FIXTURE, "Campion House");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].uprn, "100021312345");
  });

  it("matches 12A without also returning 12 or 120", () => {
    const matches = matchAddresses(FIXTURE, "12a");
    assert.deepEqual(
      matches.map((match) => match.uprn),
      ["100021300124"]
    );
  });

  it("matches an organisation name and prefers the uprn field", () => {
    const matches = matchAddresses(FIXTURE, "Prime Minister");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].uprn, "100023336956");
    assert.match(matches[0].line, /10 Downing Street/);
    assert.doesNotMatch(matches[0].line, /SW1A 2AA/);
  });

  it("returns no matches for an empty or unrelated house", () => {
    assert.deepEqual(matchAddresses(FIXTURE, "   "), []);
    assert.deepEqual(matchAddresses(FIXTURE, "999"), []);
  });

  it("does not treat a short number as a prefix of a longer one", () => {
    assert.equal(rankHouseMatch(FIXTURE[1], "1"), 0);
    assert.equal(rankHouseMatch(FIXTURE[4], "12"), 0);
    assert.ok(rankHouseMatch(FIXTURE[1], "12") >= 60);
  });
});

describe("formatAddressLine / uprnOf", () => {
  it("joins non-empty lines and skips a blank line without appending the postcode", () => {
    assert.equal(
      formatAddressLine({
        line_1: "10 Downing Street",
        line_2: "",
        line_3: "",
        post_town: "London",
        postcode: "SW1A 2AA",
      }),
      "10 Downing Street, London"
    );
  });

  it("stringifies a numeric uprn and ignores a missing one", () => {
    assert.equal(uprnOf({ uprn: 100023336956 }), "100023336956");
    assert.equal(uprnOf({ uprn: "" }), "");
    assert.equal(uprnOf({}), "");
  });
});

describe("extractIdealAddresses", () => {
  it("reads a postcode result array and a hits wrapper", () => {
    const row = { line_1: "1 High Street", uprn: "1", building_number: "1" };
    assert.equal(extractIdealAddresses({ result: [row], code: 2000 }).length, 1);
    assert.equal(extractIdealAddresses({ result: { hits: [row] } }).length, 1);
    assert.deepEqual(extractIdealAddresses({ message: "nope" }), []);
  });
});

describe("lookupIdealPostcodes", () => {
  it("returns 503 when the API key is missing and does not call the network", async () => {
    let called = false;
    const result = await lookupIdealPostcodes({
      postcode: "SE1 2AA",
      house: "12",
      apiKey: "  ",
      fetchImpl: async () => {
        called = true;
        throw new Error("should not fetch");
      },
    });
    assert.equal(called, false);
    assert.deepEqual(result, { ok: false, status: 503, error: "Address lookup is not configured." });
  });

  it("rejects a missing house and an invalid postcode", async () => {
    const missing = await lookupIdealPostcodes({ postcode: "SE1 2AA", house: " ", apiKey: "ak_test" });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 400);

    const bad = await lookupIdealPostcodes({ postcode: "not a postcode", house: "12", apiKey: "ak_test" });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.status, 400);
  });

  it("sends the key in the Authorization header and filters the postcode list", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const result = await lookupIdealPostcodes({
      postcode: "se1 2aa",
      house: "Flat 12",
      apiKey: 'ak_"secret"',
      fetchImpl: async (url, init) => {
        seenUrl = String(url);
        const headers = init?.headers as Record<string, string>;
        seenAuth = headers.Authorization;
        return new Response(
          JSON.stringify({
            code: 2000,
            message: "Success",
            result: FIXTURE,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
    });
    assert.equal(seenUrl.includes("secret"), false);
    assert.match(seenUrl, /postcode=SE12AA/);
    assert.equal(seenAuth, 'api_key="ak_secret"');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.matches.length, 1);
      assert.equal(result.matches[0].uprn, "100021312345");
    }
  });

  it("returns an empty list when Ideal Postcodes has no postcode", async () => {
    const result = await lookupIdealPostcodes({
      postcode: "ZZ99 9ZZ",
      house: "1",
      apiKey: "ak_test",
      fetchImpl: async () => new Response("{}", { status: 404 }),
    });
    assert.deepEqual(result, { ok: true, matches: [] });
  });
});

describe("allowAddressLookup", () => {
  it("allows a short burst then refuses the next call in the same window", () => {
    resetAddressLookupLimits();
    const now = 1_700_000_000_000;
    for (let i = 0; i < ADDRESS_LOOKUP_MAX_PER_WINDOW; i++) {
      assert.equal(allowAddressLookup("203.0.113.5", now), true);
    }
    assert.equal(allowAddressLookup("203.0.113.5", now), false);
    assert.equal(allowAddressLookup("203.0.113.6", now), true);
    assert.equal(allowAddressLookup("203.0.113.5", now + 60_000), true);
  });
});
