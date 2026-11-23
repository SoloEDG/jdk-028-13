import type { CircuitDocument, GateNode } from "@/shared/types";
import type { BoundaryRef, GateWeights } from "./types";
import { DEFAULT_GATE_WEIGHT } from "./types";
import { getSpec } from "@/features/catalog";

export interface PatternBoundary {
  inputs: BoundaryRef[];
  outputs: BoundaryRef[];
}

/** 模式电路以 INPUT/OUTPUT 节点作为命名边界，边界名取节点 label */
export function readBoundary(document: CircuitDocument): PatternBoundary {
  const inputs: BoundaryRef[] = [],
    outputs: BoundaryRef[] = [];
  for (const node of document.nodes) {
    if (node.kind === "INPUT")
      inputs.push({ kind: "input", nodeId: node.id, name: node.label });
    else if (node.kind === "OUTPUT")
      outputs.push({ kind: "output", nodeId: node.id, name: node.label });
  }
  return { inputs, outputs };
}

/**
 * 校验模式电路。requireInternal 控制是否必须包含基础门：
 * 替换前必须有可替换的门；替换后允许零门的边界直通（门消除优化）。
 */
export function validatePattern(
  document: CircuitDocument,
  requireInternal = true,
): string | null {
  const inputCount = document.nodes.filter((n) => n.kind === "INPUT").length;
  const outputCount = document.nodes.filter(
    (n) => n.kind === "OUTPUT",
  ).length;
  if (!inputCount) return "替换模式至少需要一个输入开关作为命名边界输入";
  if (!outputCount) return "替换模式至少需要一个输出指示灯作为命名边界输出";
  const internal = document.nodes.filter(
    (n) => n.kind !== "INPUT" && n.kind !== "OUTPUT",
  );
  if (requireInternal && !internal.length)
    return "模式中没有基础门，无法构成可替换的接法";
  const names = new Set<string>();
  for (const node of document.nodes) {
    if (node.kind === "INPUT" || node.kind === "OUTPUT") {
      const name = node.label.trim();
      if (!name) return "存在未命名的边界输入或输出";
      if (names.has(name)) return `边界信号名「${name}」重复，请先改名`;
      names.add(name);
    }
  }
  // 每个边界输出指示灯必须恰好接一路内部驱动
  for (const node of document.nodes) {
    if (node.kind !== "OUTPUT") continue;
    const incoming = document.wires.filter((w) => w.to.nodeId === node.id);
    if (incoming.length !== 1)
      return `边界输出「${node.label}」必须恰好连接一个内部门输出`;
  }
  return null;
}

/** 校验 before/after 两个模式的命名边界集合一致（边界映射随规则保存） */
export function validateBoundaryPair(
  before: CircuitDocument,
  after: CircuitDocument,
): string | null {
  const b = readBoundary(before),
    a = readBoundary(after);
  const sameSet = (x: BoundaryRef[], y: BoundaryRef[]) => {
    const xs = x.map((r) => r.name).sort(),
      ys = y.map((r) => r.name).sort();
    return xs.length === ys.length && xs.every((v, i) => v === ys[i]);
  };
  if (!sameSet(b.inputs, a.inputs))
    return "替换前后的命名边界输入不一致，需保持相同的输入开关名称";
  if (!sameSet(b.outputs, a.outputs))
    return "替换前后的命名边界输出不一致，需保持相同的输出指示灯名称";
  return null;
}

export function isInternalNode(node: GateNode): boolean {
  return node.kind !== "INPUT" && node.kind !== "OUTPUT";
}

export function gateCost(kind: GateNode["kind"], weights: GateWeights): number {
  if (kind === "INPUT" || kind === "OUTPUT") return 0;
  const weight = weights[kind];
  return typeof weight === "number" && Number.isFinite(weight) && weight >= 0
    ? weight
    : DEFAULT_GATE_WEIGHT;
}

/** 模式成本只统计基础门，边界 INPUT/OUTPUT 不计成本 */
export function patternCost(
  document: CircuitDocument,
  weights: GateWeights,
): number {
  return document.nodes
    .filter(isInternalNode)
    .reduce((sum, node) => sum + gateCost(node.kind, weights), 0);
}

/** 输入脚是否可交换：NOT/OUTPUT 单脚无意义，双输入基础门视为对称等价 */
export function isCommutative(kind: GateNode["kind"]): boolean {
  return getSpec(kind).inputs === 2;
}
