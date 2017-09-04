<template lang="html">
  <div id="mode-form" class="ui form">
    <div class="grouped fields">
      <label>代理模式:</label>
      <div class="field">
        <div class="ui radio checkbox">
          <input type="radio" value="whitelist" v-model="mode">
          <label>绕过白名单</label>
        </div>
      </div>
      <div class="field">
        <div class="ui radio checkbox">
          <input type="radio" value="blacklist" v-model="mode">
          <label>仅代理黑名单</label>
        </div>
      </div>
      <div class="field">
        <div class="ui radio checkbox">
          <input type="radio" value="global" v-model="mode">
          <label>全局代理</label>
        </div>
      </div>
      <div class="field">
        <div class="ui radio checkbox">
          <input type="radio" value="none" v-model="mode">
          <label>无代理</label>
        </div>
      </div>
    </div>

    <div class="inline fields">
      <label>黑 名 单</label>
      <div class="field">
        <div class="ui checkbox">
          <input type="checkbox" value="gfwList" v-model="blacklist">
          <label>GFWList</label>
        </div>
      </div>
      <div class="field">
        <div class="ui checkbox">
          <input type="checkbox" value="extraBlackList" v-model="blacklist">
          <label>自定义黑名单</label>
        </div>
      </div>
    </div>

    <div class="inline fields">
      <label>白 名 单</label>
      <div class="field">
        <div class="ui checkbox">
          <input type="checkbox" value="lanNetworks" v-model="whitelist">
          <label>局域网地址</label>
        </div>
      </div>
      <div class="field">
        <div class="ui checkbox">
          <input type="checkbox" value="chinaIPs" v-model="whitelist">
          <label>大陆地址</label>
        </div>
      </div>
      <div class="field">
        <div class="ui checkbox">
          <input type="checkbox" value="extraWhiteList" v-model="whitelist">
          <label>自定义白名单</label>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'mode-form',
  props: ['editingClone'],
  computed: {
    mode: {
      get: function () {
        return this.editingClone.mode
      },
      set: function (value) {
        this.editingClone.mode = value
      }
    },
    blacklist: {
      get: function () {
        return this.selectedListToArray('blacklist')
      },
      set: function (value) {
        return this.arrayToSelectedList('blacklist', value)
      }
    },
    whitelist: {
      get: function () {
        return this.selectedListToArray('whitelist')
      },
      set: function (value) {
        return this.arrayToSelectedList('whitelist', value)
      }
    }
  },
  methods: {
    selectedListToArray: function (type) {
      const selected = type === 'whitelist'
        ? this.editingClone.selectedWL
        : this.editingClone.selectedBL

      const arr = []
      Object.keys(selected).forEach(key => {
        if (selected[key]) {
          arr.push(key)
        }
      })
      return arr
    },
    arrayToSelectedList: function (type, value) {
      const selected = type === 'whitelist'
        ? this.editingClone.selectedWL
        : this.editingClone.selectedBL

      Object.keys(selected).forEach(key => {
        if (value.includes(key)) {
          selected[key] = true
        } else {
          selected[key] = false
        }
      })
    }
  },
  mounted: function () {
    // console.log(this.editingClone)
  }
}
</script>

<style lang="css">
/*#mode-form {
  margin: 30px 0;
}*/
</style>
