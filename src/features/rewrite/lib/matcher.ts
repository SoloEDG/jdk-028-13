import type { CircuitDocument, Wire } from "@/shared/types";
import { getSpec } from "@/features/catalog";
import { topologicalOrder } from "@/features/circuit";
import {
  isCommutative,
  isInternalNode,
  patternCost,
  readBoundary,
  validatePattern,
} from "./boundary";
import type {
  InputBinding,
  OutputBinding,
  RewriteMatch,
  RewriteRule,
} from "./types";

interface PatternIndex {
  internalIds: string[];
  incoming: Map<string, Wire[]>;
  outgoing: Map<string, Wire[]>;
  inputNodeByName: Map<string, string>;
  outputNodeByName: Map<string, string>;
  /** 模式内部门 id -> 它驱动的边界输出名（至多一个） */
  boundaryOutputOf: Map<string, string>;
}

function indexPattern(document: CircuitDocument): PatternIndex {
  const boundary = readBoundary(document);
  const internalIds = document.nodes.filter(isInternalNode).map((n) => n.id);
  const incoming = new Map(internalIds.map((id) => [id, [] as Wire[]]));
  const outgoing = new Map(internalIds.map((id) => [id, [] as Wire[]]));
  for (const wire of document.wires) {
    if (incoming.has(wire.to.nodeId)) incoming.get(wire.to.nodeId)!.push(wire);
    if (outgoing.has(wire.from.nodeId))
      outgoing.get(wire.from.nodeId)!.push(wire);
  }
  const boundaryOutputOf = new Map<string, string>();
  for (const ref of boundary.outputs) {
    const wire = document.wires.find((w) => w.to.nodeId === ref.nodeId)!;
    boundaryOutputOf.set(wire.from.nodeId, ref.name);
  }
  return {
    internalIds,
    incoming,
    outgoing,
    inputNodeByName: new Map(boundary.inputs.map((r) => [r.name, r.nodeId])),
    outputNodeByName: new Map(boundary.outputs.map((r) => [r.name, r.nodeId])),
    boundaryOutputOf,
  };
}

interface HostIndex {
  nodesById: Map<string, CircuitDocument["nodes"][number]>;
  incoming: Map<string, Wire[]>;
  outgoing: Map<string, Wire[]>;
}

function indexHost(document: CircuitDocument): HostIndex {
  const incoming = new Map(document.nodes.map((n) => [n.id, [] as Wire[]]));
  const outgoing = new Map(document.nodes.map((n) => [n.id, [] as Wire[]]));
  for (const wire of document.wires) {
    incoming.get(wire.to.nodeId)?.push(wire);
    outgoing.get(wire.from.nodeId)?.push(wire);
  }
  return {
    nodesById: new Map(document.nodes.map((n) => [n.id, n])),
    incoming,
    outgoing,
  };
}

/** 输入脚可交换时允许的端口置换：恒等，以及双输入门的交换 */
function portPermutations(
  kind: CircuitDocument["nodes"][number]["kind"],
  portCount: number,
): number[][] {
  const identity = Array.from({ length: portCount }, (_, i) => i);
  return portCount === 2 && isCommutative(kind)
    ? [identity, [1, 0]]
    : [identity];
}

type Driver = { nodeId: string; port: number } | null;

function sameDriver(a: Driver, b: Driver): boolean {
  if (a === null || b === null) return a === b;
  return a.nodeId === b.nodeId && a.port === b.port;
}

function nameOfBoundaryInput(rule: RewriteRule, nodeId: string): string {
  return rule.before.nodes.find((n) => n.id === nodeId)?.label ?? nodeId;
}

/**
 * 在当前电路中查找规则 before 模式可应用的位置。
 * 匹配只依据元件类型与连线拓扑，不使用元件编号或摆放坐标；
 * 可交换输入脚按等价端口处理；悬空脚与外部扇出都做安全校验。
 */
