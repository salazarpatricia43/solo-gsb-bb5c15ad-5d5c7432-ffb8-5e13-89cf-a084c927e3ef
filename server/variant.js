"use strict";

/**
 * Event-variant contract builder.
 *
 * Given a JSON array of samples and a JSON Pointer (RFC 6901) naming a
 * discriminator field, every sample is read at that position:
 *
 *  - string / number / boolean -> the sample joins the group keyed by the value
 *  - field missing             -> excluded (reason reported per sample index)
 *  - object / array / null     -> excluded (unsupported discriminator value)
 *  - malformed pointer escape  -> every sample excluded with the same reason
 *
 * Each group reuses the existing inference engine (`inferSchema`), so every
 * other rule (missing fields, null unions, heterogeneous arrays...) is handled
 * exactly as in `/api/infer`. The discriminator is then pinned inside the
 * branch schema:
 *
 *  - its subschema gains a `const` equal to the group value
 *  - it is present in every group sample, so the engine already puts it in
 *    `required`; every other property enters `required` only when present in
 *    ALL samples OF THAT GROUP
 *
 * The groups become the branches of a single `oneOf` wrapper. Fewer than two
 * valid groups is a request error: a discriminated contract needs variants.
 *
 * A single run is capped at MAX_SAMPLES samples.
 */

const Ajv2020 = require("ajv/dist/2020").default;
const { inferSchema } = require("./infer");

const MAX_SAMPLES = 200;
const MIN_GROUPS = 2;

const ajv = new Ajv2020({ allErrors: true, strict: false });

const SCALAR_NAME = {
  string: "字符串",
  number: "数字",
  integer: "数字",
  boolean: "布尔值",
};

/**
 * Strictly parse a JSON Pointer (RFC 6901) into unescaped segments.
 * "" (the whole document) is a valid pointer and yields []. Unlike the lenient
 * parser used by the counterexample generator, an escape other than ~0/~1
 * (including a dangling ~) is rejected.
 *
 * @returns {string[]} raw, unescaped segments
 */
function parsePointer(pointer) {
  if (typeof pointer !== "string") {
    throw new TypeError("Request body must contain a 'pointer' string.");
  }
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw Object.assign(new Error("JSON Pointer 必须为空（根节点）或以 / 开头。"), {
      status: 400,
    });
  }
  const rawSegments = pointer.substring(1).split("/");
  const segments = [];
  for (const seg of rawSegments) {
    if (/~[^01]/.test(seg) || /~$/.test(seg)) {
      throw Object.assign(
        new Error(`JSON Pointer 转义非法：段 "${seg}" 中的 ~ 后只能是 0 或 1（如 a~1b 表示 a/b）。`),
        { status: 400 }
      );
    }
    // Unescape in the RFC order: ~1 -> "/" first, then ~0 -> "~".
    segments.push(seg.replace(/~1/g, "/").replace(/~0/g, "~"));
  }
  return segments;
}

/** Human-readable JSON Pointer prefix built from the raw user-supplied tokens. */
function prefixOf(rawSegments, depth) {
  return depth === 0 ? "" : `/${rawSegments.slice(0, depth).join("/")}`;
}

/**
 * Read the discriminator value of one sample, recording the shape of every
 * traversal step so the same path can later be walked inside the inferred
 * branch schema.
 *
 * @param {any} sample
 * @param {string[]} segments unescaped pointer segments (may be empty)
 * @param {string[]} rawSegments segments exactly as typed by the user (for messages)
 * @returns {{ ok: true, value: string|number|boolean,
 *             steps: Array<{ isArray: boolean, key: string }> }
 *          | { ok: false, reason: string }}
 */
