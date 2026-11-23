import { computed, ref, shallowRef, type Ref } from "vue";
import type { CircuitDocument, PreviewMark } from "@/shared/types";
import type { Notice } from "@/shared/commands";
import { applyMatches, buildPlan } from "../lib/apply";
import { buildRule } from "../lib/factory";
import { findAllMatches } from "../lib/matcher";
import { patternCost } from "../lib/boundary";
import { selectMatches } from "../lib/selection";
import type {
  PreviewPlan,
  RewriteMatch,
  RewriteRule,
  RuleDraft,
} from "../lib/types";

export function useRewrite(
  document: Ref<CircuitDocument>,
  rulesRef: Ref<RewriteRule[]>,
  notify: (notice: Notice) => void,
) {
  const lockedKeys = ref<Set<string>>(new Set());
  const plan = shallowRef<PreviewPlan | null>(null);
  const revision = ref(0);

  const ruleById = computed(() =>
    new Map(rulesRef.value.map((rule) => [rule.id, rule])),
  );

  const matches = computed<RewriteMatch[]>(() => {
    // revision 让规则编辑后强制重算
    void revision.value;
    return findAllMatches(document.value, rulesRef.value);
  });

  const selection = computed(() =>
    selectMatches(matches.value, lockedKeys.value),
  );

  const chosen = computed(() => selection.value.chosen);
  const chosenKeys = computed(() => new Set(chosen.value.map((m) => m.key)));

  const marks = computed(() => {
    const nodeMarks = new Map<string, PreviewMark>(),
      wireMarks = new Map<string, PreviewMark>();
    if (!plan.value) return { nodeMarks, wireMarks };
    for (const id of plan.value.removedNodeIds) nodeMarks.set(id, "remove");
    for (const id of plan.value.removedWireIds) wireMarks.set(id, "remove");
    for (const id of plan.value.keptWireIds) wireMarks.set(id, "keep");
    return { nodeMarks, wireMarks };
  });

  function touch() {
    revision.value += 1;
  }

  function saveRule(
    draft: RuleDraft,
    editingId: string | null,
  ): { saved: boolean; equivalent: boolean } {
    const { rule, error } = buildRule(draft);
    if (!rule) {
      notify({ tone: "error", message: `规则未保存：${error}` });
      return { saved: false, equivalent: false };
    }
    if (editingId) {
      const index = rulesRef.value.findIndex((item) => item.id === editingId);
      if (index >= 0) rulesRef.value[index] = { ...rule, id: editingId };
    } else {
      rulesRef.value.push(rule);
    }
    touch();
    if (!rule.proof || !rule.proof.equivalent) {
      notify({
        tone: "error",
        message: `规则已保存但未通过等价性证明，不会参与匹配：${rule.proof?.detail ?? "缺少证明"}`,
      });
      return { saved: true, equivalent: false };
    }
    notify({
      tone: "success",
      message: `规则「${rule.name}」已保存，并通过 ${rule.proof.cases} 种取值（含悬空 X）等价验证`,
    });
    return { saved: true, equivalent: true };
  }

  function deleteRule(id: string) {
    rulesRef.value = rulesRef.value.filter((rule) => rule.id !== id);
    lockedKeys.value = new Set(
      [...lockedKeys.value].filter((key) => {
        const match = matches.value.find((item) => item.key === key);
        return match ? match.ruleId !== id : true;
      }),
    );
    plan.value = null;
    touch();
    notify({ tone: "info", message: "替换规则已删除" });
  }

  /** 只改成本权重：等价性证明基于信号取值，与权重无关，无需重跑 */
  function updateWeights(id: string, weights: RewriteRule["weights"]) {
    const rule = rulesRef.value.find((item) => item.id === id);
    if (!rule) return;
    rule.weights = { ...weights };
    touch();
  }

  function toggleLock(key: string) {
    const next = new Set(lockedKeys.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    lockedKeys.value = next;
    plan.value = null;
  }

  function clearLocks() {
    lockedKeys.value = new Set();
    plan.value = null;
  }

  /** 预览：标出保留与替换的线路，不改原图 */
  function preview(): boolean {
    if (!chosen.value.length) {
      notify({ tone: "error", message: "当前没有可应用的匹配" });
      return false;
    }
    const blocking = selection.value.issues;
    if (blocking.length) {
      notify({
        tone: "error",
        message: `锁定项存在冲突，未生成预览：${blocking[0].reason}`,
      });
      return false;
    }
    plan.value = buildPlan(document.value, chosen.value, ruleById.value);
    notify({
      tone: "info",
      message: `预览 ${chosen.value.length} 处替换，预计减少 ${selection.value.totalGain} 个门成本；确认后一次生效`,
    });
    return true;
  }

  function cancelPreview() {
    if (!plan.value) return;
    plan.value = null;
    notify({ tone: "info", message: "已取消预览，原图未改动" });
  }

  /** 确认替换：事务式生效，随后清空预览并重新检测目标 */
  function confirm(): boolean {
    if (!plan.value) return false;
    try {
      const result = applyMatches(
        document.value,
        chosen.value,
        ruleById.value,
      );
      document.value = result.document;
      plan.value = null;
      // 元件编号全部变化，旧锁定自然失效；重新检测匹配
      lockedKeys.value = new Set();
      touch();
      notify({
        tone: "success",
        message: `已一次替换 ${result.plan.matches.length} 处，外部扇出完整保留，并重新检测匹配`,
      });
      return true;
    } catch (error) {
      plan.value = null;
      notify({
        tone: "error",
        message: `替换已中止，原图未改动：${error instanceof Error ? error.message : "未知错误"}`,
      });
      return false;
    }
  }

  function ruleCost(rule: RewriteRule): { before: number; after: number } {
    return {
      before: patternCost(rule.before, rule.weights),
      after: patternCost(rule.after, rule.weights),
    };
  }

  return {
    rules: rulesRef,
    matches,
    selection,
    chosen,
    chosenKeys,
    lockedKeys,
    plan,
    marks,
    saveRule,
    deleteRule,
    updateWeights,
    toggleLock,
    clearLocks,
    preview,
    cancelPreview,
    confirm,
    ruleCost,
    touch,
  };
}
