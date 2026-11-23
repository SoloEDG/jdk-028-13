import type {
  CircuitDocument,
  GateNode,
  Point,
  Wire,
} from "@/shared/types";
import { getSpec } from "@/features/catalog";
import { topologicalOrder } from "@/features/circuit";
import { createId } from "@/shared/document";
import { evaluate } from "@/features/simulation";
import { readBoundary } from "./boundary";
import type { PreviewPlan, RewriteMatch, RewriteRule } from "./types";
import { MAX_FULL_CHECK_INPUTS } from "./types";

export interface ApplyResult {
  document: CircuitDocument;
  plan: PreviewPlan;
}

export function buildPlan(
  document: CircuitDocument,
  chosen: RewriteMatch[],
  ruleByIdForPlan: Map<string, RewriteRule>,
): PreviewPlan {
  const removedNodeIds = new Set<string>(),
    removedWireIds = new Set<string>();
  for (const match of chosen) {
    for (const id of match.hostNodeIds) removedNodeIds.add(id);
    for (const id of match.internalWireIds) removedWireIds.add(id);
  }
  const keptWireIds = document.wires
    .filter(
      (wire) =>
        !removedWireIds.has(wire.id) &&
        !removedNodeIds.has(wire.from.nodeId) &&
        !removedNodeIds.has(wire.to.nodeId),
    )
    .map((wire) => wire.id);
  let addedNodeCount = 0,
    addedWireCount = 0;
  for (const match of chosen) {
    const rule = ruleByIdForPlan.get(match.ruleId);
    if (!rule) continue;
    addedNodeCount += rule.after.nodes.filter(
      (node) => node.kind !== "INPUT" && node.kind !== "OUTPUT",
    ).length;
    addedWireCount += rule.after.wires.length;
  }
  return {
    removedNodeIds: [...removedNodeIds],
    removedWireIds: [...removedWireIds],
    keptWireIds,
    addedNodeCount,
    addedWireCount,
    matches: chosen,
  };
}

