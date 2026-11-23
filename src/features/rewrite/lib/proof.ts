import type { Signal } from "@/shared/types";
import { evaluate } from "@/features/simulation";
import { readBoundary, validateBoundaryPair, validatePattern } from "./boundary";
import { MAX_BOUNDARY_INPUTS } from "./types";
import type { RewriteRule, RuleProof } from "./types";

const TRIT: Signal[] = [0, 1, "X"];

/** 枚举边界输入的全部三值取值（0/1/悬空 X），共 3^n 种 */
export function enumerateTrits(count: number): Signal[][] {
  if (count > MAX_BOUNDARY_INPUTS)
    throw new Error(`边界输入最多 ${MAX_BOUNDARY_INPUTS} 个`);
  let rows: Signal[][] = [[]];
  for (let i = 0; i < count; i++) {
    const next: Signal[][] = [];
    for (const row of rows)
      for (const value of TRIT) next.push([...row, value]);
    rows = next;
  }
  return rows;
}

/**
 * 对替换前后两种接法做全取值验证（含悬空导致的未知 X）。
 * 仅当前开关下结果相同不算等价：必须每个边界输出在每种取值下都一致。
 */
export function proveRule(rule: Pick<RewriteRule, "before" | "after">): RuleProof {
  const beforeError = validatePattern(rule.before, true);
  if (beforeError)
    return {
      equivalent: false,
      cases: 0,
      counterexample: null,
      mismatchOutput: null,
      detail: beforeError,
    };
  const afterError = validatePattern(rule.after, false);
  if (afterError)
    return {
      equivalent: false,
      cases: 0,
      counterexample: null,
      mismatchOutput: null,
      detail: afterError,
    };
  const pairError = validateBoundaryPair(rule.before, rule.after);
  if (pairError)
    return {
      equivalent: false,
      cases: 0,
      counterexample: null,
      mismatchOutput: null,
      detail: pairError,
    };
  const bInputs = readBoundary(rule.before).inputs,
    aInputs = readBoundary(rule.after).inputs,
    bOutputs = readBoundary(rule.before).outputs,
    aOutputs = readBoundary(rule.after).outputs;
  // 按名称对齐两侧边界（不依赖节点编号）
  const afterInputByName = new Map(aInputs.map((ref) => [ref.name, ref]));
  const afterOutputByName = new Map(aOutputs.map((ref) => [ref.name, ref]));
  let cases = 0;
  try {
    for (const row of enumerateTrits(bInputs.length)) {
      cases += 1;
      const beforeOverrides: Record<string, Signal> = {},
        afterOverrides: Record<string, Signal> = {};
      const assignment: Array<{ name: string; value: Signal }> = [];
      bInputs.forEach((ref, index) => {
        beforeOverrides[ref.nodeId] = row[index];
        afterOverrides[afterInputByName.get(ref.name)!.nodeId] = row[index];
        assignment.push({ name: ref.name, value: row[index] });
      });
      const beforeResult = evaluate(rule.before, beforeOverrides),
        afterResult = evaluate(rule.after, afterOverrides);
      for (const ref of bOutputs) {
        const expected = beforeResult.values[ref.nodeId],
          actual = afterResult.values[afterOutputByName.get(ref.name)!.nodeId];
        if (expected !== actual)
          return {
            equivalent: false,
            cases,
            counterexample: assignment,
            mismatchOutput: ref.name,
            detail: `边界输出「${ref.name}」在取值 ${formatAssignment(assignment)} 下不一致：替换前为 ${expected}，替换后为 ${actual}`,
          };
      }
    }
  } catch (error) {
    return {
      equivalent: false,
      cases,
      counterexample: null,
      mismatchOutput: null,
      detail: error instanceof Error ? error.message : "等价性验证无法完成",
    };
  }
  return {
    equivalent: true,
    cases,
    counterexample: null,
    mismatchOutput: null,
    detail: `已枚举边界输入全部 ${cases} 种取值（含悬空 X），每个边界输出的三值结果均一致`,
  };
}

export function formatAssignment(
  assignment: Array<{ name: string; value: Signal }>,
): string {
  return assignment.map((item) => `${item.name}=${item.value}`).join(", ");
}
