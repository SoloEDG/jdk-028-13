import type { CircuitDocument, GateKind, PreviewMark, Signal, Wire } from "@/shared/types";

/** 替换规则中一个命名边界的引用（基于边界开关/指示灯节点，而非编号坐标） */
export interface BoundaryRef {
  kind: "input" | "output";
  /** 模式电路中 INPUT/OUTPUT 边界节点的编号（仅作稳定标识，匹配不依赖它） */
  nodeId: string;
  /** 用户命名的边界信号名，取自边界节点 label，两侧模式必须一致 */
  name: string;
}

/** 门成本设置：每种基础门的权重，未列出的按默认权重 1 */
export type GateWeights = Partial<Record<GateKind, number>>;

/** 规则等价性证明结果：枚举边界信号全部取值（含悬空 X）后的结论 */
export interface RuleProof {
  equivalent: boolean;
  cases: number;
  /** 首个不等价取值组合（含 X），用于向用户解释为何不能采用 */
  counterexample: Array<{ name: string; value: Signal }> | null;
  mismatchOutput: string | null;
  detail: string;
}

/** 规则编辑器提交的草稿（保存时才做全取值证明并生成规则 id） */
export interface RuleDraft {
  name: string;
  before: CircuitDocument;
  after: CircuitDocument;
  weights: GateWeights;
  note: string;
}

/** 替换规则：保存基础门组成的替换前后两种接法及命名边界 */
export interface RewriteRule {
  id: string;
  name: string;
  createdAt: number;
  before: CircuitDocument;
  after: CircuitDocument;
  inputs: BoundaryRef[];
  outputs: BoundaryRef[];
  weights: GateWeights;
  proof: RuleProof | null;
  note: string;
}

/** 边界输入在当前电路中的落点：驱动端，悬空为 null */
export interface InputBinding {
  name: string;
  driver: { nodeId: string; port: number } | null;
}

/** 边界输出在当前电路中的落点：被替换的内部节点及其完整外部扇出 */
export interface OutputBinding {
  name: string;
  sourceNodeId: string;
  externalWires: Wire[];
}

/** 一次具体匹配：模式内部节点/连线到当前电路元件的映射 */
export interface RewriteMatch {
  /** 稳定键：规则 id + 内部节点映射，供锁定使用，不依赖摆放坐标 */
  key: string;
  ruleId: string;
  ruleName: string;
  nodeMap: Record<string, string>;
  inputBindings: InputBinding[];
  outputBindings: OutputBinding[];
  internalWireIds: string[];
  hostNodeIds: string[];
  gain: number;
  beforeCost: number;
  afterCost: number;
}

/** 锁定冲突或规则不可用的解释 */
export interface LockIssue {
  key: string;
  ruleName: string;
  reason: string;
}

/** 预览中一条连线/元件的处置标记 */
export type { PreviewMark };

export interface PreviewPlan {
  removedNodeIds: string[];
  removedWireIds: string[];
  keptWireIds: string[];
  addedWireCount: number;
  addedNodeCount: number;
  matches: RewriteMatch[];
}

export const DEFAULT_GATE_WEIGHT = 1;
/** 边界输入枚举上限：3^n 次三值（0/1/X）验证 */
export const MAX_BOUNDARY_INPUTS = 8;
/** 整电路三值复核上限，超出则只依赖边界证明 + 结构安全条件 */
export const MAX_FULL_CHECK_INPUTS = 12;
