<template lang="html">
<div class="ui tiny modal profile-importer">
  <div class="ui top left attached label green">导入URI</div>
  <div class="ui fluid input">
    <input type="text" placeholder="ss://YWVzLTEyOC1nY206dGVzdA==@192.168.100.1:8888#Example1" v-model.trim="uri">
  </div>
  <div class="ui pointing label" :class="showErrorMsg ? 'red' : 'teal'">支持 shadowsocks[r] 的<a class="ui red" href="https://shadowsocks.org/en/config/quick-guide.html">原始格式</a>以及<a href="https://shadowsocks.org/en/spec/SIP002-URI-Scheme.html"> SIP002 </a>格式</div>
  <div class="ui divider hidden"></div>
  <div class="ui button right floated" @click="cancelImport">取消</div>
  <div class="ui button teal right floated" @click="importProfile">导入</div>
</div>
</template>

<script>
/* global $ */
import Utils from '@/lib/utils.js'
export default {
  name: 'profile-importer',
  props: ['bus', 'showProfileImporter', 'templateProfile'],
  data: function () {
    return {
      uri: '',
      showErrorMsg: false
    }
  },
  methods: {
    importProfile: function () {
      const type = this.uri.substr(0, this.uri.indexOf(':'))
      if (!this.uri || !/^(ss|ssr)$/ig.test(type)) {
        this.uri = ''
        this.showErrorMsg = true
      } else {
        try {
          const profile = Utils.parseProfileURI(this.uri, this.templateProfile)
          this.bus.$emit('importProfile', profile)
          $('.ui.modal.profile-importer').modal('hide')
        } catch (err) {
          console.error(`importProfile error. can not parse uri: ${this.uri}. error: ${err}`)
          this.showErrorMsg = true
        }
      }
    },
    cancelImport: function () {
      $('.ui.modal.profile-importer').modal('hide')
    }
  },
  watch: {
    showProfileImporter: function (value) {
      const action = value ? 'show' : 'hide'
      $('.ui.modal.profile-importer').modal(action)
    },
    showErrorMsg: function (value) {
      if (value) {
        setTimeout(() => {
          this.uri = ''
          this.showErrorMsg = false
        }, 1500)
      }
    }
  },
  mounted: function () {
    const self = this
    $('.ui.modal.profile-importer').modal({
      onHidden: function () {
        self.bus.$emit('importerCancel')
        self.showErrorMsg = false
        self.uri = ''
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
