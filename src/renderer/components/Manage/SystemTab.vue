<template lang="html">
  <div id="system-tab">

    <div v-for="item in information">
      <info-list
        :header="item.header"
        :infoList="item.infoList"
      >
      </info-list>
    </div>

    <div class="ui divider"></div>

    <div id="more-buttons-dropdown" class="ui dropdown button left pointing left floated labeled icon">
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
        <div class="item" @click="bus.$emit('openLogFile')">
          <i class="ui terminal icon teal"></i>
          日志
        </div>
        <div class="item" @click="bus.$emit('showAboutModal')">
          <i class="ui info icon teal"></i>
          关于
        </div>
      </div>
    </div>
    <div class="ui labeled icon teal button right floated" @click="bus.$emit('refreshInfos', false)">
      <i class="inline ui refresh icon"></i>
      刷新
    </div>

    <div id="delete-vrouter-modal" class="ui modal">
      <div class="ui top left attached label red">删除 VRouter</div>
      <div class="content">
        <p>重建一个挺花时间的, 确定删除么 ?</p>
      </div>
      <div class="ui button right floated" @click="toggleDeleteVRouterModal('hide')">取消</div>
      <div class="ui button red right floated" @click="toggleDeleteVRouterModal('hide');bus.$emit('deleteVRouter')">删除</div>
    </div>
  </div>
</template>

<script>
/* global $ */
import InfoList from './SystemTab/InfoList'

export default {
  name: 'system-tab',
  props: ['systemInfo', 'vrouterInfo', 'proxiesInfo', 'bus'],
  components: {
    InfoList
  },
  computed: {
    information: function () {
      return [
        {
          header: '系统信息',
          infoList: [
            {
              label: '当前网关',
              value: this.systemInfo.currentGWIP
            },
            {
              label: '当前 DNS',
              value: this.systemInfo.currentDnsIP
            }
          ]
        },
        {
          header: 'VRouter 信息',
          infoList: [
            {
              label: 'Bridged Adapter',
              value: this.vrouterInfo.bridgeAdapter
            },
            {
              label: 'WAN',
              value: this.vrouterInfo.lanIP
            },
            {
              label: 'Mac Address',
              value: this.vrouterInfo.macAddress,
              hide: true
            },
            {
              label: 'Openwrt Version',
              value: this.vrouterInfo.openwrtVersion,
              hide: true
            },
            {
              label: 'BR-LAN',
              value: this.vrouterInfo.brLanIP,
              hide: true
            },
            {
              label: 'Shadowsocks Version',
              value: this.vrouterInfo.ssVersion,
              hide: true
            },
            {
              label: 'ShadowsocksR Version',
              value: this.vrouterInfo.ssrVersion,
              hide: true
            },
            {
              label: 'Kcptun Version',
              value: this.vrouterInfo.ktVersion,
              hide: true
            }
          ]
        },
        {
          header: '进程状态',
          infoList: [
            {
              label: '转发 DNS 查询',
              value: this.proxiesInfo.enableTunnelDns ? (this.proxiesInfo.isTunnelDnsRunning ? '运行中' : '已停止') : '未启用',
              icon: this.proxiesInfo.enableTunnelDns ? (this.proxiesInfo.isTunnelDnsRunning ? 'check teal' : 'minus red') : 'toggle off'
            },
            {
              label: 'Shadowsocks 进程',
              value: this.proxiesInfo.enableSs ? (this.proxiesInfo.isSsRunning ? '运行中' : '已停止') : '未启用',
              icon: this.proxiesInfo.enableSs ? (this.proxiesInfo.isSsRunning ? 'check teal' : 'minus red') : 'toggle off'
            },
            {
              label: 'ShadowsocksR 进程',
              value: this.proxiesInfo.enableSsr ? (this.proxiesInfo.isSsrRunning ? '运行中' : '已停止') : '未启用',
              icon: this.proxiesInfo.enableSsr ? (this.proxiesInfo.isSsrRunning ? 'check teal' : 'minus red') : 'toggle off'
            },
            {
              label: 'Kcptun 进程',
              value: this.proxiesInfo.enableKt ? (this.proxiesInfo.isKtRunning ? '运行中' : '已停止') : '未启用',
              icon: this.proxiesInfo.enableKt ? (this.proxiesInfo.isKtRunning ? 'check teal' : 'minus red') : 'toggle off'
            }
          ]
        }
      ]
    }
  },
  methods: {
    toggleDeleteVRouterModal: function (action) {
      $('#delete-vrouter-modal').modal(action)
    }
  },
  mounted: function () {
    $('#delete-vrouter-modal').modal({
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
#system-tab {
  padding-bottom: 50px;
}
#delete-vrouter-modal {
  padding: 30px;
}
</style>
