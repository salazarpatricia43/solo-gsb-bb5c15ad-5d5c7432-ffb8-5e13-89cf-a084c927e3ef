import { useState } from "react";
import { buildVariants } from "../api.js";
import SchemaTree from "./SchemaTree.jsx";

// Keep in sync with MAX_SAMPLES in server/variant.js.
const MAX_SAMPLES = 200;

const VALUE_TYPE_LABEL = {
  string: "字符串",
  number: "数字",
  boolean: "布尔值",
};

function valueKind(value) {
  return typeof value; // JSON scalar: string | number | boolean
}

function formatConst(value) {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

/**
 * Event-variant contract panel (tab ⑤): the user names a discriminator field
 * via a JSON Pointer, samples are grouped by the scalar found there, and each
 * group is inferred independently into a `oneOf` branch whose discriminator is
 * pinned with `const`.
 *
 * A 400 from the server still carries the partial details (`groups`,
 * `excluded`), which we render so the user can see which samples were dropped
 * and why. The result also remembers the signature of the sample texts it was
 * built from so edits invalidate it visibly.
 */
export default function VariantPanel({ samples, allValid, signature, onUseSchema }) {
  const [pointer, setPointer] = useState("/type");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // transport/unexpected errors
  const [outcome, setOutcome] = useState(null); // { ok, signature, data }
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [openBranch, setOpenBranch] = useState(0);

  const data = outcome && outcome.signature === signature ? outcome.data : null;
  const invalidated = outcome !== null && outcome.signature !== signature;

  const excludedCount = data?.excluded?.length ?? 0;
  // Any pointer string is acceptable as input as long as it is empty (root)
  // or starts with "/"; semantic/escape errors come back from the server.
  const pointerValid = pointer === "" || pointer.startsWith("/");

  async function runVariants() {
    setError(null);
    setOutcome(null);
    if (samples.length > MAX_SAMPLES) {
      setError(
        `单次最多处理 ${MAX_SAMPLES} 条样本，当前输入共 ${samples.length} 条，请删减后再生成。`
      );
      return;
    }
    if (pointer !== "" && !pointer.startsWith("/")) {
      setError('JSON Pointer 必须为空（根节点）或以 / 开头，例如 /type 或 /meta/event。');
      return;
    }
    setBusy(true);
    try {
      const res = await buildVariants(samples, pointer);
      setOutcome({ ok: res.ok, signature, data: res.data });
      setOpenBranch(0);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copySchema() {
    if (!data || !data.schema) return;
    const text = JSON.stringify(data.schema, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="variant-panel">
      <div className="panel-label">判别字段（JSON Pointer，RFC 6901）</div>
      <div className="variant-input-row">
        <input
          className="version-input variant-pointer-input"
          value={pointer}
          onChange={(e) => setPointer(e.target.value)}
          spellCheck={false}
          placeholder="/type"
        />
        <button
          type="button"
          className="btn btn--primary"
          onClick={runVariants}
          disabled={busy || !allValid || samples.length === 0 || !pointerValid}
          title={!allValid ? "请先修正无效的 JSON 样本" : !pointerValid ? "JSON Pointer 须为空或以 / 开头" : ""}
        >
          {busy ? "生成中…" : "生成事件变体契约 →"}
        </button>
      </div>
      <div className="panel__meta panel__meta--block">
        系统读取每条样本该位置的字符串 / 数字 / 布尔值并按值分组，各组分别复用归纳引擎生成
        oneOf 分支：判别字段在该分支内固定为对应 const，仅该组共同存在的字段进入 required。
        缺失判别字段、值为对象/数组/null 或 Pointer 转义非法的样本不参与生成（单次最多{" "}
        {MAX_SAMPLES} 条；有效分组少于 2 个时拒绝产出）。
      </div>

      {error && <div className="alert alert--err">{error}</div>}
      {invalidated && (
        <div className="alert alert--info">样本内容已变化，上次变体契约结果已失效，请重新生成。</div>
      )}

      {data && (
        <>
          {!outcome.ok && (
            <div className="alert alert--err">
              ✗ {data.error}（有效分组 {data.groupCount} 个 · 参与 {data.usedCount}/{data.total} 条）
            </div>
          )}

          {excludedCount > 0 && (
            <div className="variant-excluded">
              <div className="panel-label">
                未参与生成的样本（{excludedCount} 条，按样本序号列出）
              </div>
              <ul className="variant-excluded__list">
                {data.excluded.map((item) => (
                  <li key={item.index} className="variant-excluded__item">
                    <span className="scan-item__index">#{item.index + 1}</span>
                    <span className="variant-excluded__reason">{item.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.groups.length > 0 && (
            <>
              <div className="scan-summary">
                <span className="verdict verdict--critical">分组 {data.groupCount}</span>
                <span className="verdict verdict--redundant">
                  参与样本 {data.usedCount}/{data.total}
                </span>
                <span className="panel__meta">分支判别值 → oneOf 子 Schema</span>
                <div className="panel__tools variant-tools">
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => setShowRaw(!showRaw)}
                  >
                    {showRaw ? "分支视图" : "完整 JSON"}
                  </button>
                  {outcome.ok && (
                    <>
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => onUseSchema(data.schema)}
                      >
                        到校验页验证
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        onClick={copySchema}
                      >
                        {copied ? "✓ 已复制" : "复制完整结果"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {outcome.ok && (
                <div className="alert alert--ok">
                  ✓ 已生成含 {data.groupCount} 个分支的 oneOf 契约，{data.usedCount} 条样本参与归纳
                  {excludedCount > 0 ? `，${excludedCount} 条已剔除` : ""}。
                </div>
              )}

              {showRaw && outcome.ok ? (
                <pre className="schema-raw">{JSON.stringify(data.schema, null, 2)}</pre>
              ) : (
                <ul className="variant-branches">
                  {data.groups.map((group, i) => {
                    const open = openBranch === i;
                    const kind = VALUE_TYPE_LABEL[valueKind(group.value)];
                    return (
                      <li key={i} className="variant-branch">
                        <button
                          type="button"
                          className="variant-branch__head"
                          onClick={() => setOpenBranch(open ? -1 : i)}
                          aria-expanded={open}
                        >
                          <span className="scan-item__toggle">{open ? "▲" : "▼"}</span>
                          <span className="variant-branch__const">
                            const = <code>{formatConst(group.value)}</code>
                          </span>
                          <span className={`type-badge type-badge--${valueKind(group.value)}`}>
                            {kind}
                          </span>
                          <span className="variant-branch__count">{group.sampleCount} 条样本</span>
                          <span className="variant-branch__indexes">
                            #{group.indexes.map((n) => n + 1).join(", #")}
                          </span>
                        </button>
                        {open && (
                          <div className="variant-branch__body">
                            <SchemaTree schema={group.schema} paths={group.paths || {}} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
