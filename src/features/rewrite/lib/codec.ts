import type {
  CircuitDocument,
  GateKind,
  GateNode,
  Signal,
  Wire,
} from "@/shared/types";
import { getSpec } from "@/features/catalog";
import { topologicalOrder } from "@/features/circuit";
import { gateSpecs } from "@/features/catalog";
import type { BoundaryRef, RewriteRule, RuleProof } from "./types";

export interface ExperimentFile {
  version: 2;
  name: string;
  document: CircuitDocument;
  rules: RewriteRule[];
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** 旧版（version:1）存档按原接法打开，不强制迁移 */
export function isLegacyDocument(data: unknown): data is CircuitDocument {
  return object(data) && data.version === 1;
}

export function decodeExperiment(text: string): {
  document: CircuitDocument;
  rules: RewriteRule[];
  warning: string | null;
} {
  if (text.length > 4_000_000)
    throw new Error("实验文件超过 4 MB，请缩小后再导入");
  const data: unknown = JSON.parse(text);
  if (!object(data)) throw new Error("文件格式或版本不受支持");
  if (isLegacyDocument(data)) {
    return {
      document: decodeCircuit(data),
      rules: [],
      warning: "旧版实验已按原接法打开；替换规则需要重新建立并随新实验导出。",
    };
  }
  if (data.version !== 2 || !object(data.document) || !Array.isArray(data.rules))
    throw new Error("文件格式或版本不受支持");
  const document = decodeCircuit(data.document);
  const rules = decodeRules(data.rules);
  return { document, rules, warning: null };
}

export function encodeExperiment(
  document: CircuitDocument,
  rules: RewriteRule[],
): string {
  const file: ExperimentFile = {
    version: 2,
    name: document.name,
    document,
    rules,
  };
  return JSON.stringify(file, null, 2);
}

function decodeCircuit(data: Record<string, unknown>): CircuitDocument {
  if (
    typeof data.name !== "string" ||
    data.name.length > 80 ||
    !["xor", "and", "or"].includes(String(data.targetId)) ||
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.wires)
  )
    throw new Error("文件格式或版本不受支持");
  if (data.nodes.length > 120 || data.wires.length > 480)
    throw new Error("实验最多支持 120 个元件、480 条连线");
  const ids = new Set<string>();
  const nodes: GateNode[] = data.nodes.map((value) => {
    if (
      !object(value) ||
      typeof value.id !== "string" ||
      !value.id ||
      value.id.length > 100 ||
      ids.has(value.id) ||
      typeof value.kind !== "string" ||
      typeof value.label !== "string" ||
      value.label.length > 40 ||
      !Number.isFinite(value.x) ||
      !Number.isFinite(value.y) ||
      (value.value !== 0 && value.value !== 1)
    )
      throw new Error("元件内容无效或编号重复");
    const spec = getSpec(value.kind);
    ids.add(value.id);
    if (
      Number(value.x) < 20 ||
      Number(value.x) > 880 ||
      Number(value.y) < 40 ||
      Number(value.y) > 420
    )
      throw new Error("元件坐标超出工作台范围");
    return {
      id: value.id,
      kind: spec.kind,
      label: value.label,
      x: Number(value.x),
      y: Number(value.y),
      value: value.value,
    };
  });
  const wireIds = new Set<string>(),
    occupied = new Set<string>();
  const wires: Wire[] = data.wires.map((value) => {
    if (
      !object(value) ||
      typeof value.id !== "string" ||
      !value.id ||
      ids.has(value.id) ||
      wireIds.has(value.id) ||
      !object(value.from) ||
      !object(value.to)
    )
      throw new Error("连线内容无效或编号重复");
    const fromId = value.from.nodeId,
      toId = value.to.nodeId;
    const from = nodes.find((n) => n.id === fromId),
      to = nodes.find((n) => n.id === toId);
    const fp = value.from.port,
      tp = value.to.port;
    if (
      !from ||
      !to ||
      from === to ||
      !Number.isInteger(fp) ||
      !Number.isInteger(tp) ||
      Number(fp) < 0 ||
      Number(fp) >= getSpec(from.kind).outputs ||
      Number(tp) < 0 ||
      Number(tp) >= getSpec(to.kind).inputs
    )
      throw new Error("连线引用了无效端口");
    const key = `${to.id}:${tp}`;
    if (occupied.has(key)) throw new Error("同一输入端口不能连接两个输出");
    occupied.add(key);
    wireIds.add(value.id);
    return {
      id: value.id,
      from: { nodeId: from.id, port: Number(fp) },
      to: { nodeId: to.id, port: Number(tp) },
    };
  });
  const document: CircuitDocument = {
    version: 1,
    name: data.name,
    targetId: String(data.targetId),
    nodes,
    wires,
  };
  topologicalOrder(document);
  return document;
}