export function findMatches(
  host: CircuitDocument,
  rule: RewriteRule,
  limit = 200,
): RewriteMatch[] {
  if (!rule.proof?.equivalent) return [];
  if (validatePattern(rule.before, true) || validatePattern(rule.after, false))
    return [];
  const pattern = indexPattern(rule.before),
    hostIndex = indexHost(host);
  const order = topologicalOrder(rule.before).filter((id) =>
    pattern.internalIds.includes(id),
  );
  const matches: RewriteMatch[] = [];
  const seen = new Set<string>();
  const nodeMap = new Map<string, string>();
  const inputDrivers = new Map<string, Driver>();

  /**
   * 尝试把模式节点放到宿主节点上。
   * 成功返回合并后的边界驱动表（调用方负责提交/回滚），失败返回 null。
   */
  function tryPlace(
    patternNodeId: string,
    hostNodeId: string,
  ): Map<string, Driver> | null {
    const pNode = rule.before.nodes.find((n) => n.id === patternNodeId)!;
    const hNode = hostIndex.nodesById.get(hostNodeId)!;
    if (pNode.kind !== hNode.kind) return null;
    const portCount = getSpec(hNode.kind).inputs;
    const hWireByPort = new Map(
      (hostIndex.incoming.get(hostNodeId) ?? []).map((w) => [w.to.port, w]),
    );
    const pWireByPort = new Map(
      (pattern.incoming.get(patternNodeId) ?? []).map((w) => [w.to.port, w]),
    );
    for (const permutation of portPermutations(hNode.kind, portCount)) {
      const drivers = new Map(inputDrivers);
      let ok = true;
      for (let patternPort = 0; patternPort < portCount; patternPort++) {
        const hostPort = permutation[patternPort];
        const pWire = pWireByPort.get(patternPort);
        const hWire = hWireByPort.get(hostPort);
        if (!pWire) {
          if (hWire) {
            ok = false;
            break;
          }
          continue;
        }
        const source = pWire.from;
        if (nodeMap.has(source.nodeId)) {
          if (
            !hWire ||
            hWire.from.nodeId !== nodeMap.get(source.nodeId) ||
            hWire.from.port !== source.port
          ) {
            ok = false;
            break;
          }
        } else {
          const name = nameOfBoundaryInput(rule, source.nodeId);
          const binding: Driver = hWire
            ? { nodeId: hWire.from.nodeId, port: hWire.from.port }
            : null;
          if (drivers.has(name) && !sameDriver(drivers.get(name)!, binding)) {
            ok = false;
            break;
          }
          drivers.set(name, binding);
        }
      }
      const explainedHostPorts = new Set(
        [...pWireByPort.keys()].map((p) => permutation[p]),
      );
      if (ok)
        for (const port of hWireByPort.keys())
          if (!explainedHostPorts.has(port)) {
            ok = false;
            break;
          }
      if (ok) return drivers;
    }
    return null;
  }

  /** 外部扇出安全校验：未声明为边界输出的内部信号不允许被外界使用 */
  function checkFanout(): {
    outputBindings: OutputBinding[];
    internalWireIds: string[];
    reason: string | null;
  } {
    const outputExternal = new Map<string, Wire[]>();
    const internalWireIds: string[] = [];
    const mappedHostIds = new Set(nodeMap.values());
    for (const [pId, hId] of nodeMap) {
      for (const wire of hostIndex.outgoing.get(hId) ?? []) {
        if (mappedHostIds.has(wire.to.nodeId)) {
          // 去向已映射内部门：该内部边必须在模式中存在，否则属于未写出的支路
          const reverse = [...nodeMap.entries()].find(
            ([, hostId]) => hostId === wire.to.nodeId,
          )![0];
          const exists = (pattern.outgoing.get(pId) ?? []).some(
            (w) => w.to.nodeId === reverse,
          );
          if (!exists)
            return {
              outputBindings: [],
              internalWireIds: [],
              reason: "映射区域内存在模式未写出的内部连线",
            };
          internalWireIds.push(wire.id);
        } else {
          const outputName = pattern.boundaryOutputOf.get(pId);
          if (!outputName)
            return {
              outputBindings: [],
              internalWireIds: [],
              reason: `内部门「${hostIndex.nodesById.get(hId)!.label}」的输出被外界使用，但模式未把它声明为边界输出`,
            };
          if (!outputExternal.has(outputName))
            outputExternal.set(outputName, []);
          outputExternal.get(outputName)!.push(wire);
        }
      }
    }
    const outputBindings: OutputBinding[] = [...pattern.boundaryOutputOf].map(
      ([pId, name]) => ({
        name,
        sourceNodeId: nodeMap.get(pId)!,
        externalWires: outputExternal.get(name) ?? [],
      }),
    );
    return { outputBindings, internalWireIds, reason: null };
  }

  function backtrack(depth: number): void {
    if (matches.length >= limit) return;
    if (depth === order.length) {
      const fanout = checkFanout();
      if (fanout.reason) return;
      const nodeMapRecord: Record<string, string> = {};
      for (const [pId, hId] of nodeMap) nodeMapRecord[pId] = hId;
      const inputBindings: InputBinding[] = readBoundary(
        rule.before,
      ).inputs.map((ref) => ({
        name: ref.name,
        driver: inputDrivers.get(ref.name) ?? null,
      }));
      const hostNodeIds = [...nodeMap.values()].sort();
      const bindingKey = inputBindings
        .map(
          (b) =>
            `${b.name}>${b.driver ? `${b.driver.nodeId}:${b.driver.port}` : "X"}`,
        )
        .sort();
      const key = [
        rule.id,
        ...hostNodeIds.map(
          (hId) =>
            `${[...nodeMap.entries()].find(([, v]) => v === hId)![0]}=${hId}`,
        ),
        ...bindingKey,
      ].join("|");
      if (seen.has(key)) return;
      seen.add(key);
      const beforeCost = patternCost(rule.before, rule.weights),
        afterCost = patternCost(rule.after, rule.weights);
      matches.push({
        key,
        ruleId: rule.id,
        ruleName: rule.name,
        nodeMap: nodeMapRecord,
        inputBindings,
        outputBindings: fanout.outputBindings,
        internalWireIds: fanout.internalWireIds,
        hostNodeIds,
        gain: beforeCost - afterCost,
        beforeCost,
        afterCost,
      });
      return;
    }
    const patternNodeId = order[depth];
    const pNode = rule.before.nodes.find((n) => n.id === patternNodeId)!;
    const used = new Set(nodeMap.values());
    for (const hostNode of host.nodes) {
      if (hostNode.kind !== pNode.kind || used.has(hostNode.id)) continue;
      const merged = tryPlace(patternNodeId, hostNode.id);
      if (!merged) continue;
      const previousDrivers = new Map(inputDrivers);
      for (const [name, driver] of merged) inputDrivers.set(name, driver);
      nodeMap.set(patternNodeId, hostNode.id);
      backtrack(depth + 1);
      nodeMap.delete(patternNodeId);
      inputDrivers.clear();
      for (const [name, driver] of previousDrivers)
        inputDrivers.set(name, driver);
      if (matches.length >= limit) return;
    }
  }

  backtrack(0);
  return matches;
}

export function findAllMatches(
  host: CircuitDocument,
  rules: RewriteRule[],
): RewriteMatch[] {
  const all: RewriteMatch[] = [];
  for (const rule of rules) all.push(...findMatches(host, rule));
  return all;
}
