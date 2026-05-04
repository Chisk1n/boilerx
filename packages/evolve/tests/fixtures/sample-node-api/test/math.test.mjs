import { test } from "node:test";
import assert from "node:assert/strict";
import { add, multiply, divide } from "../src/math.mjs";

test("add", () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1, 1), 0);
});

test("multiply", () => {
  assert.equal(multiply(2, 3), 6);
  assert.equal(multiply(0, 5), 0);
});

test("divide", () => {
  assert.equal(divide(6, 2), 3);
  assert.throws(() => divide(1, 0), /division by zero/);
});
