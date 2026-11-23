
import { computed, ref, shallowRef } from "vue";
import type { Notice } from "@/shared/commands";
import type { CircuitDocument, Point } from "@/shared/types";
import { usePlacement } from "@/features/catalog";
import { useCircuit } from "@/features/circuit";
import { useSimulation } from "@/features/simulation";
import { useChallenge } from "@/features/challenge";
import {
  captureSelection,
  useRewrite,
  type RewriteMatch,
  type RewriteRule,
  type RuleDraft,
} from "@/features/rewrite";
import { loadInitial, useWorkspace } from "@/features/workspace";
export function useLab() {
  const initial = loadInitial(),
    document = ref(initial.document),
    rules = ref<RewriteRule[]>(initial.rules);
  const notice = ref<Notice>({
    tone: initial.warning ? "error" : "info",
    message:
      initial.warning ?? "示例已就绪。切换输入，观察信号如何到达输出。",
  });
  const notify = (next: Notice) => {
    notice.value = next;
  };
  const placement = usePlacement();
  const circuit = useCircuit(document, notify);
  const simulation = useSimulation(document),
    challenge = useChallenge(document);
  const workspace = useWorkspace(document, rules, notify, () => {
    circuit.resetSelection();
    challenge.reset();
    placement.tool.value = null;
    rewrite.plan.value = null;
    rewrite.clearLocks();
  });
  const rewrite = useRewrite(document, rules, notify);

  // 规则编辑器状态
  const editorOpen = ref(false);
  const editingRule = shallowRef<RewriteRule | null>(null);
  const seedPattern = shallowRef<CircuitDocument | null>(null);

  function place(point: Point) {
    if (!placement.tool.value) return;
    if (document.value.nodes.length >= 120) {
      notify({
        tone: "error",
        message: "最多支持 120 个元件，请先删除不用的元件",
      });
      return;
    }
    const node = placement.createNode(
      document.value,
      placement.tool.value,
      point,
    );
    document.value.nodes.push(node);
    circuit.selected.value = node.id;
    placement.tool.value = null;
    notify({
      tone: "success",
      message: `已放置 ${node.label}，点击端口开始连线`,
    });
  }
  function move(id: string, point: Point) {
    const node = document.value.nodes.find((n) => n.id === id);
    if (node) {
      node.x = point.x;
      node.y = point.y;
    }
  }
  function cancel() {
    circuit.pending.value = null;
    placement.tool.value = null;
    notify({ tone: "info", message: "已取消当前放置或连线" });
  }
  function renameNode(label: string) {
    const node = document.value.nodes.find(
      (n) => n.id === circuit.selected.value,
    );
    if (node) node.label = label.trim().slice(0, 40) || node.kind;
  }
  function handleSelect(id: string | null, additive: boolean) {
    if (id === null) {
      if (!additive) {
        circuit.clearMultiSelection();
        clearFocus();
      }
      circuit.selected.value = null;
      return;
    }
    circuit.selectNode(id, additive);
    if (!additive) clearFocus();
  }
  function openBlankEditor() {
    editingRule.value = null;
    seedPattern.value = null;
    editorOpen.value = true;
  }
  function captureToEditor() {
    const ids = circuit.multiSelected.value.size
      ? [...circuit.multiSelected.value]
      : circuit.selected.value
        ? [circuit.selected.value]
        : [];
    try {
      const result = captureSelection(document.value, ids);
      editingRule.value = null;
      seedPattern.value = result.pattern;
      editorOpen.value = true;
      notify({
        tone: "info",
        message: `已捕获 ${result.boundaryInputCount} 个边界输入、${result.boundaryOutputCount} 个边界输出，请在编辑器中搭出替换后接法`,
      });
    } catch (error) {
      notify({
        tone: "error",
        message: error instanceof Error ? error.message : "捕获失败",
      });
    }
  }
  function editRule(rule: RewriteRule) {
    editingRule.value = rule;
    seedPattern.value = null;
    editorOpen.value = true;
  }
  function saveRule(payload: {
    draft: RuleDraft;
    editingId: string | null;
  }) {
    const result = rewrite.saveRule(payload.draft, payload.editingId);
    if (result.saved && result.equivalent) editorOpen.value = false;
  }
  const previewing = computed(() => rewrite.plan.value !== null);
  const focusedMatchNodes = ref<Set<string>>(new Set());
  function focusMatch(match: RewriteMatch) {
    focusedMatchNodes.value = new Set(match.hostNodeIds);
  }
  function clearFocus() {
    focusedMatchNodes.value = new Set();
  }
  return {
    document,
    rules,
    notice,
    notify,
    placement,
    circuit,
    simulation,
    challenge,
    workspace,
    rewrite,
    editorOpen,
    editingRule,
    seedPattern,
    previewing,
    focusedMatchNodes,
    place,
    move,
    cancel,
    renameNode,
    handleSelect,
    openBlankEditor,
    captureToEditor,
    editRule,
    saveRule,
    focusMatch,
    clearFocus,
  };
}