const SIGNALS: Signal[] = [0, 1, "X"];

function decodeProof(value: unknown): RuleProof | null {
  if (value === null || value === undefined) return null;
  if (!object(value) || typeof value.equivalent !== "boolean")
    throw new Error("规则等价性证明内容无效");
  const counterexample = Array.isArray(value.counterexample)
    ? value.counterexample.map((item) => {
        if (
          !object(item) ||
          typeof item.name !== "string" ||
          !SIGNALS.includes(item.value as Signal)
        )
          throw new Error("规则反例内容无效");
        return { name: item.name, value: item.value as Signal };
      })
    : null;
  return {
    equivalent: value.equivalent,
    cases: Number(value.cases) || 0,
    counterexample,
    mismatchOutput:
      typeof value.mismatchOutput === "string"
        ? value.mismatchOutput
        : null,
    detail: typeof value.detail === "string" ? value.detail : "",
  };
}

function decodeBoundary(value: unknown): BoundaryRef[] {
  if (!Array.isArray(value)) throw new Error("规则边界映射内容无效");
  return value.map((item) => {
    if (
      !object(item) ||
      (item.kind !== "input" && item.kind !== "output") ||
      typeof item.nodeId !== "string" ||
      typeof item.name !== "string"
    )
      throw new Error("规则边界映射内容无效");
    return {
      kind: item.kind,
      nodeId: item.nodeId,
      name: item.name,
    };
  });
}

function decodeWeights(value: unknown): Partial<Record<GateKind, number>> {
  const weights: Partial<Record<GateKind, number>> = {};
  if (!object(value)) return weights;
  const kinds = new Set(gateSpecs.map((spec) => spec.kind));
  for (const [key, raw] of Object.entries(value)) {
    if (!kinds.has(key as GateKind)) continue;
    const weight = Number(raw);
    if (Number.isFinite(weight) && weight >= 0)
      weights[key as GateKind] = weight;
  }
  return weights;
}

function decodeRules(value: unknown[]): RewriteRule[] {
  if (value.length > 50) throw new Error("单个实验最多保存 50 条替换规则");
  const ids = new Set<string>();
  return value.map((item) => {
    if (!object(item) || typeof item.id !== "string" || ids.has(item.id))
      throw new Error("替换规则编号无效或重复");
    ids.add(item.id);
    if (
      typeof item.name !== "string" ||
      !item.name ||
      item.name.length > 60 ||
      !object(item.before) ||
      !object(item.after)
    )
      throw new Error("替换规则内容无效");
    const before = decodeCircuit(item.before),
      after = decodeCircuit(item.after);
    return {
      id: item.id,
      name: item.name,
      createdAt: Number(item.createdAt) || Date.now(),
      before,
      after,
      inputs: decodeBoundary(item.inputs),
      outputs: decodeBoundary(item.outputs),
      weights: decodeWeights(item.weights),
      proof: decodeProof(item.proof),
      note: typeof item.note === "string" ? item.note.slice(0, 200) : "",
    };
  });
}
