import test from "node:test";
import assert from "node:assert/strict";
import { canViewWorld, normalizeVisibility } from "../lib/access.js";

test("normalizes unknown visibility to private", () => {
  assert.equal(normalizeVisibility("weird"), "private");
});

test("public worlds are viewable without a share code", () => {
  assert.equal(canViewWorld({ visibility: "public" }, null), true);
});

test("private worlds are not viewable without server auth", () => {
  assert.equal(canViewWorld({ visibility: "private" }, { code: "abc" }), false);
});

test("allowed worlds require a share code record", () => {
  assert.equal(canViewWorld({ visibility: "allowed" }, null), false);
  assert.equal(canViewWorld({ visibility: "allowed" }, { code: "abc" }), true);
});

