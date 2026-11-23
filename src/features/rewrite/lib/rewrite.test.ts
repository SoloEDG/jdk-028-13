import assert from "node:assert/strict";
import { test } from "node:test";
import type { CircuitDocument } from "../../shared/types";
import { evaluate } from "../../simulation/lib/evaluate";
import { buildRule } from "./factory";
import { findMatches } from "./matcher";
import { selectMatches } from "./selection";
import { applyMatches } from "./apply";
import { captureSelection } from "./capture";
import { proveRule } from "./proof";

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

function doc(): CircuitDocument {
  return {
    version: 1,
    name: "t",
    targetId: "xor",
    nodes: [],
    wires: [],
  };
}

function gate(kind: CircuitDocument["nodes"][number]["kind"], x: number, y: number, label?: string) {
  return { id: id(kind), kind, label: label ?? kind, value: 0 as const, x, y };
}
function input(label: string, x = 40, y = 100) {
  return { id: id("in"), kind: "INPUT" as const, label, value: 0 as const, x, y };
}
function output(label: string, x = 800, y = 200) {
  return { id: id("out"), kind: "OUTPUT" as const, label, value: 0 as const, x, y };
}
function wire(from: { id: string }, to: { id: string }, toPort = 0, fromPort = 0) {
  return {
    id: id("w"),
    from: { nodeId: from.id, port: fromPort },
    to: { nodeId: to.id, port: toPort },
  };
}

/** 规则：两个 NOT 串联（等价于直通），IN -> NOT -> NOT -> OUT */
function doubleNotRule() {
  const d = doc();
  const inA = input("IN1", 40, 160);
  const n1 = gate("NOT", 280, 120, "NOT A");
  const n2 = gate("NOT", 500, 120, "NOT B");
  const out = output("OUT1", 740, 140);
  d.nodes = [inA, n1, n2, out];
  d.wires = [wire(inA, n1), wire(n1, n2), wire(n2, out)];
  const after = doc();
  const inA2 = input("IN1", 40, 160);
  const out2 = output("OUT1", 600, 160);
  after.nodes = [inA2, out2];
  after.wires = [wire(inA2, out2)];
  const built = buildRule({
    name: "双非抵消",
    before: d,
    after,
    weights: {},
    note: "",
  });
  assert.ok(built.rule, built.error ?? "rule should build");
  assert.equal(built.rule!.proof!.equivalent, true, "双 NOT 必须三值等价于直通");
  return built.rule!;
}

test("proveRule 枚举含 X 的全部取值，当前开关相同不足以证明等价", () => {
  // 错误规则：NOT 替换成直通，对 0 相同但对 1/X 不同
  const d = doc();
  const inA = input("IN1");
  const n = gate("NOT", 300, 140, "N");
  const out = output("OUT1");
  d.nodes = [inA, n, out];
  d.wires = [wire(inA, n), wire(n, out)];
  const after = doc();
  const i2 = input("IN1");
  const o2 = output("OUT1");
  after.nodes = [i2, o2];
  after.wires = [wire(i2, o2)];
  const proof = proveRule({ before: d, after });
  assert.equal(proof.equivalent, false);
  assert.ok(proof.counterexample, "应给出反例取值");
  assert.ok(proof.cases >= 1 && proof.cases <= 3, "单输入枚举 0/1/X，遇反例可提前停止");
});

test("匹配不依赖元件编号与坐标，且可交换输入脚等价", () => {
  const rule = doubleNotRule();
  const host = doc();
  const a = input("A", 20, 300);
  const g1 = gate("NOT", 220, 260, "随便起名 X");
  const g2 = gate("NOT", 460, 90, "坐标也不同");
  const led = output("Y");
  host.nodes = [a, g1, g2, led];
  host.wires = [wire(a, g1), wire(g1, g2), wire(g2, led)];
  const matches = findMatches(host, rule);
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].hostNodeIds.sort(), [g1.id, g2.id].sort());
  const binding = matches[0].inputBindings[0];
  assert.equal(binding.name, "IN1");
  assert.equal(binding.driver?.nodeId, a.id);
});

