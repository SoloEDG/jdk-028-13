import type { LockIssue, RewriteMatch } from "./types";

export interface SelectionResult {
  chosen: RewriteMatch[];
  locked: RewriteMatch[];
  totalGain: number;
  issues: LockIssue[];
}

function overlaps(a: RewriteMatch, b: RewriteMatch): boolean {
  if (a === b) return true;
  const nodes = new Set(a.hostNodeIds);
  for (const id of b.hostNodeIds) if (nodes.has(id)) return true;
  return false;
}

/**
 * 在相互重叠的匹配中选择门成本减少最多的不相交组合（最大权独立集，
 * 小规模冲突集上用分支定界求精确解）。锁定匹配必须采用；锁定项之间冲突时
 * 保留全部锁定项并给出解释，不会擅自删掉锁定项。
 */
export function selectMatches(
  matches: RewriteMatch[],
  lockedKeys: Set<string>,
  branchLimit = 200_000,
): SelectionResult {
  const byKey = new Map(matches.map((match) => [match.key, match]));
  const issues: LockIssue[] = [];
  const locked: RewriteMatch[] = [];
  for (const key of lockedKeys) {
    const match = byKey.get(key);
    if (!match) {
      issues.push({
        key,
        ruleName: key.split("|")[0] ?? key,
        reason: "锁定的匹配在当前电路中已不存在（电路被改动或规则被删除），无法采用",
      });
      continue;
    }
    const conflict = locked.find((other) => overlaps(other, match));
    if (conflict)
      issues.push({
        key,
        ruleName: match.ruleName,
        reason: `锁定项与另一锁定项「${conflict.ruleName}」占用了相同的元件，无法同时生效；请手动解除其中一个锁定`,
      });
    locked.push(match);
  }
  // 与锁定项冲突的非锁定匹配直接排除，并记录原因供界面提示
  const blocked = new Set<string>();
  for (const match of matches) {
    if (lockedKeys.has(match.key)) continue;
    const blocker = locked.find((lock) => overlaps(lock, match));
    if (blocker) blocked.add(match.key);
  }
  const candidates = matches.filter(
    (match) =>
      !lockedKeys.has(match.key) &&
      !blocked.has(match.key) &&
      !locked.some((lock) => overlaps(lock, match)),
  );

  let best: RewriteMatch[] = [],
    bestGain = -Infinity,
    branches = 0;
  const current: RewriteMatch[] = [];

  function gainOf(list: RewriteMatch[]): number {
    return list.reduce((sum, match) => sum + match.gain, 0);
  }

  function backtrack(index: number, usedNodes: Set<string>): void {
    if (++branches > branchLimit) return;
    if (index === candidates.length) {
      const gain = gainOf(current);
      if (gain > bestGain) {
        bestGain = gain;
        best = [...current];
      }
      return;
    }
    const match = candidates[index];
    const conflicts = match.hostNodeIds.some((id) => usedNodes.has(id));
    // 不选当前匹配
    backtrack(index + 1, usedNodes);
    // 选当前匹配（要求不相交且有正收益才可能改进）
    if (!conflicts && match.gain > 0) {
      current.push(match);
      for (const id of match.hostNodeIds) usedNodes.add(id);
      backtrack(index + 1, usedNodes);
      current.pop();
      for (const id of match.hostNodeIds) usedNodes.delete(id);
    }
  }

  // 按收益降序分支，提升分支定界的剪枝效率
  candidates.sort((a, b) => b.gain - a.gain);
  const initialNodes = new Set<string>();
  for (const lock of locked) for (const id of lock.hostNodeIds) initialNodes.add(id);
  backtrack(0, initialNodes);
  if (bestGain === -Infinity) {
    best = [];
    bestGain = 0;
  }
  const chosen = [...locked, ...best].sort((a, b) => b.gain - a.gain);
  return {
    chosen,
    locked,
    totalGain: gainOf(chosen),
    issues,
  };
}
