<template lang="html">
  <div class="ui dimmer">
    <div class="ui fullscreen modal error-modal">
      <div class="header red">Error: {{ error.message }}</div>
      <div class="scrolling content"><pre>{{ error.stack }}</pre></div>
      <div class="ui button basic right floated" @click="hideModal">
        确定
      </div>
      <div class="ui button basic right floated" @click="bus.$emit('reloadApp')">
        重载应用
      </div>
    </div>
  </div>
</template>

<script>
/* global $ */
export default {
  name: 'error-modal',
  props: ['error', 'showErrorModal', 'bus'],
  watch: {
    error (val) {
      $('.ui.modal.error-modal').modal('show')
    }
  },
  methods: {
    hideModal: function () {
      $('.ui.modal.error-modal').modal('hide')
    }
  },
  created () {
    $('.ui.modal').modal({
      detachable: false
    })
  }
}
</script>

<style lang="css">
  .ui.modal.error-modal {
    padding: 30px;
  }
  .ui.modal.error-modal .header.red {
    color: red;
  }
</style>
