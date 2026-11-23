<script setup lang="ts">
import type { CircuitDocument } from "@/shared/types";
import type { RewriteMatch, RewriteRule } from "../lib/types";
import RuleListPanel from "./RuleListPanel.vue";

const props = defineProps<{
  document: CircuitDocument;
  rules: RewriteRule[];
  matches: RewriteMatch[];
  chosenKeys: Set<string>;
  lockedKeys: Set<string>;
  totalGain: number;
  issues: Array<{ key: string; ruleName: string; reason: string }>;
  previewing: boolean;
}>();
const emit = defineEmits<{
  create: [];
  capture: [];
  edit: [rule: RewriteRule];
  remove: [id: string];
  lock: [key: string];
  clearLocks: [];
  preview: [];
  confirm: [];
  cancel: [];
  focusMatch: [match: RewriteMatch];
}>();

function nodeLabel(id: string): string {
  return props.document.nodes.find((node) => node.id === id)?.label ?? id;
}
</script>

<template>
  <aside class="rewrite-panel panel">
    <div class="panel-heading">
      <span>批量替换</span><small>REWRITE</small>
    </div>
    <p class="panel-help">
      匹配只看门类型与连线结构，不依赖编号和坐标；可交换输入脚等价处理。
    </p>
    <RuleListPanel
      :rules="rules"
      @create="emit('create')"
      @capture="emit('capture')"
      @edit="emit('edit', $event)"
      @remove="emit('remove', $event)"
    />

    <div class="section-head match-head">
      <span>可应用匹配（{{ matches.length }}）</span>
      <small>MATCHES</small>
    </div>
    <div v-if="issues.length" class="lock-issues">
      <p v-for="issue in issues" :key="issue.key">
        <b>锁定冲突：</b>{{ issue.ruleName }} — {{ issue.reason }}
      </p>
    </div>
    <p v-if="!matches.length" class="panel-help">
      当前电路没有找到可应用的位置。未通过等价证明的规则不会参与匹配。
    </p>
    <ul v-else class="match-items">
      <li
        v-for="match in matches"
        :key="match.key"
        :class="{
          chosen: chosenKeys.has(match.key),
          locked: lockedKeys.has(match.key),
        }"
        @click="emit('focusMatch', match)"
      >
        <div class="match-row">
          <label @click.stop>
            <input
              type="checkbox"
              :checked="lockedKeys.has(match.key)"
              @change="emit('lock', match.key)"
            />
            锁定
          </label>
          <b>{{ match.ruleName }}</b>
          <span class="gain" :class="{ negative: match.gain < 0 }">
            {{ match.gain > 0 ? "−" : match.gain < 0 ? "+" : ""
            }}{{ Math.abs(match.gain) }}
          </span>
        </div>
        <p class="match-nodes">
          {{ match.hostNodeIds.map(nodeLabel).join("、") }}
        </p>
        <p class="match-bindings">
          输入：{{
            match.inputBindings
              .map((b) => `${b.name}←${b.driver ? nodeLabel(b.driver.nodeId) : "悬空"}`)
              .join("，") || "—"
          }}
        </p>
      </li>
    </ul>

    <div class="rewrite-summary">
      <span>不相交最优组合减少门成本：<b>{{ totalGain }}</b></span>
      <button class="text-button" @click="emit('clearLocks')">清除全部锁定</button>
    </div>

    <div class="rewrite-actions">
      <template v-if="!previewing">
        <button class="primary" :disabled="!chosenKeys.size" @click="emit('preview')">
          预览替换
        </button>
      </template>
      <template v-else>
        <button class="primary" @click="emit('confirm')">确认一次生效</button>
        <button @click="emit('cancel')">取消（不动原图）</button>
      </template>
    </div>
  </aside>
</template>
