import { createId } from "@/shared/document";
import { readBoundary, validateBoundaryPair, validatePattern } from "./boundary";
import { proveRule } from "./proof";
import type { RewriteRule, RuleDraft, RuleProof } from "./types";
export function buildRule(draft: RuleDraft): {
  rule: RewriteRule | null;
  error: string | null;
} {
  const beforeError = validatePattern(draft.before, true);
  if (beforeError) return { rule: null, error: beforeError };
  const afterError = validatePattern(draft.after, false);
  if (afterError) return { rule: null, error: afterError };
  const pairError = validateBoundaryPair(draft.before, draft.after);
  if (pairError) return { rule: null, error: pairError };
  const boundary = readBoundary(draft.before);
  const proof: RuleProof = proveRule({
    before: draft.before,
    after: draft.after,
  });
  return {
    rule: {
      id: createId("rule"),
      name: draft.name.trim().slice(0, 60) || "未命名替换规则",
      createdAt: Date.now(),
      before: draft.before,
      after: draft.after,
      inputs: boundary.inputs,
      outputs: boundary.outputs,
      weights: { ...draft.weights },
      proof,
      note: draft.note.slice(0, 200),
    },
    error: proof.equivalent
      ? null
      : proof.detail || "替换前后在边界信号的某些取值下不等价",
  };
}
