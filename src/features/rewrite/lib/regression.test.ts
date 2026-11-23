import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../../simulation/lib/evaluate";
import { sampleCircuit } from "../../workspace/lib/seeds";
import { truthTable } from "../../challenge/lib/truthTable";
import { targetById } from "../../challenge/lib/targets";

test("原有异或示例的仿真与真值表检测保持不变", () => {
  const doc = sampleCircuit();
  const sim = evaluate(doc);
  const y = doc.nodes.find((n) => n.label === "Y")!;
  // A=0,B=0 时异或输出为 0
  assert.equal(sim.values[y.id], 0);
  // 切换到 A=1,B=1 仍为 0
  const a = doc.nodes.find((n) => n.label === "A")!;
  const b = doc.nodes.find((n) => n.label === "B")!;
  const sim2 = evaluate(doc, { [a.id]: 1, [b.id]: 1 });
  assert.equal(sim2.values[y.id], 0);
  // A=1,B=0 输出 1
  const sim3 = evaluate(doc, { [a.id]: 1, [b.id]: 0 });
  assert.equal(sim3.values[y.id], 1);
  const table = truthTable(doc, targetById("xor"));
  assert.equal(table.error, null);
  assert.ok(table.rows.every((row) => row.matches), "异或示例应继续通过目标检测");
});

test("悬空信号继续按 X 传播（NOT 对 X 输出 X）", () => {
  const doc = sampleCircuit();
  // 删掉 A 的连线影响，构造一个悬空 NOT 输入
  const partial: typeof doc = {
    ...doc,
    nodes: [
      { id: "i", kind: "INPUT", label: "I", value: 0, x: 40, y: 100 },
      { id: "n", kind: "NOT", label: "N", value: 0, x: 300, y: 100 },
      { id: "o", kind: "OUTPUT", label: "O", value: 0, x: 600, y: 100 },
    ],
    wires: [
      { id: "w", from: { nodeId: "n", port: 0 }, to: { nodeId: "o", port: 0 } },
    ],
  };
  const sim = evaluate(partial);
  assert.equal(sim.values.o, "X", "NOT 悬空输入必须产生未知 X");
});
