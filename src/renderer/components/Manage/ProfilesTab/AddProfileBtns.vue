<template>
  <div class="ui dropdown button left pointing labeled icon teal">
    <i class="add user icon"></i>
    添加配置
    <div class="menu">
      <div class="item" @click="bus.$emit('newProfile')">
        <i class="ui plus icon"></i>
        新建
      </div>

      <div class="item" @click="bus.$emit('importProfile')">
        <i class="ui paste icon"></i>
        导入
      </div>
    </div>
  </div>
</template>

<script>
/* global $ */
export default {
  name: 'addProfile',
  props: ['bus'],
  mounted: function () {
    // 直接初始化的话不管用, 试过在updated钩子上初始化, 也不管用
    setTimeout(() => {
      $('.ui.dropdown').dropdown({on: 'hover'})
    }, 1000)
  }
}
</script>
