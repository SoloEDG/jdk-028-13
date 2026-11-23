import assert from "node:assert/strict";
import { test } from "node:test";
import type { CircuitDocument } from "../../shared/types";
import { buildRule } from "./factory";
import { decodeExperiment, encodeExperiment } from "./codec";

function sample(): CircuitDocument {
  return {
    version: 1,
    name: "旧实验",
    targetId: "xor",
    nodes: [
      { id: "a", kind: "INPUT", label: "A", value: 0, x: 60, y: 120 },
      { id: "y", kind: "OUTPUT", label: "Y", value: 0, x: 820, y: 230 },
      { id: "n", kind: "NOT", label: "NOT", value: 0, x: 400, y: 180 },
    ],
    wires: [
      {
        id: "w1",
        from: { nodeId: "a", port: 0 },
        to: { nodeId: "n", port: 0 },
      },
      {
        id: "w2",
        from: { nodeId: "n", port: 0 },
        to: { nodeId: "y", port: 0 },
      },
    ],
  };
}

test("旧版 v1 存档仍按原接法打开，规则集合为空并给出迁移提示", () => {
  const legacy = JSON.stringify(sample());
  const decoded = decodeExperiment(legacy);
  assert.equal(decoded.document.name, "旧实验");
  assert.equal(decoded.document.nodes.length, 3);
  assert.equal(decoded.document.wires.length, 2);
  assert.deepEqual(decoded.rules, []);
  assert.ok(decoded.warning, "应提示这是旧版存档");
});

test("v2 实验往返保存替换规则、成本设置与边界映射", () => {
  const document = sample();
  const before: CircuitDocument = {
    version: 1,
    name: "p",
    targetId: "xor",
    nodes: [
      { id: "i", kind: "INPUT", label: "IN1", value: 0, x: 40, y: 160 },
      { id: "n1", kind: "NOT", label: "A", value: 0, x: 280, y: 120 },
      { id: "n2", kind: "NOT", label: "B", value: 0, x: 500, y: 120 },
      { id: "o", kind: "OUTPUT", label: "OUT1", value: 0, x: 740, y: 140 },
    ],
    wires: [
      { id: "w1", from: { nodeId: "i", port: 0 }, to: { nodeId: "n1", port: 0 } },
      { id: "w2", from: { nodeId: "n1", port: 0 }, to: { nodeId: "n2", port: 0 } },
      { id: "w3", from: { nodeId: "n2", port: 0 }, to: { nodeId: "o", port: 0 } },
    ],
  };
  const after: CircuitDocument = {
    version: 1,
    name: "p",
    targetId: "xor",
    nodes: [
      { id: "i2", kind: "INPUT", label: "IN1", value: 0, x: 40, y: 160 },
      { id: "o2", kind: "OUTPUT", label: "OUT1", value: 0, x: 600, y: 160 },
    ],
    wires: [
      { id: "w4", from: { nodeId: "i2", port: 0 }, to: { nodeId: "o2", port: 0 } },
    ],
  };
  const built = buildRule({
    name: "双非抵消",
    before,
    after,
    weights: { NOT: 2 },
    note: "成本权重测试",
  });
  assert.ok(built.rule);
  const text = encodeExperiment(document, [built.rule!]);
  const parsed = JSON.parse(text);
  assert.equal(parsed.version, 2);
  const decoded = decodeExperiment(text);
  assert.equal(decoded.rules.length, 1);
  const rule = decoded.rules[0];
  assert.equal(rule.name, "双非抵消");
  assert.equal(rule.weights.NOT, 2);
  assert.equal(rule.inputs[0].name, "IN1");
  assert.equal(rule.outputs[0].name, "OUT1");
  assert.equal(rule.proof?.equivalent, true);
  // 主电路接法保持不变
  assert.equal(decoded.document.nodes.length, 3);
});

test("损坏或不支持的文件直接抛错，不返回半解析数据", () => {
  assert.throws(() => decodeExperiment("{not json"));
  assert.throws(() => decodeExperiment(JSON.stringify({ version: 99 })));
});