function centroid(document: CircuitDocument, ids: string[]): Point {
  const points = document.nodes
    .filter((node) => ids.includes(node.id))
    .map((node) => ({ x: node.x, y: node.y }));
  if (!points.length) return { x: 400, y: 240 };
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

interface RewriteLayout {
  nodePositions: Map<string, Point>;
}

/** 新接法元件按拓扑层级排在原匹配区域中心附近，避免重叠 */
function layoutAfter(
  pattern: CircuitDocument,
  center: Point,
): RewriteLayout {
  const order = topologicalOrder(pattern);
  const levels = new Map<string, number>();
  for (const id of order) {
    const incoming = pattern.wires.filter((wire) => wire.to.nodeId === id);
    levels.set(
      id,
      incoming.length
        ? Math.max(
            ...incoming.map((wire) => (levels.get(wire.from.nodeId) ?? 0) + 1),
          )
        : 0,
    );
  }
  const byLevel = new Map<number, string[]>();
  for (const [id, level] of levels) {
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push(id);
  }
  const nodePositions = new Map<string, Point>();
  const gapX = 150,
    gapY = 110;
  for (const [level, ids] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    ids.forEach((id, index) => {
      nodePositions.set(id, {
        x: Math.round(center.x + (level - 1) * gapX),
        y: Math.round(center.y + (index - (ids.length - 1) / 2) * gapY),
      });
    });
  }
  return { nodePositions };
}

interface PreparedMatch {
  match: RewriteMatch;
  rule: RewriteRule;
  /** 新模式节点 id -> 新电路节点 id */
  idMap: Map<string, string>;
  center: Point;
}

/**
 * 事务式批量替换：在文档副本上执行，任何一步校验失败都抛出异常，
 * 调用方保留原图不变。外部扇出分支完整保留并重接到新边界输出。
 */
export function applyMatches(
  source: CircuitDocument,
  chosen: RewriteMatch[],
  ruleById: Map<string, RewriteRule>,
): ApplyResult {
  const document: CircuitDocument = JSON.parse(JSON.stringify(source));
  const removedNodeIds = new Set<string>(),
    removedWireIds = new Set<string>();
  // 不相交校验（选择器已保证，这里再防御一次）
  for (const match of chosen) {
    for (const id of match.hostNodeIds)
      if (removedNodeIds.has(id))
        throw new Error(`匹配在元件 ${id} 上重叠，不能同时替换`);
  }
  const prepared: PreparedMatch[] = [];
  for (const match of chosen) {
    const rule = ruleById.get(match.ruleId);
    if (!rule) throw new Error(`替换规则「${match.ruleName}」已不存在`);
    if (!rule.proof?.equivalent)
      throw new Error(`规则「${rule.name}」缺少等价性证明，已阻止替换`);
    const center = centroid(document, match.hostNodeIds);
    prepared.push({ match, rule, idMap: new Map(), center });
    for (const id of match.hostNodeIds) removedNodeIds.add(id);
    for (const id of match.internalWireIds) removedWireIds.add(id);
  }
  // 1) 拆除被替换区域：任何触碰拆除节点的连线都先下线，
  //    稍后严格按边界绑定重连，避免残留悬空引用
  document.wires = document.wires.filter((wire) => {
    if (removedWireIds.has(wire.id)) return false;
    return (
      !removedNodeIds.has(wire.from.nodeId) &&
      !removedNodeIds.has(wire.to.nodeId)
    );
  });
  document.nodes = document.nodes.filter(
    (node) => !removedNodeIds.has(node.id),
  );

  // 2) 放入每个规则的新接法（克隆并重新编号，不沿用模式里的编号/坐标）
  const existingNodeIds = new Set(document.nodes.map((node) => node.id));
  const newNodes: GateNode[] = [],
    newWires: Wire[] = [];
  for (const item of prepared) {
    const { rule } = item;
    const layout = layoutAfter(rule.after, item.center);
    const boundaryIds = new Set([
      ...readBoundary(rule.after).inputs.map((ref) => ref.nodeId),
      ...readBoundary(rule.after).outputs.map((ref) => ref.nodeId),
    ]);
    for (const node of rule.after.nodes) {
      // 虚拟 INPUT/OUTPUT 边界节点不进入实际电路
      if (boundaryIds.has(node.id)) {
        item.idMap.set(node.id, createId("boundary"));
        continue;
      }
      const newId = createId("gate");
      item.idMap.set(node.id, newId);
      existingNodeIds.add(newId);
      const position = layout.nodePositions.get(node.id) ?? item.center;
      newNodes.push({
        id: newId,
        kind: node.kind,
        label: node.label,
        value: node.value,
        x: clamp(position.x, 24, 864),
        y: clamp(position.y, 48, 412),
      });
    }
    for (const wire of rule.after.wires) {
      // 触碰虚拟边界节点的连线不实例化：由步骤 3/4 按外部绑定统一重连
      if (boundaryIds.has(wire.from.nodeId) || boundaryIds.has(wire.to.nodeId))
        continue;
      const newId = createId("wire");
      newWires.push({
        id: newId,
        from: {
          nodeId: item.idMap.get(wire.from.nodeId)!,
          port: wire.from.port,
        },
        to: {
          nodeId: item.idMap.get(wire.to.nodeId)!,
          port: wire.to.port,
        },
      });
    }
  }
  document.nodes.push(...newNodes);
  document.wires.push(...newWires);

  // 3) 重连边界输入：外部驱动跨过虚拟 INPUT 节点，接到它在新接法里驱动的内部端口
  for (const item of prepared) {
    const afterBoundary = readBoundary(item.rule.after);
    const boundaryIds = new Set([
      ...afterBoundary.inputs.map((ref) => ref.nodeId),
      ...afterBoundary.outputs.map((ref) => ref.nodeId),
    ]);
    for (const binding of item.match.inputBindings) {
      const boundaryNode = afterBoundary.inputs.find(
        (ref) => ref.name === binding.name,
      );
      if (!boundaryNode)
        throw new Error(`规则缺少边界输入「${binding.name}」`);
      if (!binding.driver) continue; // 悬空输入保持悬空
      if (removedNodeIds.has(binding.driver.nodeId))
        throw new Error(
          `边界输入「${binding.name}」的驱动端位于另一个被替换区域，无法重连`,
        );
      const sinks = item.rule.after.wires.filter(
        (wire) =>
          wire.from.nodeId === boundaryNode.nodeId &&
          !boundaryIds.has(wire.to.nodeId),
      );
      for (const sink of sinks) {
        document.wires.push({
          id: createId("wire"),
          from: { ...binding.driver },
          to: {
            nodeId: item.idMap.get(sink.to.nodeId)!,
            port: sink.to.port,
          },
        });
      }
      // 若该 INPUT 直接通向边界 OUTPUT（零门直通），由步骤 4 的扇出重连处理
    }
  }

  // 4) 重连边界输出：新接法跟踪的信号 -> 原外部扇出全部分支
  for (const item of prepared) {
    const afterBoundary = readBoundary(item.rule.after);
    for (const binding of item.match.outputBindings) {
      const outputRef = afterBoundary.outputs.find(
        (ref) => ref.name === binding.name,
      );
      if (!outputRef) throw new Error(`规则缺少边界输出「${binding.name}」`);
      const indicatorWire = item.rule.after.wires.find(
        (wire) => wire.to.nodeId === outputRef.nodeId,
      )!;
      const sourcePatternNode = item.rule.after.nodes.find(
        (node) => node.id === indicatorWire.from.nodeId,
      )!;
      const newSourceId = item.idMap.get(indicatorWire.from.nodeId)!;
      if (sourcePatternNode.kind === "INPUT") {
        // 新接法为边界直通（零门消除）：把外部扇出接到对应边界输入的驱动端
        const inputRef = afterBoundary.inputs.find(
          (ref) => ref.nodeId === sourcePatternNode.id,
        );
        const inputBinding = item.match.inputBindings.find(
          (b) => b.name === inputRef?.name,
        );
        for (const oldWire of binding.externalWires) {
          if (!inputBinding?.driver)
            throw new Error(
              `边界输出「${binding.name}」直通的边界输入没有外部驱动，无法保留扇出`,
            );
          document.wires.push({
            id: createId("wire"),
            from: { ...inputBinding.driver },
            to: { ...oldWire.to },
          });
        }
        continue;
      }
      for (const oldWire of binding.externalWires) {
        // 外部扇出分支完整保留：目标端口不变，只把源切到新内部信号
        document.wires.push({
          id: createId("wire"),
          from: { nodeId: newSourceId, port: indicatorWire.from.port },
          to: { ...oldWire.to },
        });
      }
    }
  }

  // 5) 结构校验：无环、端口合法、无重复输入占用
  topologicalOrder(document);
  validatePorts(document);
  if (document.nodes.length > 120 || document.wires.length > 480)
    throw new Error("替换后超出工作台容量（120 元件 / 480 连线），请缩小规则");

  // 6) 整电路三值复核（规模允许时）：不只是当前开关
  if (countInputs(document) <= MAX_FULL_CHECK_INPUTS)
    verifyFullEquivalence(source, document);

  return { document, plan: buildPlan(source, chosen, ruleById) };
}

function countInputs(document: CircuitDocument): number {
  return document.nodes.filter((node) => node.kind === "INPUT").length;
}

function validatePorts(document: CircuitDocument): void {
  const occupied = new Set<string>();
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  for (const wire of document.wires) {
    const from = nodes.get(wire.from.nodeId),
      to = nodes.get(wire.to.nodeId);
    if (!from || !to) throw new Error("替换产生了悬空连线引用");
    if (
      wire.from.port < 0 ||
      wire.from.port >= getSpec(from.kind).outputs ||
      wire.to.port < 0 ||
      wire.to.port >= getSpec(to.kind).inputs
    )
      throw new Error("替换产生了非法端口连接");
    const key = `${wire.to.nodeId}:${wire.to.port}`;
    if (occupied.has(key)) throw new Error("替换后同一输入端口被重复驱动");
    occupied.add(key);
  }
}

/** 对整电路所有输入枚举 0/1/X，比较替换前后每个留存节点的信号 */
function verifyFullEquivalence(
  before: CircuitDocument,
  after: CircuitDocument,
): void {
  const beforeInputs = before.nodes
      .filter((node) => node.kind === "INPUT")
      .sort((a, b) => a.label.localeCompare(b.label)),
    afterInputs = after.nodes
      .filter((node) => node.kind === "INPUT")
      .sort((a, b) => a.label.localeCompare(b.label));
  if (beforeInputs.length !== afterInputs.length)
    throw new Error("替换改变了输入开关数量，无法保证对外等价");
  if (
    beforeInputs.some((node, index) => node.label !== afterInputs[index].label)
  )
    throw new Error("替换改变了输入开关名称，无法按同名边界复核三值结果");
  const trits: Array<0 | 1 | "X"> = [0, 1, "X"];
  const rows = enumerate(beforeInputs.length, trits);
  for (const row of rows) {
    const overridesBefore: Record<string, 0 | 1 | "X"> = {},
      overridesAfter: Record<string, 0 | 1 | "X"> = {};
    beforeInputs.forEach((node, index) => {
      overridesBefore[node.id] = row[index];
    });
    afterInputs.forEach((node, index) => {
      overridesAfter[node.id] = row[index];
    });
    const rb = evaluate(before, overridesBefore),
      ra = evaluate(after, overridesAfter);
    for (const node of before.nodes) {
      if (node.kind === "INPUT") continue;
      const afterNode = after.nodes.find((candidate) => candidate.id === node.id);
      if (!afterNode) continue; // 被替换掉的内部节点不要求留存
      if (rb.values[node.id] !== ra.values[afterNode.id])
        throw new Error(
          `全取值复核失败：节点「${node.label}」在某组输入（含悬空 X）下信号改变`,
        );
    }
  }
}

function enumerate(
  count: number,
  alphabet: Array<0 | 1 | "X">,
): Array<Array<0 | 1 | "X">> {
  let rows: Array<Array<0 | 1 | "X">> = [[]];
  for (let i = 0; i < count; i++) {
    const next: Array<Array<0 | 1 | "X">> = [];
    for (const row of rows) for (const value of alphabet) next.push([...row, value]);
    rows = next;
  }
  return rows;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
