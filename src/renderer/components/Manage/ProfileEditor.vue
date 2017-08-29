<template>
  <div class="ui modal profile-editor">

    <!-- header -->
    <div class="header">
      {{ header }}
    </div>

    <!-- content -->
    <div class="scrolling content">
      <div class="ui form">
        <div class="field">
          <label>配置名称</label>
          <input type="text" v-model="name">
        </div>
      </div>
      <!-- <mode-form></mode-form> -->
    </div>

    <!-- actions -->
    <div class="ui actions">
      <div class="ui button ok" @click="editorSave">保存</div>
      <div class="ui button cancel" @click="editorCancel">取消</div>
    </div>
  </div>
</template>

<script>
/* global $ */
// import ProxiesForm from './ProfileEditor/ProxiesForm'
import ModeForm from './ProfileEditor/ModeForm'

export default {
  name: 'profile-editor',
  props: ['editingClone', 'showProfileEditor', 'bus'],
  components: {
    // ProxiesForm,
    ModeForm
  },
  data: function () {
    return this.editingClone
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
    }
  },
  watch: {
    showProfileEditor: function (value) {
      const action = value ? 'show' : 'hide'
      $('.ui.modal.profile-editor').modal(action)
    }
  },
  methods: {
    editorSave: function () {
      this.bus.$emit('editorSave')
      $('.ui.modal.profile-editor').modal('hide')
    },
    editorCancel: function () {
      this.bus.$emit('editorCancel')
      $('.ui.modal.profile-editor').modal('hide')
    }
  },
  mounted: function () {
    const self = this
    $('.ui.modal.profile-editor').modal({
      onHidden: function () {
        self.bus.$emit('editorCancel')
      },
      duration: 300,
      closable: false,
      inverted: true,
      blurring: true
    })
    $('.ui.dropdown').dropdown()
  }
}
</script>

<style>
.ui.modal.profile-editor {
  padding: 30px;
}
</style>
