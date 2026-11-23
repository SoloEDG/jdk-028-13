export { loadInitial, useWorkspace } from "./model/useWorkspace";
export { default as WorkspaceBar } from "./ui/WorkspaceBar.vue";
export { captureSelection, clonePattern } from "@/features/rewrite";
export type {
  RewriteRule,
  RewriteMatch,
  RuleProof,
  RuleDraft,
  PreviewPlan,
  GateWeights,
  BoundaryRef,
} from "@/features/rewrite";
