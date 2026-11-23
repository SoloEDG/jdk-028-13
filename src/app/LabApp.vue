<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { CatalogPanel } from "@/features/catalog";
import { CircuitBoard } from "@/features/circuit";
import { InputRack, SignalMonitor } from "@/features/simulation";
import { ChallengePanel } from "@/features/challenge";
import { RewritePanel, RuleEditor } from "@/features/rewrite";
import { WorkspaceBar } from "@/features/workspace";
import { useLab } from "./useLab";
const lab = useLab();
const { document, notice } = lab;
const { tool } = lab.placement,
  { selected, pending } = lab.circuit,
  { signals } = lab.simulation;
const { target, table, passed, inspected, hint } = lab.challenge;
const { status } = lab.workspace;
const selectedNode = computed(() =>
  document.value.nodes.find((node) => node.id === selected.value),
);
function keydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement).closest("input,textarea,select")) return;
  if (event.key === "Escape") {
    if (lab.previewing.value) lab.rewrite.cancelPreview();
    lab.cancel();
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    lab.circuit.deleteSelected();
  }
}
onMounted(() => window.addEventListener("keydown", keydown));
onUnmounted(() => window.removeEventListener("keydown", keydown));
</script>
<template>
  <div class="lab-app">
    <header class="masthead">
      <div class="brand">
        <span class="brand-icon">⌘</span>
        <div>
          <h1>LOGIC <em>LAB</em><span>数字电路逻辑实验室</span></h1>
          <p>把逻辑，连接起来。</p>
        </div>
      </div>
      <div class="instrument-label">
        <span class="power-light" />组合逻辑模式 <small>BENCH / JDK–028</small>
      </div>
    </header>
    <WorkspaceBar
      :name="document.name"
      :status="status"
      @rename="document.name = $event"
      @sample="lab.workspace.sample"
      @clear="lab.workspace.clear"
      @save="lab.workspace.save"
      @export="lab.workspace.exportFile"
      @import="lab.workspace.importText"
      @error="lab.notify({ tone: 'error', message: $event })"
    />
    <main class="workbench rewrite-workbench">
      <CatalogPanel
        :tool="tool"
        @choose="
          tool = $event;
          pending = null;
        "
      />
      <section class="center-workspace">
        <div class="board-toolbar">
          <span><b>工作台</b><small>单比特 · 即时传播 · Shift 多选捕获替换模式</small></span>
          <div>
            <button
              :disabled="!selected"
              aria-label="删除所选"
              @click="lab.circuit.deleteSelected"
            >
              删除所选</button
            ><button :disabled="!pending && !tool" @click="lab.cancel">
              取消 / Esc
            </button>
          </div>
        </div>
        <div class="mode-strip" v-if="tool || pending">
          {{ tool ? `点击网格放置 ${tool}` : "已选择输出，请点击目标输入端口"
          }}<button @click="lab.cancel">取消</button>
        </div>
        <div v-if="lab.previewing.value && lab.rewrite.plan.value" class="preview-banner">
          <span>
            替换预览：移除 {{ lab.rewrite.plan.value.removedNodeIds.length }}
            个元件、{{ lab.rewrite.plan.value.removedWireIds.length }} 条连线，
            新增 {{ lab.rewrite.plan.value.addedNodeCount }} 个元件
          </span>
          <span class="legend-row">
            <span><i class="swatch remove" />替换/拆除</span>
            <span><i class="swatch keep" />保留线路</span>
            <span><i class="swatch add" />新接法</span>
          </span>
        </div>
        <CircuitBoard
          :document="document"
          :signals="signals"
          :selected="selected"
          :pending="pending"
          :tool="tool"
          :multi-selected="lab.circuit.multiSelected.value"
          :focused-nodes="lab.focusedMatchNodes.value"
          :node-marks="lab.rewrite.marks.value.nodeMarks"
          :wire-marks="lab.rewrite.marks.value.wireMarks"
          @place="lab.place"
          @move="lab.move"
          @select="lab.handleSelect"
          @port="lab.circuit.pickPort"
          @toggle="lab.simulation.toggle"
        />
        <div class="selection-strip">
          <template v-if="selectedNode"
            ><label
              >元件名称
              <input
                :key="selectedNode.id"
                :value="selectedNode.label"
                maxlength="40"
                aria-label="所选元件名称"
                @change="
                  lab.renameNode(($event.target as HTMLInputElement).value)
                " /></label
            ><span
              >{{ selectedNode.kind }} · 拖动移动 · Delete 删除 · Shift 点击加入捕获选择</span
            ></template
          ><span v-else>{{
            selected
              ? "已选择连线，按 Delete 或点击“删除所选”断开。"
              : "拖动元件移动位置 · 点击端口连接 · Shift 多选后到右侧捕获替换规则"
          }}</span
          ><span class="grid-label">GRID 20</span>
        </div>
        <div class="instruments">
          <InputRack
            :nodes="document.nodes"
            :signals="signals"
            @toggle="lab.simulation.toggle"
          /><SignalMonitor
            :document="document"
            :signals="signals"
            :selected="selected"
          />
        </div>
      </section>
      <RewritePanel
        :document="document"
        :rules="lab.rules.value"
        :matches="lab.rewrite.matches.value"
        :chosen-keys="lab.rewrite.chosenKeys.value"
        :locked-keys="lab.rewrite.lockedKeys.value"
        :total-gain="lab.rewrite.selection.value.totalGain"
        :issues="lab.rewrite.selection.value.issues"
        :previewing="lab.previewing.value"
        @create="lab.openBlankEditor"
        @capture="lab.captureToEditor"
        @edit="lab.editRule"
        @remove="lab.rewrite.deleteRule"
        @lock="lab.rewrite.toggleLock"
        @clear-locks="lab.rewrite.clearLocks"
        @preview="lab.rewrite.preview"
        @confirm="lab.rewrite.confirm"
        @cancel="lab.rewrite.cancelPreview"
        @focus-match="lab.focusMatch"
      />
      <ChallengePanel
        :document="document"
        :target="target"
        :table="table"
        :passed="passed"
        :inspected="inspected"
        :hint="hint"
        @choose="lab.challenge.choose"
        @check="inspected = true"
        @hint="hint = !hint"
      />
    </main>
    <RuleEditor
      :open="lab.editorOpen.value"
      :initial="lab.editingRule.value"
      :seed-pattern="lab.seedPattern.value"
      @close="lab.editorOpen.value = false"
      @save="lab.saveRule"
    />
    <footer class="status-bar" :class="notice.tone" role="status">
      <span
        >{{
          notice.tone === "error" ? "!" : notice.tone === "success" ? "✓" : "●"
        }}
        {{ notice.message }}</span
      ><small>LOCAL LAB / 纯前端实验</small>
    </footer>
  </div>
</template>
