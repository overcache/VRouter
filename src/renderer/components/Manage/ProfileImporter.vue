<template lang="html">
<div class="ui basic modal profile-importer">
  <div class="ui action fluid input">
    <input type="text">
    <div class="ui button teal right labeled icon" @click="importProfile">
      <i class="copy icon"></i>
      导入URI
    </div>
  </div>
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
      closable: true,
      inverted: true,
      blurring: true
    })
  }
}
</script>

<style lang="css">
</style>
