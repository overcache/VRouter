<template>
  <div id="edit-extra-list-buttons" class="ui dropdown basic button left floated labeled icon">
    <i class="ellipsis horizontal icon"></i>
    自定义名单
    <div class="menu">
      <div class="item" @click="bus.$emit('editExtraList', 'black')">
        黑名单
      </div>
      <div class="item" @click="bus.$emit('editExtraList', 'white')">
        白名单
      </div>
    </div>
  </div>
</template>

<script>
export default {
  /* global $ */
  name: 'editExtraListBtns',
  props: ['bus'],
  mounted: function () {
    $('#edit-extra-list-buttons').dropdown()
  }
}
</script>
