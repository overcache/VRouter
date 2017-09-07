<template lang="html">
  <div class="ui dimmer">
    <div class="ui modal error-modal">
      <div class="header red">Error: {{ error.message }}</div>
      <div class="scrolling content"><pre>{{ error.stack }}</pre></div>
      <div class="ui button basic right floated" @click="hideModal">
        确定
      </div>
    </div>
  </div>
</template>

<script>
/* global $ */
export default {
  name: 'error-modal',
  props: ['error', 'showErrorModal'],
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
