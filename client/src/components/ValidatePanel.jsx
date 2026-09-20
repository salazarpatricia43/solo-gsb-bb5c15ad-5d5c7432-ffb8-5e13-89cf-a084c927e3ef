import { useState } from "react";
import { validateSample } from "../api";
import { DEFAULT_VALIDATE_SAMPLE } from "../defaultSamples";

export default function ValidatePanel({ schema, variantSchema }) {
  const [text, setText] = useState(DEFAULT_VALIDATE_SAMPLE);
  const [parseError, setParseError] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // When the user jumps here from the event-variant tab with a oneOf schema,
  // validate against it; otherwise fall back to the plain inferred schema.
  const [useVariant, setUseVariant] = useState(Boolean(variantSchema));

  const hasVariant = Boolean(variantSchema);
  const activeSchema = hasVariant && useVariant ? variantSchema : schema;

  async function runValidate() {
    setError(null);
    setResult(null);
    let sample;
    try {
      sample = JSON.parse(text);
      setParseError(null);
    } catch (e) {
      setParseError(e.message);
      return;
    }
    setBusy(true);
    try {
      setResult(await validateSample(activeSchema, sample));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!schema && !variantSchema) {
    return <div className="empty-hint">请先在左侧归纳出 Schema，再校验新样本。</div>;
  }

  return (
    <div className="validate-panel">
      {hasVariant && (
        <div className="perspective-toggle validate-source">
          <button
            type="button"
            className={useVariant ? "active" : ""}
            onClick={() => {
              setUseVariant(true);
              setResult(null);
            }}
          >
            事件变体 oneOf 契约
          </button>
          <button
            type="button"
            className={!useVariant ? "active" : ""}
            onClick={() => {
              setUseVariant(false);
              setResult(null);
            }}
            disabled={!schema}
          >
            普通归纳 Schema
          </button>
        </div>
      )}
      {hasVariant && !schema && (
        <div className="panel__meta panel__meta--block">
          当前仅有事件变体契约（尚未做普通归纳），校验将基于该 oneOf Schema。
        </div>
      )}

      <div className="validate-panel__editor">
        <div className="panel-label">待校验样本</div>
        <textarea
          className={`code-input ${parseError ? "code-input--err" : ""}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={12}
        />
        {parseError && <div className="parse-error">JSON 解析失败：{parseError}</div>}
        <button type="button" className="btn btn--primary" onClick={runValidate} disabled={busy}>
          {busy ? "校验中…" : "校验样本"}
        </button>
      </div>

      {error && <div className="alert alert--err">{error}</div>}

      {result && (
        <div className="validate-result">
          {result.valid ? (
            <div className="alert alert--ok">✓ 校验通过，样本符合契约。</div>
          ) : (
            <>
              <div className="alert alert--err">✗ 校验失败，共 {result.errors.length} 处问题：</div>
              <ul className="error-list">
                {result.errors.map((e, i) => (
                  <li key={i} className="error-item">
                    <div className="error-item__head">
                      <code className="error-pointer">{e.pointer}</code>
                      <span className="flag flag--keyword">{e.keyword}</span>
                    </div>
                    <div className="error-item__msg">{e.message}</div>
                    {e.params && Object.keys(e.params).length > 0 && (
                      <div className="error-item__params">
                        参数：<code>{JSON.stringify(e.params)}</code>
                      </div>
                    )}
                    <div className="error-item__schema">
                      规则：<code>{e.schemaPath}</code>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
