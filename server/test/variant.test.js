"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Ajv2020 = require("ajv/dist/2020").default;
const { buildVariants, parsePointer, MAX_SAMPLES } = require("../variant");

const ajv = new Ajv2020({ allErrors: true, strict: false });

function run(samples, pointer) {
  return buildVariants({ samples, pointer });
}

test("groups string discriminator values into const-pinned oneOf branches", () => {
  const result = run(
    [
      { type: "user", id: 1, email: "a@x.com" },
      { type: "user", id: 2, email: "b@x.com" },
      { type: "guest", id: 3 },
    ],
    "/type"
  );
  assert.equal(result.rejected, false);
  assert.equal(result.groupCount, 2);
  assert.equal(result.usedCount, 3);
  assert.equal(result.excludedCount, 0);
  assert.deepEqual(result.excluded, []);
  assert.deepEqual(
    result.groups.map((g) => g.value),
    ["user", "guest"]
  );
  assert.deepEqual(
    result.groups.map((g) => g.sampleCount),
    [2, 1]
  );
  assert.deepEqual(
    result.groups.map((g) => g.indexes),
    [
      [0, 1],
      [2],
    ]
  );

  assert.equal(result.schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(result.schema.oneOf.length, 2);

  const [userBranch, guestBranch] = result.schema.oneOf;
  assert.equal(userBranch.properties.type.const, "user");
  assert.equal(guestBranch.properties.type.const, "guest");
  assert.ok(userBranch.required.includes("type"));

  // Compilable, and the discriminator actually separates the variants.
  const validate = ajv.compile(result.schema);
  assert.equal(validate({ type: "user", id: 9, email: "c@x.com" }), true);
  assert.equal(validate({ type: "guest", id: 9 }), true);
  assert.equal(validate({ type: "guest", id: 9, email: "x" }), true); // email optional for guests
  assert.equal(validate({ type: "admin", id: 9 }), false); // unknown discriminator value
  assert.equal(validate({ id: 9 }), false); // missing discriminator
});

test("only fields common within the group enter required", () => {
  const result = run(
    [
      { kind: "a", shared: 1, onlyA: "x" },
      { kind: "a", shared: 2 },
      { kind: "b", shared: 3, onlyB: true },
      { kind: "b", shared: 4 },
    ],
    "/kind"
  );
  const [branchA, branchB] = result.schema.oneOf;
  assert.deepEqual(branchA.required.sort(), ["kind", "shared"]);
  assert.deepEqual(branchB.required.sort(), ["kind", "shared"]);
  assert.equal(branchA.properties.onlyA.type, "string");
  assert.equal(branchB.properties.onlyB.type, "boolean");
});

test("supports number and boolean discriminator values including integer/float mix", () => {
  const result = run(
    [
      { v: 1, n: "a" },
      { v: 1.0, n: "b" },
      { v: 2, n: "c" },
      { v: true, n: "d" },
    ],
    "/v"
  );
  assert.equal(result.groupCount, 3); // 1 and 1.0 are the same JSON value
  assert.deepEqual(
    result.groups.map((g) => g.value),
    [1, 2, true]
  );
  assert.deepEqual(
    result.groups.map((g) => g.sampleCount),
    [2, 1, 1]
  );
  const validate = ajv.compile(result.schema);
  assert.equal(validate({ v: 1.0, n: "z" }), true);
  assert.equal(validate({ v: false, n: "z" }), false);
});

test("excludes samples with missing discriminator, null/object/array values and lists reasons", () => {
  const result = run(
    [
      { type: "user", id: 1 }, // valid -> group user
      { id: 2 }, // missing field
      { type: null, id: 3 }, // null
      { type: { nested: 1 }, id: 4 }, // object
      { type: ["x"], id: 5 }, // array
      { type: "guest", id: 6 }, // valid -> group guest
    ],
    "/type"
  );
  assert.equal(result.rejected, false);
  assert.equal(result.groupCount, 2);
  assert.equal(result.usedCount, 2);
  assert.equal(result.excludedCount, 4);
  assert.deepEqual(
    result.excluded.map((e) => e.index),
    [1, 2, 3, 4]
  );
  assert.match(result.excluded[0].reason, /缺失/);
  assert.match(result.excluded[1].reason, /null/);
  assert.match(result.excluded[2].reason, /对象/);
  assert.match(result.excluded[3].reason, /数组/);
});

test("nested object pointer works and re-indexes path maps", () => {
  const result = run(
    [
      { meta: { event: "open" }, id: 1 },
      { other: 1 },
      { meta: { event: "close" }, id: 2, why: "done" },
    ],
    "/meta/event"
  );
  assert.equal(result.groupCount, 2);
  assert.deepEqual(result.excluded.map((e) => e.index), [1]);
  assert.match(result.excluded[0].reason, /meta/);

  const [openBranch, closeBranch] = result.schema.oneOf;
  assert.equal(openBranch.properties.meta.properties.event.const, "open");
  assert.equal(closeBranch.properties.meta.properties.event.const, "close");
  // Branch path annotations point back at the ORIGINAL sample indexes.
  assert.deepEqual(result.groups[1].paths[""], ["#/2"]);
  assert.deepEqual(result.groups[1].paths["/properties/id"], ["#/2/id"]);
});

test("array indices in the pointer are supported", () => {
  const result = run(
    [
      { tags: ["user", { id: 1 }] },
      { tags: ["guest", { id: 2 }] },
      { tags: ["user", { id: 3 }] },
    ],
    "/tags/0"
  );
  assert.equal(result.groupCount, 2);
  const [userBranch, guestBranch] = result.schema.oneOf;
  // The discriminator lives at the folded array-items subschema.
  assert.equal(userBranch.properties.tags.items.const, "user");
  assert.equal(guestBranch.properties.tags.items.const, "guest");
});

test("bad array index and out-of-range index are excluded per sample", () => {
  const result = run(
    [
      { tags: ["user"] },
      { tags: ["guest"] },
      { tags: [] }, // index 0 out of range
      { tags: 42 }, // token 0 reached through a scalar
      { tags: ["guest"] },
    ],
    "/tags/0"
  );
  assert.equal(result.groupCount, 2);
  assert.deepEqual(result.excluded.map((e) => e.index), [2, 3]);
  assert.match(result.excluded[0].reason, /越界/);
  assert.match(result.excluded[1].reason, /数字/);

  const leadingZero = run(
    [
      { a: [1] },
      { a: [2] },
    ],
    "/a/01"
  );
  assert.match(leadingZero.excluded[0].reason, /数组下标/);
  assert.equal(leadingZero.groupCount, 0);
});

test("RFC 6901 escapes are accepted in object keys", () => {
  const result = run(
    [
      { "a/b": 1, kind: "x" },
      { "a/b": 2, kind: "y" },
    ],
    "/a~1b"
  );
  assert.equal(result.rejected, false);
  assert.equal(result.groupCount, 2);
  const [x, y] = result.schema.oneOf;
  assert.equal(x.properties["a/b"].const, 1);
  assert.equal(y.properties["a/b"].const, 2);
});

test("malformed pointer escapes exclude every sample with a pointer reason", () => {
  const result = run(
    [
      { t: "a" },
      { t: "b" },
    ],
    "/a~2b"
  );
  assert.equal(result.rejected, true);
  assert.equal(result.groupCount, 0);
  assert.equal(result.excludedCount, 2);
  assert.deepEqual(result.excluded.map((e) => e.index), [0, 1]);
  assert.match(result.excluded[0].reason, /转义非法/);
  assert.match(result.error, /转义非法/);

  const dangling = run([{ t: "a" }], "/a~");
  assert.equal(dangling.rejected, true);
  assert.match(dangling.error, /转义非法/);

  const noSlash = run([{ t: "a" }], "type");
  assert.equal(noSlash.rejected, true);
  assert.match(noSlash.error, /以 \/ 开头/);
});

test("fewer than two valid groups is rejected but still reports groups and exclusions", () => {
  const single = run(
    [
      { type: "user", id: 1 },
      { type: "guest", id: 2 },
    ],
    "/type"
  );
  // Two values above -> success; now collapse to one valid group.
  const oneGroup = run(
    [
      { type: "user", id: 1 },
      { type: null, id: 2 },
      { id: 3 },
    ],
    "/type"
  );
  assert.equal(oneGroup.rejected, true);
  assert.equal(oneGroup.groupCount, 1);
  assert.equal(oneGroup.excludedCount, 2);
  assert.match(oneGroup.error, /至少需要 2/);
  assert.equal(oneGroup.groups[0].schema.properties.type.const, "user");

  const none = run([{ id: 1 }], "/type");
  assert.equal(none.rejected, true);
  assert.equal(none.groupCount, 0);
  assert.match(none.error, /没有任何样本/);

  assert.equal(single.rejected, false);
});

test("root pointer discriminates top-level scalar samples", () => {
  const result = run(["a", "b", "a", 1, true], "");
  assert.equal(result.groupCount, 4);
  assert.deepEqual(
    result.groups.map((g) => [g.value, g.sampleCount]),
    [
      ["a", 2],
      ["b", 1],
      [1, 1],
      [true, 1],
    ]
  );
  const validate = ajv.compile(result.schema);
  assert.equal(validate("a"), true);
  assert.equal(validate("b"), true);
  assert.equal(validate(1), true);
  assert.equal(validate(true), true);
  assert.equal(validate("c"), false);
});

test("branch pinning is correct when a token is both an array index and an object key", () => {
  // /x/0: sample 0 traverses an array (x[0]), sample 1 an object (x["0"]).
  const result = run(
    [
      { x: [{ kind: "a" }], note: 1 },
      { x: { 0: { kind: "b" } }, note: 2 },
    ],
    "/x/0/kind"
  );
  assert.equal(result.groupCount, 2);
  const validate = ajv.compile(result.schema);
  assert.equal(validate({ x: [{ kind: "a" }], note: 1 }), true);
  assert.equal(validate({ x: { 0: { kind: "b" } }, note: 2 }), true);
  // A scalar sitting in the array slot must NOT have received the const.
  assert.equal(validate({ x: [999], note: 1, other: 1 }), false);
});

test("excluded counts and indexes are exposed for the UI", () => {
  const result = run(
    [
      { type: "a" },
      { type: "a" },
      {},
      { type: "b" },
    ],
    "/type"
  );
  assert.equal(result.total, 4);
  assert.equal(result.usedCount, 3);
  assert.equal(result.excludedCount, 1);
  assert.equal(result.excluded[0].index, 2);
});

test("validates sample set shape and enforces the sample cap", () => {
  assert.throws(() => run(null, "/t"), /samples/);
  assert.throws(() => run([], "/t"), /samples/);
  assert.throws(
    () => run(Array.from({ length: MAX_SAMPLES + 1 }, () => ({ t: "a" })), "/t"),
    new RegExp(`${MAX_SAMPLES}`)
  );
});

test("parsePointer strictly validates RFC 6901 escapes", () => {
  assert.deepEqual(parsePointer(""), []);
  assert.deepEqual(parsePointer("/a/b"), ["a", "b"]);
  assert.deepEqual(parsePointer("/a~1b/~0c"), ["a/b", "~c"]);
  assert.throws(() => parsePointer("/a~x"), /转义非法/);
  assert.throws(() => parsePointer("/~"), /转义非法/);
  assert.throws(() => parsePointer("nope"), /以 \/ 开头/);
  assert.throws(() => parsePointer(undefined), /'pointer' string/);
});
