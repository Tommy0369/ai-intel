import assert from "node:assert/strict";
import test from "node:test";
import { computeVelocity } from "./velocity.js";

test("2→18 is rising, 18→2 is declining, 1→2 is not hot", () => {
  const up = computeVelocity(2, 18);
  const down = computeVelocity(18, 2);
  const tiny = computeVelocity(1, 2);
  assert.ok(up.velocity > down.velocity);
  assert.ok(up.acceleration > 0);
  assert.ok(down.acceleration < 0);
  assert.ok(tiny.velocity < 70, "small base should not explode to HOT");
});
