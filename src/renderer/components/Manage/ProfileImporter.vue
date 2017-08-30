<template lang="html">
<div class="ui modal profile-importer">
  <div class="ui top left attached label">导入URI</div>
  <div class="ui fluid input">
    <input type="text">
  </div>
  <div class="ui divider hidden"></div>
  <div class="ui button negative right floated" @click="cancelImport">取消</div>
  <div class="ui button teal right floated" @click="importProfile">导入</div>
</div>
</template>

<script>
/* global $ */
export default {
  name: 'profile-importer',
  props: ['bus', 'showProfileImporter'],
  methods: {
    importProfile: function () {
      this.bus.$emit('importProfile')
      $('.ui.modal.profile-importer').modal('hide')
    },
    cancelImport: function () {
      $('.ui.modal.profile-importer').modal('hide')
    }
  },
  watch: {
    showProfileImporter: function (value) {
      const action = value ? 'show' : 'hide'
      $('.ui.modal.profile-importer').modal(action)
    }
  },
  mounted: function () {
    const self = this
    $('.ui.modal.profile-importer').modal({
      onHidden: function () {
        self.bus.$emit('importerCancel')
      },
      duration: 300,
      closable: false,
      inverted: true,
      blurring: true
    })
  }
}
</script>

<style lang="css">
.profile-importer {
  padding: 40px;
}
</style>
