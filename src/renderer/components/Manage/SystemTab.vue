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

    <more-buttons :bus="bus"></more-buttons>

    <div class="ui labeled icon teal button right floated" @click="bus.$emit('refreshInfos', false)">
      <i class="inline ui refresh icon"></i>
      刷新
    </div>

  </div>
</template>

<script>
/* global $ */
import InfoList from './SystemTab/InfoList'
import MoreButtons from './SystemTab/MoreButtons'

export default {
  name: 'system-tab',
  props: ['systemInfo', 'vrouterInfo', 'proxiesInfo', 'bus'],
  components: {
    InfoList,
    MoreButtons
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
              label: 'BR-LAN',
              value: this.vrouterInfo.brLanIP
            },
            {
              label: 'WAN',
              value: this.vrouterInfo.lanIP
            },
            {
              label: 'Bridged Network',
              value: this.vrouterInfo.bridgeAdapter
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
</style>
