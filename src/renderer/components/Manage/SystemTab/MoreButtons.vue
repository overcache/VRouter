<template lang="html">
  <div>
    <div id="more-buttons-dropdown" class="ui dropdown basic button left pointing labeled icon left floated">
      <i class="ellipsis horizontal icon"></i>
      更多
      <div class="menu">
        <div class="item" @click="toggleDeleteVRouterModal('show')">
          <i class="ui trash icon red"></i>
          删除
        </div>
        <div class="item" @click="bus.$emit('shutdownVRouter')">
          <i class="ui shutdown icon red"></i>
          关闭
        </div>
        <div class="item" @click="toggleLoginVRouterModal('show')">
          <i class="ui sign in icon teal"></i>
          登录
        </div>
        <div class="item" @click="bus.$emit('openLogFile')">
          <i class="ui terminal icon teal"></i>
          日志
        </div>
        <div class="item" @click="toggleAboutModal('show')">
          <i class="ui info icon teal"></i>
          关于
        </div>
      </div>
    </div>

    <div id="delete-vrouter-modal" class="ui tiny modal">
      <div class="ui top left attached label red">删除 VRouter</div>
      <div class="content">
        <p>如果能移步至 <a href="https://github.com/icymind/VRouter/issues">github</a> 提交 issues, 将不胜感激.</p>
      </div>
      <div class="ui basic button right floated" @click="toggleDeleteVRouterModal('hide')">取消</div>
      <div class="ui basic button red right floated" @click="toggleDeleteVRouterModal('hide');bus.$emit('deleteVRouter')">删除</div>
    </div>

    <div id="login-vrouter-modal" class="ui tiny modal">
      <div class="ui top left attached label red">登录</div>
      <div class="content">
        <p>后台虚拟机 IP 为 10.19.28.37 , 用户名密码均为 root , 你还可以用 Web 或者 SSH 的方式登录. 但是, VRouter 和后台的虚拟机紧密关联, 各项功能都依赖于正确设置了虚拟机. 修改虚拟机可能会造成 VRouter 无法正常工作.</p>
        <p>在 VirtualBox 界面, macOS 可以通过菜单栏 Machine - Detach GUI 将虚拟机转为后台运行, windows 版本的相应菜单为 控制 - 分离式界面</p>
      </div>

      <div class="ui basic button right floated" @click="toggleLoginVRouterModal('hide')">
        <i class="checkmark icon"></i>
        取消
      </div>
      <div class="ui basic red button right floated" @click="toggleLoginVRouterModal('hide');bus.$emit('loginVRouter')">
        <i class="remove icon"></i>
        VirtualBox 登录
      </div>
    </div>

    <div id="about-modal" class="ui modal">
      <div class="ui top left attached label teal">关于</div>
      <div class="content">
        <p><i class="ui fork icon green"></i> Version: {{ version }}</p>
        <p><i class="ui idea icon teal"></i> Build by {{ author }}</p>
        <p><i class="ui heart icon red"></i> Base on virtualbox/openwrt/electron/vue/semantic-ui</p>
        <p><i class="ui copyright icon"></i> Released under GPL license.</p>
      </div>
      <div class="ui basic button right floated" @click="toggleAboutModal('hide')">
        确定
      </div>
      <div class="ui basic button right floated" @click="goToHomepage">
        主页
      </div>
    </div>
  </div>
</template>

<script>
/* global $ */
const { shell } = require('electron')
const packageJson = require('package.json')

export default {
  name: 'more-buttons',
  props: ['bus'],
  data: function () {
    return {
      version: packageJson.version,
      author: packageJson.author
    }
  },
  methods: {
    toggleDeleteVRouterModal: function (action) {
      $('#delete-vrouter-modal').modal(action)
    },
    toggleLoginVRouterModal: function (action) {
      $('#login-vrouter-modal').modal(action)
    },
    toggleAboutModal: function (action) {
      $('#about-modal').modal(action)
    },
    goToHomepage () {
      this.toggleAboutModal('hide')
      return shell.openExternal('https://github.com/icymind/VRouter')
    }
  },
  mounted: function () {
    $('#delete-vrouter-modal').modal({
      closable: true,
      inverted: true,
      blurring: true
    })
    $('#login-vrouter-modal').modal({
      closable: true,
      inverted: true,
      blurring: true
    })
    $('#about-modal').modal({
      closable: true,
      inverted: true,
      blurring: true
    })
    $('#more-buttons-dropdown.ui.dropdown').dropdown({
      on: 'click'
    })
  }
}
</script>

<style lang="css">
#login-vrouter-modal,
#delete-vrouter-modal,
#about-modal {
  padding: 30px;
}
</style>
