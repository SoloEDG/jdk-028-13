<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CircuitDocument, GateKind } from "@/shared/types";
import { gateSpecs } from "@/features/catalog";
import { clonePattern } from "../lib/capture";
import { patternCost, readBoundary } from "../lib/boundary";
import { proveRule } from "../lib/proof";
import type {
  GateWeights,
  RewriteRule,
  RuleDraft,
  RuleProof,
} from "../lib/types";
import PatternBoard from "./PatternBoard.vue";

const props = defineProps<{
  open: boolean;
  initial: RewriteRule | null;
  seedPattern: CircuitDocument | null;
}>();
const emit = defineEmits<{
  close: [];
  save: [payload: { draft: RuleDraft; editingId: string | null }];
}>();

const name = ref("新替换规则");
const before = ref<CircuitDocument | null>(null);
const after = ref<CircuitDocument | null>(null);
const weights = ref<GateWeights>({});
const note = ref("");
const proof = ref<RuleProof | null>(null);
const editorError = ref<string | null>(null);

const internalKinds = computed<GateKind[]>(() =>
  gateSpecs
    .map((spec) => spec.kind)
    .filter((kind) => kind !== "INPUT" && kind !== "OUTPUT"),
);

function emptyPattern(): CircuitDocument {
  return {
    version: 1,
    name: "替换模式",
    targetId: "xor",
    nodes: [],
    wires: [],
  };
}
function openEditor() {
  if (props.initial) {
    name.value = props.initial.name;
    before.value = JSON.parse(JSON.stringify(props.initial.before));
    after.value = JSON.parse(JSON.stringify(props.initial.after));
    weights.value = { ...props.initial.weights };
    note.value = props.initial.note;
    proof.value = props.initial.proof;
  } else if (props.seedPattern) {
    name.value = "新替换规则";
    before.value = JSON.parse(JSON.stringify(props.seedPattern));
    after.value = clonePattern(props.seedPattern);
    weights.value = {};
    note.value = "";
    proof.value = null;
  } else {
    name.value = "新替换规则";
    before.value = emptyPattern();
    after.value = emptyPattern();
    weights.value = {};
    note.value = "";
    proof.value = null;
  }
  editorError.value = null;
}
watch(
  () => props.open,
  (open) => {
    if (open) openEditor();
  },
  { immediate: true },
);
defineExpose({ openEditor });

const boundarySummary = computed(() => {
  if (!before.value) return { inputs: [] as string[], outputs: [] as string[] };
  const boundary = readBoundary(before.value);
  return {
    inputs: boundary.inputs.map((ref) => ref.name),
    outputs: boundary.outputs.map((ref) => ref.name),
  };
});

const costs = computed(() => {
  if (!before.value || !after.value) return { before: 0, after: 0, gain: 0 };
  const b = patternCost(before.value, weights.value),
    a = patternCost(after.value, weights.value);
  return { before: b, after: a, gain: b - a };
});

function runProof() {
  if (!before.value || !after.value) return;
  editorError.value = null;
  proof.value = proveRule({ before: before.value, after: after.value });
}

function setWeight(kind: GateKind, raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return;
  weights.value = { ...weights.value, [kind]: value };
}

function save() {
  if (!before.value || !after.value) return;
  const draft: RuleDraft = {
    name: name.value || "未命名替换规则",
    before: before.value,
    after: after.value,
    weights: weights.value,
    note: note.value,
  };
  emit("save", { draft, editingId: props.initial?.id ?? null });
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" role="dialog" aria-modal="true">
    <div class="modal-card rule-editor">
      <header class="modal-head">
        <div>
          <h2>替换规则编辑器</h2>
          <p>保存由基础门组成的替换前后两种接法，INPUT/OUTPUT 为命名边界</p>
        </div>
        <button @click="emit('close')">关闭 ✕</button>
      </header>
      <div class="editor-meta">
        <label>
          规则名称
          <input v-model="name" maxlength="60" aria-label="规则名称" />
        </label>
        <div class="boundary-summary">
          <span>边界输入：<b>{{ boundarySummary.inputs.join("、") || "—" }}</b></span>
          <span>边界输出：<b>{{ boundarySummary.outputs.join("、") || "—" }}</b></span>
        </div>
      </div>
      <div class="editor-panes">
        <PatternBoard
          :document="before!"
          title="替换前（模式）"
          @change="runProof"
          @error="(message) => (editorError = message)"
        />
        <PatternBoard
          :document="after!"
          title="替换后（新接法）"
          @change="runProof"
          @error="(message) => (editorError = message)"
        />
      </div>
      <div class="editor-footer">
        <div class="weight-editor">
          <span>门成本权重</span>
          <label v-for="kind in internalKinds" :key="kind">
            {{ kind }}
            <input
              type="number"
              min="0"
              step="1"
              :value="weights[kind] ?? 1"
              @change="setWeight(kind, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
        <div class="proof-box" :class="proof?.equivalent ? 'ok' : 'bad'">
          <button class="primary" @click="runProof">全取值验证（含悬空 X）</button>
          <p v-if="proof">
            <b>{{ proof.equivalent ? "✓ 等价" : "✗ 不等价或无法证明" }}</b>
            {{ proof.detail }}
          </p>
          <p v-if="editorError" class="editor-error">{{ editorError }}</p>
          <p class="cost-line">
            成本：替换前 {{ costs.before }} → 替换后 {{ costs.after }}
            （单次减少 {{ costs.gain }}）
          </p>
        </div>
        <label class="note-line">
          备注
          <input v-model="note" maxlength="200" placeholder="可选说明" />
        </label>
        <div class="editor-actions">
          <button @click="emit('close')">取消</button>
          <button class="primary" @click="save">保存规则</button>
        </div>
      </div>
    </div>
  </div>
</template>