function resolveDiscriminator(sample, segments, rawSegments) {
  let current = sample;
  const steps = [];

  for (let depth = 0; depth < segments.length; depth += 1) {
    const token = segments[depth];
    const prefix = prefixOf(rawSegments, depth);

    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) {
        return {
          ok: false,
          reason: `路径段 "${token}" 不是合法数组下标（须为 0 或不以 0 开头的非负整数；RFC 6901 的 "-" 不指向现有元素），位置：${prefix || "(root)"}。`,
        };
      }
      const index = Number(token);
      if (index >= current.length) {
        return {
          ok: false,
          reason: `判别字段缺失：数组下标 ${index} 越界（${prefix || "(root)"} 处数组长度为 ${current.length}）。`,
        };
      }
      current = current[index];
      steps.push({ isArray: true, key: token });
    } else if (current !== null && typeof current === "object") {
      if (!Object.prototype.hasOwnProperty.call(current, token)) {
        return {
          ok: false,
          reason: `判别字段缺失：${prefix || "(root)"} 处对象没有键 "${token}"。`,
        };
      }
      current = current[token];
      steps.push({ isArray: false, key: token });
    } else {
      const kind = current === null ? "null" : typeof current;
      const where = `${prefix || "(root)"}`;
      return {
        ok: false,
        reason:
          kind === "null"
            ? `路径 ${where} 处是 null，无法继续按 "${token}" 取值。`
            : `路径 ${where} 处是${SCALAR_NAME[kind] || "标量"}，无法继续按 "${token}" 取值。`,
      };
    }
  }

  if (current === null) {
    return { ok: false, reason: "判别值为 null：判别字段只支持字符串、数字或布尔值。" };
  }
  if (Array.isArray(current)) {
    return { ok: false, reason: "判别值为数组：判别字段只支持字符串、数字或布尔值。" };
  }
  if (typeof current === "object") {
    return { ok: false, reason: "判别值为对象：判别字段只支持字符串、数字或布尔值。" };
  }
  return { ok: true, value: current, steps };
}

/**
 * Pin the discriminator inside an inferred branch.
 *
 * A pointer token can address BOTH an array index and an object key named
 * like "0"; samples in one group may therefore traverse an array at some
 * depth while others traverse an object there. The inferred node then carries
 * a type union with both `items` and `properties`.
 *
 * To pin `const` only where a traversal ACTUALLY ends (never onto unrelated
 * element/property observations folded into the same union node), each
 * distinct array/object "shape sequence" found among the group samples is
 * walked separately. A shape sequence determines the schema path uniquely
 * (items vs properties/<token>), so every reached leaf corresponds to at
 * least one real sample. Reached nodes are de-duplicated into a Set.
 */
function pinDiscriminator(branchSchema, stepsList, constValue) {
  const leaves = new Set();
  const seenShapes = new Set();
  for (const steps of stepsList) {
    const signature = steps.map((step) => (step.isArray ? "a" : "o")).join("");
    if (seenShapes.has(signature)) continue;
    seenShapes.add(signature);

    let targets = [branchSchema];
    for (const step of steps) {
      const next = [];
      for (const node of targets) {
        if (step.isArray) {
          if (node.items) next.push(node.items);
        } else if (node.properties && Object.prototype.hasOwnProperty.call(node.properties, step.key)) {
          next.push(node.properties[step.key]);
        }
      }
      targets = next;
    }
    for (const node of targets) leaves.add(node);
  }
  for (const node of leaves) node.const = constValue;
}

/**
 * Re-index a branch path map (`#/<positionInGroup>/...`) back to the original
 * sample indexes, so the tree annotations match the editors on the left.
 */
function remapPaths(paths, indexes) {
  const remapOne = (samplePath) => {
    const match = /^#\/(\d+)(\/.*)?$/.exec(samplePath);
    if (!match) return samplePath;
    const original = indexes[Number(match[1])];
    return `#/${original}${match[2] || ""}`;
  };
  return Object.fromEntries(
    Object.entries(paths).map(([schemaPointer, samplePaths]) => [
      schemaPointer,
      samplePaths.map(remapOne),
    ])
  );
}

