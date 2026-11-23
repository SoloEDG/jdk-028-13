import { ref, type Ref } from "vue";
import type { CircuitDocument } from "@/shared/types";
import type { PortRequest, Notice } from "@/shared/commands";
import { removeNode } from "@/shared/document";
import { connect } from "./connections";
export function useCircuit(
  document: Ref<CircuitDocument>,
  notify: (notice: Notice) => void,
) {
  const selected = ref<string | null>(null),
    pending = ref<PortRequest | null>(null),
    multiSelected = ref<Set<string>>(new Set());
  function resetSelection() {
    selected.value = null;
    pending.value = null;
    multiSelected.value = new Set();
  }
  function pickPort(port: PortRequest) {
    if (port.direction === "output") {
      pending.value = port;
      notify({ tone: "info", message: "已选择输出端口，请点击一个输入端口" });
      return;
    }
    if (!pending.value) {
      notify({ tone: "error", message: "请先点击元件右侧的输出端口" });
      return;
    }
    const error = connect(document.value, pending.value, port);
    if (error) notify({ tone: "error", message: error });
    else {
      pending.value = null;
      notify({ tone: "success", message: "连接成功，信号已更新" });
    }
  }
  /** Shift/Ctrl 点击元件时累加选择，供替换模式捕获使用 */
  function selectNode(id: string, additive: boolean) {
    if (additive) {
      const next = new Set(multiSelected.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      multiSelected.value = next;
      selected.value = id;
      return;
    }
    multiSelected.value = new Set();
    selected.value = id;
  }
  function clearMultiSelection() {
    multiSelected.value = new Set();
  }
  function deleteSelected() {
    if (!selected.value) return;
    if (document.value.nodes.some((node) => node.id === selected.value))
      removeNode(document.value, selected.value);
    else
      document.value.wires = document.value.wires.filter(
        (wire) => wire.id !== selected.value,
      );
    resetSelection();
    notify({ tone: "info", message: "已删除所选元件或连线" });
  }
  return {
    selected,
    pending,
    multiSelected,
    pickPort,
    deleteSelected,
    resetSelection,
    selectNode,
    clearMultiSelection,
  };
}
