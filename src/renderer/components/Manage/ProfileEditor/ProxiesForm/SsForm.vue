<template lang="html">
  <form class="ui form shadowsocks">
    <h4 class="ui header dividing teal"><a href="https://github.com/shadowsocks/shadowsocks-libev#usage">Shadowsocks<i class="small icon external square"></i></a></h4>

    <div class="field">
      <div class="three fields">
        <div class="eight wide field">
          <label for="">Server</label>
          <input type="text" v-model="server">
        </div>
        <div class="four wide field">
          <label>Server Port</label>
          <input type="text" v-model="server_port">
        </div>
        <div class="four wide field">
          <label>Timeout</label>
          <input type="text" v-model="timeout">
        </div>
      </div>
    </div>

    <div class="field">
      <div class="three fields">
        <div class="eight wide icon field">
          <label for="">Password</label>
          <input type="text" v-model="password">
        </div>
        <div class="four wide field">
          <label for="">Encrypt Method</label>
          <input type="text" v-model="method">
        </div>
        <div class="four wide field">
          <label for="">Fast Open</label>
          <input type="text" v-model="fast_open">
        </div>
      </div>
    </div>
  </form>
</template>

<script>
export default {
  name: 'ss-form',
  props: ['shadowsocks'],
  data: function () {
    return this.shadowsocks
  }
}
</script>

<style lang="css">
.shadowsocks {
  margin: 20px 0;
}
</style>
