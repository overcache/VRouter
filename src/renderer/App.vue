<template>
  <div id="app">
    <prepare v-if="!prepared" v-on:prepared="showManage"></prepare>
    <manage v-if="prepared"></manage>
  </div>
</template>

<script>
import '@/vendor/semantic.min.js'
import Prepare from '@/components/Prepare'
import Manage from '@/components/Manage'
import logger from '@/lib/logger'
const { ipcRenderer } = require('electron')

export default {
  name: 'vrouter',
  data () {
    return {
      prepared: false
    }
  },
  components: {
    Prepare,
    Manage
  },
  methods: {
    showManage () {
      this.prepared = true
    }
  },
  mounted: function () {
    ipcRenderer.on('updater', (event, arg) => {
      logger.debug(arg)
    })
  }
}
</script>

<style>
@import './vendor/semantic.min.css';
body {
  min-width: 420px;
  padding: 1% 5%;
}
</style>
