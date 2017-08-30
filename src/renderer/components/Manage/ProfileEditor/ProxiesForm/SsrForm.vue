<template lang="html">
  <form id="shadowsocksr-form" class="ui form">
    <h4 class="ui header dividing pink"><a href="https://github.com/shadowsocksr/shadowsocksr-libev#usage">ShadowsocksR<i class="small icon external square"></i></a></h4>

    <div class="field">
      <div class="three fields">
        <div class="eight wide field">
          <label for="">Server</label>
          <input type="text" v-model="server">
        </div>
        <div class="four wide field">
          <label>Server Port</label>
          <input type="text" v-model.number="server_port">
        </div>
        <div class="four wide field">
          <label>Timeout</label>
          <input type="text" v-model.number="timeout">
        </div>
      </div>
    </div>

    <div class="field">
      <div class="four fields">
        <div class="four wide field">
          <label for="">Password</label>
          <input type="text" v-model="password">
        </div>
        <div class="four wide field">
          <label for="">Encrypt Method</label>
          <input type="text" v-model="method">
        </div>
        <div class="four wide field">
          <label for="">Protocol</label>
          <input type="text" v-model="protocol">
        </div>
        <div class="four wide field">
          <label for="">Obfs</label>
          <input type="text" v-model="obfs">
        </div>
      </div>
    </div>

    <div class="field">
      <div class="four fields">
        <div class="four wide field">
          <label for="">Protocol Param</label>
          <input type="text" v-model="protocol_param">
        </div>
        <div class="four wide field">
          <label for="">Obfs Param</label>
          <input type="text" v-model="obfs_param">
        </div>
        <div class="four wide field">
          <label for="">Fast Open</label>
          <input type="text" v-model="fast_open">
        </div>
        <div class="four wide field">
          <label for="">Others</label>
          <input type="text" v-model="others">
        </div>
      </div>
    </div>
  </form>
</template>

<script>
export default {
  name: 'ssr-form',
  props: ['shadowsocksr'],
  data: function () {
    return this.shadowsocksr
  }
}
</script>

<style lang="css">
#shadowsocksr-form.ui.form {
  margin: 40px 0;
}
</style>
