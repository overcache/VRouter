<template>
  <div>
    <div class="ui teal labeled icon button right floated" @click="bus.$emit('editExtraList', 'white')">
      <i class="ui write icon"></i>
      自定义白名单
    </div>

    <div class="ui teal labeled icon button right floated" @click="bus.$emit('editExtraList', 'black')">
      <i class="ui write icon"></i>
      自定义黑名单
    </div>
  </div>
</template>

<script>
export default {
  name: 'editExtraListBtns',
  props: ['bus']
}
</script>
