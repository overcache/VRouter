<template>
  <div id="loader" class="ui dimmer">
    <div id="ui-modal" class="ui basic modal">
      <div class="header">{{ info.header }}</div>
      <div class="scrolling content" v-html="info.content"></div>
      <div class="ui button teal" v-for="btn in info.buttons" v-on:click="btn.handler">
        {{ btn.label }}
      </div>
    </div>
  </div>
</template>

<script>
/* global $ */
export default {
  name: 'ui-modal',
  props: ['info'],
  computed: {
    show () {
      return this.info.show
    }
  },
  watch: {
    show (val) {
      $('.ui.modal').modal(val ? 'show' : 'hide')
    }
  },
  updated () {
    $('.ui.modal').modal({
      detachable: false
    })
  }
}
</script>
