import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CLAIM_STALE_MS, claimRowClass, claimView, claimerLabel, isQuietClaim } from "./hhsrs-claims.js";

describe("HHSRS case claims", () => {
  const now = new Date("2026-09-24T12:00:00Z");

  it("treats an empty claim as open", () => {
    const view = claimView({ claimedBy: "", claimedAt: null }, now);
    assert.equal(view.status, "open");
    assert.equal(claimRowClass(view.status), "");
    assert.equal(isQuietClaim(view.status), false);
  });

  it("keeps a fresh claim with the named person and does not go stale early", () => {
    const view = claimView(
      { claimedBy: "Phil Moon", claimedAt: new Date(now.getTime() - 30 * 60 * 1000) },
      now
    );
    assert.equal(view.status, "claimed");
    assert.equal(view.claimedBy, "Phil Moon");
    assert.equal(claimRowClass(view.status), "row-claimed");
    assert.equal(isQuietClaim(view.status), true);
  });

  it("flags a claim as stale after the wait without changing the owner", () => {
    const view = claimView(
      { claimedBy: "Carly", claimedAt: new Date(now.getTime() - CLAIM_STALE_MS) },
      now
    );
    assert.equal(view.status, "stale");
    assert.equal(view.claimedBy, "Carly");
    assert.equal(claimRowClass(view.status), "row-claim-stale");
    assert.equal(isQuietClaim("stale"), true);
  });

  it("uses the signed-in name for a new claim", () => {
    assert.equal(claimerLabel({ name: "Tom Sharp", username: "tsharp" }), "Tom Sharp");
    assert.equal(claimerLabel({ name: "", username: "phil.m" }), "phil.m");
    assert.equal(claimerLabel(null), "someone");
  });
});
