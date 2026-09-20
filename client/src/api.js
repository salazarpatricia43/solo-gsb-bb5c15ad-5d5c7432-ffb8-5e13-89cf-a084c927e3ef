async function request(path, body, { raw = false } = {}) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`服务响应异常（HTTP ${res.status}）`);
  }
  // Some endpoints (e.g. /api/variants) return an informative 400 payload
  // (excluded samples, partial groups) the UI renders instead of throwing.
  if (raw) return { ok: res.ok, status: res.status, data };
  if (!res.ok) throw new Error(data.error || `请求失败（HTTP ${res.status}）`);
  return data;
}

export function inferSchema(samples) {
  return request("/api/infer", { samples });
}

export function validateSample(schema, sample) {
  return request("/api/validate", { schema, sample });
}

export function diffSchemas(oldSchema, newSchema, perspective) {
  return request("/api/diff", { oldSchema, newSchema, perspective });
}

export function generateCounterexample(oldSchema, newSchema, perspective, kind, pointer) {
  return request("/api/counterexample", { oldSchema, newSchema, perspective, kind, pointer });
}

export function scanSamples(oldSchema, newSchema, samples) {
  return request("/api/scan", { oldSchema, newSchema, samples });
}

export function analyzeContribution(samples) {
  return request("/api/contribution", { samples });
}

export function buildVariants(samples, pointer) {
  // 400 payloads still carry `groups`/`excluded` for the UI.
  return request("/api/variants", { samples, pointer }, { raw: true });
}
