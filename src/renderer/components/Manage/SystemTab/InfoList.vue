<template lang="html">
  <div class="info-list">
    <h4 class="ui header teal">{{ header }}</h4>
      <div class="ui list" v-for="item in infoList">
        <div class="item">
          <div class="ui label">
            {{ item.label }}: <span class="detail">{{ item.value }}</span>
            <i class="ui circle icon" :class="item.icon" v-if="item.icon"></i>
          </div>
        </div>
      </div>
  </div>
</template>

<script>
export default {
  name: 'info-list',
  props: ['header', 'infoList']
}
</script>

<style lang="css">
.info-list {
  margin-bottom: 20px;
}
</style>
