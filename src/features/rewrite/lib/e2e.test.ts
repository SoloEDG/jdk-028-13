import assert from "node:assert/strict";
import { test } from "node:test";
import type { CircuitDocument } from "../../shared/types";
import { buildRule } from "./factory";
import { findAllMatches } from "./matcher";
import { selectMatches } from "./selection";
import { applyMatches } from "./apply";
import { evaluate } from "../../simulation/lib/evaluate";

test("端到端：建立规则后批量替换，重新检测时旧匹配消失且三值行为保持", () => {
  // 主电路：两条独立的双 NOT 链，外加一个被保留的外部扇出
  const host: CircuitDocument = {
    version: 1,
    name: "e2e",
    targetId: "xor",
    nodes: [
      { id: "a", kind: "INPUT", label: "A", value: 0, x: 40, y: 80 },
      { id: "b", kind: "INPUT", label: "B", value: 0, x: 40, y: 360 },
      { id: "n1", kind: "NOT", label: "N1", value: 0, x: 240, y: 80 },
      { id: "n2", kind: "NOT", label: "N2", value: 0, x: 440, y: 80 },
      { id: "n3", kind: "NOT", label: "N3", value: 0, x: 240, y: 360 },
      { id: "n4", kind: "NOT", label: "N4", value: 0, x: 440, y: 360 },
      { id: "y", kind: "OUTPUT", label: "Y", value: 0, x: 760, y: 100 },
      { id: "z", kind: "OUTPUT", label: "Z", value: 0, x: 760, y: 380 },
    ],
    wires: [
      { id: "w1", from: { nodeId: "a", port: 0 }, to: { nodeId: "n1", port: 0 } },
      { id: "w2", from: { nodeId: "n1", port: 0 }, to: { nodeId: "n2", port: 0 } },
      { id: "w3", from: { nodeId: "n2", port: 0 }, to: { nodeId: "y", port: 0 } },
      { id: "w4", from: { nodeId: "b", port: 0 }, to: { nodeId: "n3", port: 0 } },
      { id: "w5", from: { nodeId: "n3", port: 0 }, to: { nodeId: "n4", port: 0 } },
      { id: "w6", from: { nodeId: "n4", port: 0 }, to: { nodeId: "z", port: 0 } },
    ],
  };
  // 规则 before：双 NOT；after：直通
  const before: CircuitDocument = {
    version: 1,
    name: "p",
    targetId: "xor",
    nodes: [
      { id: "pi", kind: "INPUT", label: "IN1", value: 0, x: 40, y: 160 },
      { id: "pn1", kind: "NOT", label: "A", value: 0, x: 280, y: 120 },
      { id: "pn2", kind: "NOT", label: "B", value: 0, x: 500, y: 120 },
      { id: "po", kind: "OUTPUT", label: "OUT1", value: 0, x: 740, y: 140 },
    ],
    wires: [
      { id: "pw1", from: { nodeId: "pi", port: 0 }, to: { nodeId: "pn1", port: 0 } },
      { id: "pw2", from: { nodeId: "pn1", port: 0 }, to: { nodeId: "pn2", port: 0 } },
      { id: "pw3", from: { nodeId: "pn2", port: 0 }, to: { nodeId: "po", port: 0 } },
    ],
  };
  const after: CircuitDocument = {
    version: 1,
    name: "p",
    targetId: "xor",
    nodes: [
      { id: "ai", kind: "INPUT", label: "IN1", value: 0, x: 40, y: 160 },
      { id: "ao", kind: "OUTPUT", label: "OUT1", value: 0, x: 600, y: 160 },
    ],
    wires: [
      { id: "aw1", from: { nodeId: "ai", port: 0 }, to: { nodeId: "ao", port: 0 } },
    ],
  };
  const built = buildRule({ name: "双非抵消", before, after, weights: {}, note: "" });
  assert.ok(built.rule, built.error ?? "rule");
  const rule = built.rule!;
  const ruleById = new Map([[rule.id, rule]]);

  // 第一轮检测：两条不相交链各一个匹配
  const first = findAllMatches(host, [rule]);
  assert.equal(first.length, 2);
  const selected = selectMatches(first, new Set());
  assert.equal(selected.chosen.length, 2, "两条链不相交，应同时选中");
  assert.equal(selected.totalGain, 4, "每处减少 2 个门成本，共 4");

  // 一次生效
  const result = applyMatches(host, selected.chosen, ruleById);
  const next = result.document;
  assert.equal(next.nodes.filter((n) => n.kind === "NOT").length, 0);
  assert.equal(next.nodes.filter((n) => n.kind === "INPUT").length, 2);
  assert.equal(next.nodes.filter((n) => n.kind === "OUTPUT").length, 2);

  // 三值行为：Y == A，Z == B，含 X
  for (const av of [0, 1, "X"] as const)
    for (const bv of [0, 1, "X"] as const) {
      const sim = evaluate(next, { a: av, b: bv });
      assert.equal(sim.values.y, av);
      assert.equal(sim.values.z, bv);
    }

  // 重新检测：NOT 已全部消失，不再有匹配
  const second = findAllMatches(next, [rule]);
  assert.equal(second.length, 0);

  // 编号全部重新生成，确认不依赖原编号
  const oldIds = new Set(host.nodes.map((n) => n.id));
  assert.ok(!next.nodes.some((n) => oldIds.has(n.id) && n.kind !== "INPUT" && n.kind !== "OUTPUT"));
});
