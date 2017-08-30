<template>
  <div class="ui buttons right floated">
    <button class="ui button teal" @click="bus.$emit('newProfile')">新建</button>
    <div class="or"></div>
    <button class="ui button green" @click="bus.$emit('openProfileImporter')">导入</button>
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
