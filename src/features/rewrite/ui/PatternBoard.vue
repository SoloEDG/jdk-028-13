<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  CircuitDocument,
  GateKind,
  Point,
} from "@/shared/types";
import type { PortRequest } from "@/shared/commands";
import { gateSpecs, getSpec } from "@/features/catalog";
import { connect } from "@/features/circuit/model/connections";
import { createId } from "@/shared/document";
import { BOARD, portPoint, snapPosition, wirePath } from "@/features/circuit/lib/geometry";

const props = defineProps<{
  document: CircuitDocument;
  title: string;
}>();
const emit = defineEmits<{
  change: [];
  error: [message: string];
}>();
const tool = ref<GateKind | null>(null);
const pending = ref<PortRequest | null>(null);
const selectedId = ref<string | null>(null);
const svg = ref<SVGSVGElement | null>(null);
let drag: { id: string; offset: Point } | null = null;

function coordinate(event: PointerEvent): Point {
  const matrix = svg.value?.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(
    matrix.inverse(),
  );
}
function place(event: PointerEvent) {
  if (event.button !== 0 || !tool.value) return;
  const point = snapPosition(coordinate(event));
  const kind = tool.value;
  props.document.nodes.push({
    id: createId(kind.toLowerCase()),
    kind,
    label: defaultLabel(kind),
    value: 0,
    x: point.x,
    y: point.y,
  });
  tool.value = null;
  emit("change");
}
function defaultLabel(kind: GateKind): string {
  if (kind === "INPUT")
    return `IN${props.document.nodes.filter((n) => n.kind === "INPUT").length + 1}`;
  if (kind === "OUTPUT")
    return `OUT${props.document.nodes.filter((n) => n.kind === "OUTPUT").length + 1}`;
  const count = props.document.nodes.filter((n) => n.kind === kind).length + 1;
  return `${kind} ${count}`;
}
function startDrag(event: PointerEvent, id: string) {
  if (event.button !== 0) return;
  selectedId.value = id;
  const node = props.document.nodes.find((n) => n.id === id)!;
  const point = coordinate(event);
  drag = { id, offset: { x: point.x - node.x, y: point.y - node.y } };
  svg.value?.setPointerCapture(event.pointerId);
}
function pointerMove(event: PointerEvent) {
  if (!drag) return;
  const point = coordinate(event);
  const node = props.document.nodes.find((n) => n.id === drag!.id);
  if (node) {
    const next = snapPosition({
      x: point.x - drag.offset.x,
      y: point.y - drag.offset.y,
    });
    node.x = next.x;
    node.y = next.y;
  }
}
function pickPort(port: PortRequest) {
  if (port.direction === "output") {
    pending.value = port;
    return;
  }
  if (!pending.value) {
    emit("error", "请先点击输出端口");
    return;
  }
  const error = connect(props.document, pending.value, port);
  if (error) emit("error", error);
  else {
    pending.value = null;
    emit("change");
  }
}
function deleteSelected() {
  if (!selectedId.value) return;
  const id = selectedId.value;
  props.document.nodes = props.document.nodes.filter((n) => n.id !== id);
  props.document.wires = props.document.wires.filter(
    (wire) => wire.from.nodeId !== id && wire.to.nodeId !== id,
  );
  selectedId.value = null;
  emit("change");
}
function rename(event: Event) {
  const input = event.target as HTMLInputElement;
  const node = props.document.nodes.find((n) => n.id === selectedId.value);
  if (!node) return;
  const label = input.value.trim();
  if (!label) {
    input.value = node.label;
    emit("error", "边界信号名不能为空");
    return;
  }
  if (
    props.document.nodes.some(
      (other) => other.id !== node.id && other.label === label,
    )
  ) {
    input.value = node.label;
    emit("error", "边界信号名重复，请换一个名字");
    return;
  }
  node.label = label;
  emit("change");
}
function pathFor(id: string) {
  const wire = props.document.wires.find((w) => w.id === id)!;
  const from = props.document.nodes.find((n) => n.id === wire.from.nodeId);
  const to = props.document.nodes.find((n) => n.id === wire.to.nodeId);
  return from && to
    ? wirePath(
        portPoint(from, "output", wire.from.port),
        portPoint(to, "input", wire.to.port),
      )
    : "";
}
const selectedNode = computed(() =>
  props.document.nodes.find((n) => n.id === selectedId.value),
);
function keydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement).tagName === "INPUT") return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelected();
  }
  if (event.key === "Escape") {
    tool.value = null;
    pending.value = null;
  }
}
</script>
<template>
  <div class="pattern-board" @keydown="keydown">
    <div class="pattern-toolbar">
      <strong>{{ title }}</strong>
      <div class="pattern-tools">
        <button
          v-for="spec in gateSpecs"
          :key="spec.kind"
          :class="{ active: tool === spec.kind }"
          @click="tool = tool === spec.kind ? null : spec.kind"
        >
          {{ spec.symbol }}
        </button>
      </div>
      <button class="danger" :disabled="!selectedId" @click="deleteSelected">
        删除所选
      </button>
    </div>
    <div class="pattern-mode" v-if="tool || pending">
      {{ tool ? `放置 ${tool}，点击画布` : "已选输出，点击目标输入脚" }}
    </div>
    <svg
      ref="svg"
      :viewBox="`0 0 ${BOARD.width} ${BOARD.height}`"
      class="pattern-svg"
      @pointerdown="place"
      @pointermove="pointerMove"
      @pointerup="drag = null"
      @pointercancel="drag = null"
    >
      <rect width="1000" height="520" fill="#f7fafb" />
      <g v-for="wire in document.wires" :key="wire.id">
        <path :d="pathFor(wire.id)" class="pattern-wire" />
      </g>
      <g
        v-for="node in document.nodes"
        :key="node.id"
        class="pattern-node"
        :class="{ selected: selectedId === node.id }"
      >
        <rect
          :x="node.x"
          :y="node.y"
          :width="BOARD.nodeWidth"
          :height="BOARD.nodeHeight"
          rx="10"
          class="pattern-node-body"
          :class="`kind-${node.kind}`"
          @pointerdown.stop="startDrag($event, node.id)"
        />
        <text :x="node.x + 12" :y="node.y + 22" class="pattern-node-label">{{
          node.label
        }}</text>
        <text :x="node.x + 56" :y="node.y + 58" class="pattern-node-symbol">{{
          getSpec(node.kind).symbol
        }}</text>
        <circle
          v-for="port in getSpec(node.kind).inputs"
          :key="`in${port}`"
          :cx="portPoint(node, 'input', port - 1).x"
          :cy="portPoint(node, 'input', port - 1).y"
          r="7"
          class="pattern-port"
          @pointerdown.stop="
            pickPort({ nodeId: node.id, port: port - 1, direction: 'input' })
          "
        />
        <circle
          v-if="getSpec(node.kind).outputs"
          :cx="portPoint(node, 'output').x"
          :cy="portPoint(node, 'output').y"
          r="7"
          class="pattern-port output"
          :class="{ pending: pending?.nodeId === node.id }"
          @pointerdown.stop="
            pickPort({ nodeId: node.id, port: 0, direction: 'output' })
          "
        />
      </g>
    </svg>
    <div class="pattern-inspector">
      <template v-if="selectedNode">
        <span
          >已选 <b>{{ selectedNode.label }}</b>
          ({{ selectedNode.kind }})</span
        >
        <label v-if="['INPUT', 'OUTPUT'].includes(selectedNode.kind)">
          边界信号名
          <input
            :key="selectedNode.id"
            :value="selectedNode.label"
            maxlength="20"
            @change="rename"
          />
        </label>
        <span v-else class="hint-text">拖动移动 · Delete 删除</span>
      </template>
      <span v-else class="hint-text">
        放置基础门并连接；INPUT/OUTPUT 即命名边界，两侧名称需一致
      </span>
    </div>
  </div>
</template>