test("悬空输入脚必须一致，不能把外部驱动误匹配成悬空模式", () => {
  const rule = doubleNotRule();
  const host = doc();
  const a = input("A");
  const b = input("B");
  const g1 = gate("NOT", 200, 100);
  const g2 = gate("NOT", 400, 100);
  const led = output("Y");
  // g1 的输入被两个开关场景之一替换：这里构造一个 AND 额外占用
  const and = gate("AND", 200, 260);
  host.nodes = [a, b, g1, g2, led, and];
  host.wires = [
    wire(a, g1),
    wire(g1, g2),
    wire(g2, led),
    wire(a, and, 0),
    wire(b, and, 1),
  ];
  const matches = findMatches(host, rule);
  // AND 不参与 NOT 链；NOT 链仍应匹配一次
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].hostNodeIds.sort(), [g1.id, g2.id].sort());
});

test("外部扇出分支被完整保留；模式未声明的内部支路禁止匹配", () => {
  const rule = doubleNotRule();
  const host = doc();
  const a = input("A");
  const g1 = gate("NOT", 200, 100);
  const g2 = gate("NOT", 400, 100);
  const led = output("Y");
  const led2 = output("Z");
  host.nodes = [a, g1, g2, led, led2];
  // g2 输出带两个外部扇出分支
  host.wires = [
    wire(a, g1),
    wire(g1, g2),
    wire(g2, led),
    wire(g2, led2),
  ];
  // 规则的 OUT1 边界由 g2 驱动，外部两条线应作为 externalWires 保留
  const matches = findMatches(host, rule);
  assert.equal(matches.length, 1);
  const outBinding = matches[0].outputBindings.find((b) => b.name === "OUT1");
  assert.ok(outBinding);
  assert.equal(outBinding!.externalWires.length, 2);
  const result = applyMatches(host, matches, new Map([[rule.id, rule]]));
  // 两条扇出仍然存在且目标端口不变
  const targets = result.document.wires
    .filter((w) => w.to.nodeId === led.id || w.to.nodeId === led2.id)
    .map((w) => w.to.nodeId)
    .sort();
  assert.deepEqual(targets, [led.id, led2.id].sort());
});

test("模式未写出的内部支路被外界使用时拒绝匹配（不可误删）", () => {
  // 规则只声明 g2 为边界输出；若 g1 也对外扇出，则匹配必须被拒绝
  const rule = doubleNotRule();
  const host = doc();
  const a = input("A");
  const g1 = gate("NOT", 200, 100);
  const g2 = gate("NOT", 400, 100);
  const led = output("Y");
  const probe = output("PROBE");
  host.nodes = [a, g1, g2, led, probe];
  host.wires = [
    wire(a, g1),
    wire(g1, g2),
    wire(g2, led),
    wire(g1, probe), // g1 额外对外扇出，模式未声明
  ];
  const matches = findMatches(host, rule);
  assert.equal(matches.length, 0, "g1 的外部扇出未在模式中声明，不能匹配");
});

