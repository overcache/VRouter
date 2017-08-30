<template>
  <div id="profile-editor" class="ui large modal">
    <div class="ui top left attached label">{{ header }}</div>

    <!-- content -->
    <div class="scrolling content">

      <div class="ui left action input fluid">
        <div class="ui teal button">
          配置名称
        </div>
        <input type="text" :value="editingClone.name">
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

export default {
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
    }
  },
  watch: {
    showProfileEditor: function (value) {
      const action = value ? 'show' : 'hide'
      // $('#profile-editor').modal({
      //   onHidden: function () {
      //     self.bus.$emit('editorCancel')
      //   },
      //   duration: 300,
      //   closable: false,
      //   inverted: true,
      //   blurring: true
      // }).modal(action)
      $('#profile-editor').modal(action)
    }
  },
  methods: {
    editorSave: function () {
      this.bus.$emit('editorSave')
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
  }
}
</script>

<style>
#profile-editor {
  padding: 30px 0 30px 30px;
}
#profile-editor .ui.form {
  margin: 20px 0;
}
#profile-editor .buttons {
  margin-right: 20px;
}
#profile-editor .content.scrolling {
  /*padding-top: 30px !important;*/
  margin-bottom: 30px;
}

</style>
