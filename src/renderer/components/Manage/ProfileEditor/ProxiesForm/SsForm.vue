<template lang="html">
  <form id="shadowsocks-form" class="ui form">
    <h4 class="ui header dividing teal"><a href="https://github.com/shadowsocks/shadowsocks-libev#usage">Shadowsocks<i class="small icon external square"></i></a></h4>

    <div class="field">
      <div class="three fields">
        <div class="eight wide field">
          <label for="">Server</label>
          <input type="text" v-model="shadowsocks.server">
        </div>
        <div class="four wide field">
          <label>Server Port</label>
          <input name="server-port" type="text" v-model.number="shadowsocks.server_port" v-validate="'required'">
          <div class="ui pointing label red" v-show="$validator.errors.has('server-port')">请输入服务器端口</div>
        </div>
        <div class="four wide field">
          <label>Timeout</label>
          <input type="text" v-model.number="shadowsocks.timeout">
        </div>
      </div>
    </div>

    <div class="field">
      <div class="three fields">
        <div class="eight wide icon field">
          <label for="">Password</label>
          <input type="text" v-model="shadowsocks.password">
        </div>
        <div class="four wide field">
          <label for="">Encrypt Method</label>
          <input type="text" v-model="shadowsocks.method">
        </div>
        <div class="four wide field">
          <label>Fast Open</label>
          <select class="ui dropdown" v-model="fastOpen">
            <option>true</option>
            <option>false</option>
          </select>
        </div>
      </div>
    </div>
  </form>
</template>

<script>
import Vue from 'vue'
import VeeValidate from 'vee-validate'
Vue.use(VeeValidate, { inject: false })
export default {
  name: 'ss-form',
  props: ['shadowsocks'],
  inject: ['$validator'],
  computed: {
    fastOpen: {
      get: function () {
        return this.shadowsocks.fast_open.toString()
      },
      set: function (value) {
        this.shadowsocks.fast_open = Boolean(value)
      }
    }
  }
}
</script>

<style lang="css">
#shadowsocks-form.ui.form {
  margin: 40px 0;
}
</style>
