<template>
  <div class="ui buttons right floated">
    <button class="ui button teal" @click="bus.$emit('newProfile')">新建</button>
    <div class="or"></div>
    <button class="ui button green" @click="bus.$emit('openProfileImporter')">导入</button>
  </div>
</template>

<script>
export default {
  name: 'addProfile',
  props: ['bus'],
  mounted: function () {
  }
}
</script>
