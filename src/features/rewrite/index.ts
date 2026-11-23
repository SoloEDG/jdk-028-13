export { useRewrite } from "./model/useRewrite";
export { default as RewritePanel } from "./ui/RewritePanel.vue";
export { default as RuleEditor } from "./ui/RuleEditor.vue";
export { default as PatternBoard } from "./ui/PatternBoard.vue";
export { captureSelection, clonePattern } from "./lib/capture";
export { decodeExperiment, encodeExperiment } from "./lib/codec";
export { findAllMatches, findMatches } from "./lib/matcher";
export { selectMatches } from "./lib/selection";
export { applyMatches, buildPlan } from "./lib/apply";
export { proveRule } from "./lib/proof";
export type {
  RewriteRule,
  RewriteMatch,
  RuleProof,
  RuleDraft,
  PreviewPlan,
  GateWeights,
  BoundaryRef,
} from "./lib/types";