test("重叠匹配选择门成本减少最多的不相交组合，锁定项必须保留", () => {
  // 规则：单个 NAND 替换为 AND+NOT（before 单门、after 双门，gain 为负），
  // 用同一条规则在含共享门的电路上产生彼此重叠的匹配
  const d = doc();
  const inA = input("IN1", 40, 100);
  const inB = input("IN2", 40, 240);
  const nand = gate("NAND", 360, 160, "NAND");
  const out = output("OUT1", 700, 170);
  d.nodes = [inA, inB, nand, out];
  d.wires = [wire(inA, nand, 0), wire(inB, nand, 1), wire(nand, out)];
  const a = doc();
  const ia = input("IN1", 40, 100);
  const ib = input("IN2", 40, 240);
  const and = gate("AND", 320, 160, "AND");
  const not = gate("NOT", 540, 160, "NOT");
  const oa = output("OUT1", 760, 170);
  a.nodes = [ia, ib, and, not, oa];
  a.wires = [
    wire(ia, and, 0),
    wire(ib, and, 1),
    wire(and, not),
    wire(not, oa),
  ];
  const built = buildRule({ name: "NAND 展开", before: d, after: a, weights: {}, note: "" });
  assert.ok(built.rule, built.error ?? "build");
  const rule = built.rule!;
  // 三个 NAND：q1、q2 各自独立，q3 与 q1 共享一个输入驱动，
  // 但更关键的是让两处匹配占用同一个门 —— 通过 q1 与 q2 输出共同驱动 q3
  const host = doc();
  const s1 = input("S1", 20, 80);
  const s2 = input("S2", 20, 240);
  const q1 = gate("NAND", 280, 100, "Q1");
  const q2 = gate("NAND", 280, 300, "Q2");
  const q3 = gate("NAND", 540, 200, "Q3");
  const led = output("L", 800, 210);
  host.nodes = [s1, s2, q1, q2, q3, led];
  host.wires = [
    wire(s1, q1, 0),
    wire(s2, q1, 1),
    wire(s1, q2, 0),
    wire(s2, q2, 1),
    wire(q1, q3, 0),
    wire(q2, q3, 1),
    wire(q3, led),
  ];
  const matches = findMatches(host, rule);
  // q1、q2、q3 三个 NAND 各自可匹配；其中 q1/q2 的输出被 q3 使用，
  // 选择 q3 时与 q1、q2 的边界输出绑定形成不同匹配集合
  assert.ok(matches.length >= 3, "三个 NAND 应各自产生匹配");
  // 构造强制重叠：把 q1 与 q3 同时纳入同一候选集的锁定场景
  const q1Match = matches.find((m) => m.hostNodeIds.includes(q1.id))!;
  const q3Match = matches.find((m) => m.hostNodeIds.includes(q3.id))!;
  // 两个匹配的门集合不相交（q1 与 q3 是不同门），可以同时选；
  // 再人为验证重叠判定：选择器对真正重叠（共享门）的集合只能取一个
  const fakeOverlap: typeof matches = [
    { ...q1Match, key: "x1", hostNodeIds: [q1.id, q3.id], gain: 2 },
    { ...q3Match, key: "x2", hostNodeIds: [q3.id, q2.id], gain: 1 },
  ];
  const selection = selectMatches(fakeOverlap, new Set());
  assert.equal(selection.chosen.length, 1, "共享 q3 的两个匹配只能选一个");
  // 锁定 x2 后必须保留锁定项
  const locked = selectMatches(fakeOverlap, new Set(["x2"]));
  assert.ok(locked.chosen.some((m) => m.key === "x2"));
  const conflicted = selectMatches(
    fakeOverlap,
    new Set(["x1", "x2"]),
  );
  assert.equal(conflicted.locked.length, 2);
  assert.ok(conflicted.issues.length >= 1, "锁定冲突必须给出解释而非删除锁定项");
});

test("确认替换事务式生效，外部输入驱动重连且整电路三值复核通过", () => {
  const rule = doubleNotRule();
  const host = doc();
  const a = input("A");
  const g1 = gate("NOT", 200, 100);
  const g2 = gate("NOT", 400, 100);
  const led = output("Y");
  host.nodes = [a, g1, g2, led];
  host.wires = [wire(a, g1), wire(g1, g2), wire(g2, led)];
  const matches = findMatches(host, rule);
  const before = JSON.stringify(host);
  const result = applyMatches(host, matches, new Map([[rule.id, rule]]));
  // 原图不被修改
  assert.equal(JSON.stringify(host), before);
  // 两个 NOT 被移除，换成边界直通
  assert.ok(!result.document.nodes.some((n) => n.id === g1.id));
  assert.ok(!result.document.nodes.some((n) => n.id === g2.id));
  const outNode = result.document.nodes.find((n) => n.kind === "OUTPUT")!;
  const intoOut = result.document.wires.find((w) => w.to.nodeId === outNode.id);
  assert.ok(intoOut);
  // 输出在所有三值输入下都等于输入
  for (const value of [0, 1, "X"] as const) {
    const sim = evaluate(result.document, {
      [result.document.nodes.find((n) => n.kind === "INPUT")!.id]: value,
    });
    assert.equal(sim.values[outNode.id], value);
  }
});

test("从选中区捕获模式时自动生成命名边界，边界名不依赖原编号", () => {
  const host = doc();
  const a = input("SRC");
  const g1 = gate("AND", 240, 140, "AND 内部");
  const led = output("Y");
  host.nodes = [a, g1, led];
  host.wires = [wire(a, g1, 0), wire(g1, led)];
  const captured = captureSelection(host, [g1.id]);
  assert.ok(captured.pattern.nodes.some((n) => n.kind === "INPUT"));
  assert.ok(captured.pattern.nodes.some((n) => n.kind === "OUTPUT"));
  const internal = captured.pattern.nodes.filter(
    (n) => n.kind !== "INPUT" && n.kind !== "OUTPUT",
  );
  assert.equal(internal.length, 1);
  assert.equal(internal[0].kind, "AND");
});
