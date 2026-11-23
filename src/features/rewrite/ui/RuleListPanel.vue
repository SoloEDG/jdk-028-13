<script setup lang="ts">
import { patternCost } from "../lib/boundary";
import type { RewriteRule } from "../lib/types";
defineProps<{
  rules: RewriteRule[];
}>();
const emit = defineEmits<{
  create: [];
  capture: [];
  edit: [rule: RewriteRule];
  remove: [id: string];
}>();
</script>
<template>
  <div class="rule-list-section">
    <div class="section-head">
      <span>替换规则</span>
      <small>RULES</small>
    </div>
    <div class="rule-actions">
      <button class="primary small" @click="emit('capture')">从选中区捕获</button>
      <button class="small" @click="emit('create')">空白新建</button>
    </div>
    <p v-if="!rules.length" class="panel-help">
      还没有替换规则。在主电路 Shift 多选一组门后点击“从选中区捕获”，或空白新建。
    </p>
    <ul v-else class="rule-items">
      <li v-for="rule in rules" :key="rule.id" class="rule-item">
        <div class="rule-item-head">
          <b>{{ rule.name }}</b>
          <span :class="['proof-dot', rule.proof?.equivalent ? 'ok' : 'bad']" />
        </div>
        <p class="rule-proof">
          {{
            rule.proof
              ? rule.proof.equivalent
                ? `✓ ${rule.proof.cases} 种取值（含 X）全部等价`
                : `✗ ${rule.proof.detail}`
              : "尚未验证"
          }}
        </p>
        <p class="rule-cost-line">
          门成本 {{ patternCost(rule.before, rule.weights) }} →
          {{ patternCost(rule.after, rule.weights) }}
          （单次
          {{
            patternCost(rule.before, rule.weights) -
              patternCost(rule.after, rule.weights) >=
            0
              ? "减少"
              : "增加"
          }}
          {{
            Math.abs(
              patternCost(rule.before, rule.weights) -
                patternCost(rule.after, rule.weights),
            )
          }}）
        </p>
        <div class="rule-item-actions">
          <button class="small" @click="emit('edit', rule)">编辑</button>
          <button class="small danger" @click="emit('remove', rule.id)">
            删除
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
