<template lang="html">
  <div>

    <div v-for="item in information">
      <info-list
        :header="item.header"
        :infoList="item.infoList"
      >
      </info-list>
    </div>

  </div>
</template>

<script>
import InfoList from './SystemTab/InfoList'

export default {
  name: 'system-tab',
  props: ['systemInfo', 'vrouterInfo', 'proxiesInfo'],
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
              value: this.vrouterInfo.macAddress
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
  }
}
</script>

<style lang="css">
</style>
