<template>
  <div id="profile-editor" class="ui large modal">
    <div class="ui top left attached label" :class="headerLabelColor">{{ header }}</div>

    <!-- content -->
    <div class="scrolling content">

      <div class="ui left action input fluid">
        <div class="ui teal button">
          配置名称
        </div>
        <input type="text" v-model="editingClone.name">
      </div>

      <mode-form :editingClone="editingClone"></mode-form>

      <div class="ui divider"></div>

      <proxies-form :editingClone="editingClone"></proxies-form>
    </div>

    <div class="buttons">
      <div class="ui button negative right floated" @click="editorCancel">取消</div>
      <div class="ui button teal right floated" @click="editorSave">保存</div>
    </div>
  </div>
</template>

<script>
/* global $ */
import ProxiesForm from './ProfileEditor/ProxiesForm'
import ModeForm from './ProfileEditor/ModeForm'

import Vue from 'vue'
import VeeValidate from 'vee-validate'
Vue.use(VeeValidate, { inject: false })

export default {
  $validates: true,
  name: 'profile-editor',
  props: ['editingClone', 'showProfileEditor', 'bus'],
  components: {
    ProxiesForm,
    ModeForm
  },
  computed: {
    header: function () {
      if (this.editingClone.index === -2) {
        return '导入配置'
      }
      if (this.editingClone.index === -1) {
        return '新建配置'
      }
      return '编辑配置'
    },
    headerLabelColor: function () {
      if (this.editingClone.index === -2) {
        return 'green'
      }
      if (this.editingClone.index === -1) {
        return 'teal'
      }
      return 'teal'
    }
  },
  watch: {
    showProfileEditor: function (value) {
      const action = value ? 'show' : 'hide'
      $('#profile-editor').modal(action)
    }
  },
  methods: {
    editorSave: function () {
      this.$validator.validateAll()
      if (this.$validator.errors.any()) {
        return
      }
      this.bus.$emit('editorSave', Object.assign({}, this.editingClone))
      $('#profile-editor').modal('hide')
    },
    editorCancel: function () {
      this.bus.$emit('editorCancel')
      $('#profile-editor').modal('hide')
    }
  },
  mounted: function () {
    const self = this
    $('#profile-editor').modal({
      onHidden: function () {
        self.bus.$emit('editorCancel')
      },
      duration: 300,
      closable: false,
      inverted: true,
      blurring: true
    })
  },
  created: function () {
  }
}
</script>

<style>
#profile-editor {
  padding: 30px 0 60px 30px;
}
#profile-editor .ui.form {
  margin: 20px 0;
}
#profile-editor .buttons {
  margin-right: 20px;
}
#profile-editor .content.scrolling {
  margin-bottom: 30px;
}

</style>
