import type { CircuitDocument, GateNode, Wire } from "@/shared/types";
import { createId } from "@/shared/document";
import { getSpec } from "@/features/catalog";

export interface CaptureResult {
  pattern: CircuitDocument;
  /** 捕获区内部节点（原 id）与外部元件的连线，已转成命名边界节点 */
  boundaryInputCount: number;
  boundaryOutputCount: number;
}

/**
 * 把当前电路的选中子电路捕获成替换模式：
 * - 选中集合之外的输入驱动，替换为同名 INPUT 边界开关；
 * - 选中集合内部节点流向外部的支路，汇总到同名 OUTPUT 边界指示灯；
 * - 不依赖元件编号与坐标，坐标仅用于编辑器内摆放。
 */
export function captureSelection(
  host: CircuitDocument,
  selectedIds: string[],
  targetId = "xor",
): CaptureResult {
  const chosen = new Set(selectedIds);
  const internalNodes = host.nodes.filter(
    (node) => chosen.has(node.id) && node.kind !== "INPUT" && node.kind !== "OUTPUT",
  );
  if (!internalNodes.length)
    throw new Error("请至少选择一个基础门（AND/OR/NOT 等）作为替换接法");
  const internal = new Set(internalNodes.map((node) => node.id));
  const nodes: GateNode[] = internalNodes.map((node) => ({
    ...node,
    id: `p-${node.id}`,
  }));
  const idOf = (oldId: string) => `p-${oldId}`;
  const wires: Wire[] = [];
  const boundaryInputByKey = new Map<string, GateNode>();
  const boundaryOutputBySource = new Map<string, GateNode>();
  let inSeq = 0,
    outSeq = 0;

  function ensureInputBoundary(driver: GateNode): GateNode {
    const key = `${driver.id}:0`;
    const existing = boundaryInputByKey.get(key);
    if (existing) return existing;
    inSeq += 1;
    const node: GateNode = {
      id: createId("pattern-in"),
      kind: "INPUT",
      label: uniqueLabel(`IN${inSeq}`, nodes, boundaryInputByKey, boundaryOutputBySource),
      value: 0,
      x: 40,
      y: 60 + inSeq * 110,
    };
    boundaryInputByKey.set(key, node);
    nodes.push(node);
    return node;
  }

  function ensureOutputBoundary(source: GateNode): GateNode {
    const existing = boundaryOutputBySource.get(source.id);
    if (existing) return existing;
    outSeq += 1;
    const node: GateNode = {
      id: createId("pattern-out"),
      kind: "OUTPUT",
      label: uniqueLabel(`OUT${outSeq}`, nodes, boundaryInputByKey, boundaryOutputBySource),
      value: 0,
      x: 620,
      y: 60 + outSeq * 110,
    };
    boundaryOutputBySource.set(source.id, node);
    nodes.push(node);
    return node;
  }

  for (const node of internalNodes) {
    const incoming = host.wires.filter((wire) => wire.to.nodeId === node.id);
    const byPort = new Map(incoming.map((wire) => [wire.to.port, wire]));
    for (let port = 0; port < getSpec(node.kind).inputs; port++) {
      const wire = byPort.get(port);
      if (!wire) continue; // 悬空脚保留为悬空
      const source = host.nodes.find((n) => n.id === wire.from.nodeId)!;
      if (internal.has(source.id)) {
        wires.push({
          id: createId("pattern-wire"),
          from: { nodeId: idOf(source.id), port: wire.from.port },
          to: { nodeId: idOf(node.id), port },
        });
      } else {
        const boundary = ensureInputBoundary(source);
        wires.push({
          id: createId("pattern-wire"),
          from: { nodeId: boundary.id, port: 0 },
          to: { nodeId: idOf(node.id), port },
        });
      }
    }
  }
  // 外部扇出：内部节点流向选中区外的每条支路，都必须由边界输出承载
  for (const node of internalNodes) {
    const outgoing = host.wires.filter(
      (wire) => wire.from.nodeId === node.id && !internal.has(wire.to.nodeId),
    );
    if (!outgoing.length) continue;
    const boundary = ensureOutputBoundary(node);
    wires.push({
      id: createId("pattern-wire"),
      from: { nodeId: idOf(node.id), port: 0 },
      to: { nodeId: boundary.id, port: 0 },
    });
  }

  const pattern: CircuitDocument = {
    version: 1,
    name: "替换模式",
    targetId,
    nodes: normalizeLayout(nodes, wires),
    wires,
  };
  return {
    pattern,
    boundaryInputCount: boundaryInputByKey.size,
    boundaryOutputCount: boundaryOutputBySource.size,
  };
}

function uniqueLabel(
  base: string,
  nodes: GateNode[],
  inputs: Map<string, GateNode>,
  outputs: Map<string, GateNode>,
): string {
  const used = new Set([
    ...nodes.map((node) => node.label),
    ...[...inputs.values()].map((node) => node.label),
    ...[...outputs.values()].map((node) => node.label),
  ]);
  let label = base,
    seq = 2;
  while (used.has(label)) label = `${base}_${seq++}`;
  return label;
}

/** 模式坐标与主电路解耦：按拓扑层级重排，强调匹配不依赖摆放坐标 */
function normalizeLayout(nodes: GateNode[], wires: Wire[]): GateNode[] {
  const levelOf = new Map<string, number>();
  const remaining = new Set(nodes.map((node) => node.id));
  while (remaining.size) {
    for (const id of [...remaining]) {
      const incoming = wires.filter(
        (wire) => wire.to.nodeId === id && remaining.has(wire.from.nodeId),
      );
      if (!incoming.length) {
        levelOf.set(
          id,
          Math.max(
            0,
            ...wires
              .filter((wire) => wire.to.nodeId === id)
              .map((wire) => (levelOf.get(wire.from.nodeId) ?? 0) + 1),
          ),
        );
        remaining.delete(id);
      }
    }
  }
  const byLevel = new Map<number, GateNode[]>();
  for (const node of nodes) {
    const level = levelOf.get(node.id) ?? 0;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push(node);
  }
  const result: GateNode[] = [];
  for (const [level, group] of [...byLevel.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    group.forEach((node, index) => {
      result.push({
        ...node,
        x: 60 + level * 200,
        y: 60 + index * 120,
      });
    });
  }
  return result;
}

/** 深拷贝一个模式文档作为「替换后」的初始编辑稿 */
export function clonePattern(pattern: CircuitDocument): CircuitDocument {
  const old: CircuitDocument = JSON.parse(JSON.stringify(pattern));
  const remap = new Map<string, string>();
  const nodes = old.nodes.map((node) => {
    const newId = createId("p");
    remap.set(node.id, newId);
    return { ...node, id: newId };
  });
  const wires = old.wires.map((wire) => ({
    id: createId("pattern-wire"),
    from: { nodeId: remap.get(wire.from.nodeId)!, port: wire.from.port },
    to: { nodeId: remap.get(wire.to.nodeId)!, port: wire.to.port },
  }));
  return { ...old, nodes, wires };
}
