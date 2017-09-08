<template lang="html">
  <form id="shadowsocksr-form" class="ui form">
    <h4 class="ui header dividing pink"><a href="https://github.com/shadowsocksr/shadowsocksr-libev#usage">ShadowsocksR<i class="small icon external square"></i></a></h4>

    <div class="field">
      <div class="three fields">
        <div class="eight wide field">
          <label for="">Server</label>
          <input type="text" v-model="shadowsocksr.server">
        </div>
        <div class="four wide field">
          <label>Server Port</label>
          <input type="text" v-model.number="shadowsocksr.server_port">
        </div>
        <div class="four wide field">
          <label>Timeout</label>
          <input type="text" v-model.number="shadowsocksr.timeout">
        </div>
      </div>
    </div>

    <div class="field">
      <div class="four fields">
        <div class="four wide field">
          <label for="">Password</label>
          <input type="text" v-model="shadowsocksr.password">
        </div>
        <div class="four wide field">
          <label for="">Encrypt Method</label>
          <input type="text" v-model="shadowsocksr.method">
        </div>
        <div class="four wide field">
          <label for="">Protocol</label>
          <input type="text" v-model="shadowsocksr.protocol">
        </div>
        <div class="four wide field">
          <label for="">Obfs</label>
          <input type="text" v-model="shadowsocksr.obfs">
        </div>
      </div>
    </div>

    <div class="field">
      <div class="four fields">
        <div class="four wide field">
          <label for="">Protocol Param</label>
          <input type="text" v-model="shadowsocksr.protocol_param">
        </div>
        <div class="four wide field">
          <label for="">Obfs Param</label>
          <input type="text" v-model="shadowsocksr.obfs_param">
        </div>
        <div class="four wide field">
          <label>Fast Open</label>
          <select class="ui dropdown" v-model="fastOpen">
            <option>true</option>
            <option>false</option>
          </select>
        </div>
        <div class="four wide field">
          <label for="">Others</label>
          <input type="text" v-model="shadowsocksr.others">
        </div>
      </div>
    </div>
  </form>
</template>

<script>
export default {
  name: 'ssr-form',
  props: ['shadowsocksr'],
  computed: {
    fastOpen: {
      get: function () {
        return this.shadowsocksr.fast_open.toString()
      },
      set: function (value) {
        this.shadowsocksr.fast_open = Boolean(value)
      }
    }
  }
}
</script>

<style lang="css">
#shadowsocksr-form.ui.form {
  margin: 40px 0;
}
</style>