/** Shape a rejection (HTTP 400): same payload fields as a successful run. */
function rejected(message, { pointer, total, excluded, groups }) {
  return {
    rejected: true,
    error: message,
    pointer,
    total,
    usedCount: total - excluded.length,
    excludedCount: excluded.length,
    groupCount: groups.length,
    excluded,
    groups,
  };
}

/**
 * Build the event-variant (`oneOf`) contract.
 *
 * @param {{ samples: any[], pointer: string }} input
 * @returns {object} full result payload (caller checks `rejected` for status)
 */
function buildVariants({ samples, pointer }) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw Object.assign(new Error("Request body must contain a non-empty 'samples' array."), {
      status: 400,
    });
  }
  if (samples.length > MAX_SAMPLES) {
    throw Object.assign(
      new Error(
        `Too many samples: got ${samples.length}, at most ${MAX_SAMPLES} allowed per variant contract.`
      ),
      { status: 400 }
    );
  }

  let segments;
  let rawSegments;
  try {
    segments = parsePointer(pointer);
    rawSegments = pointer === "" ? [] : pointer.substring(1).split("/");
  } catch (err) {
    // A malformed pointer excludes every sample — list each one with the
    // same reason, as required by the module contract.
    const reason = err.message;
    const excluded = samples.map((_, index) => ({ index, reason }));
    return rejected(reason, {
      pointer: String(pointer),
      total: samples.length,
      excluded,
      groups: [],
    });
  }

  // First-seen order makes the branch order deterministic and readable.
  const groupOrder = [];
  const groupsByKey = new Map();
  const excluded = [];

  samples.forEach((sample, index) => {
    const resolved = resolveDiscriminator(sample, segments, rawSegments);
    if (!resolved.ok) {
      excluded.push({ index, reason: resolved.reason });
      return;
    }
    const key = JSON.stringify(resolved.value);
    let group = groupsByKey.get(key);
    if (!group) {
      group = {
        value: resolved.value,
        indexes: [],
        samples: [],
        stepsList: [],
      };
      groupsByKey.set(key, group);
      groupOrder.push(key);
    }
    group.indexes.push(index);
    group.samples.push(sample);
    group.stepsList.push(resolved.steps);
  });

  const groups = groupOrder.map((key) => {
    const group = groupsByKey.get(key);

    const { schema, paths } = inferSchema(group.samples);
    delete schema.$schema;
    pinDiscriminator(schema, group.stepsList, group.value);

    return {
      value: group.value,
      sampleCount: group.samples.length,
      indexes: group.indexes,
      schema,
      paths: remapPaths(paths, group.indexes),
    };
  });

  const usedCount = samples.length - excluded.length;

  if (groups.length < MIN_GROUPS) {
    return rejected(
      groups.length === 0
        ? "没有任何样本在该判别字段上得到有效的字符串/数字/布尔值，无法生成事件变体契约。"
        : `仅得到 ${groups.length} 个有效分组（判别值 ${JSON.stringify(groups[0].value)}），至少需要 ${MIN_GROUPS} 个分组才能生成 oneOf 契约。`,
      { pointer, total: samples.length, excluded, groups }
    );
  }

  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    oneOf: groups.map((group) => group.schema),
  };

  // Defensive: the wrapper must always be a compilable 2020-12 schema.
  try {
    ajv.compile(schema);
  } catch (err) {
    throw Object.assign(new Error(`Invalid variant schema generated: ${err.message}`), {
      status: 422,
    });
  }

  return {
    rejected: false,
    pointer,
    total: samples.length,
    usedCount,
    excludedCount: excluded.length,
    groupCount: groups.length,
    excluded,
    groups,
    schema,
  };
}

module.exports = {
  buildVariants,
  parsePointer,
  resolveDiscriminator,
  pinDiscriminator,
  MAX_SAMPLES,
  MIN_GROUPS,
};
