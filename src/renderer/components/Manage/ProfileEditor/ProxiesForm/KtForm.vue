<template lang="html">
  <form class="ui form kcptun">
    <h4 class="ui header dividing teal"><a href="https://github.com/xtaci/kcptun#usage">Kcptun<i class="small icon external square"></i></a></h4>

    <div class="field">
      <div class="three fields">
        <div class="eight wide field">
          <label for="">Server</label>
          <input type="text" v-model="kcptun.server">
        </div>
        <div class="four wide field">
          <label>Server Port</label>
          <input type="text" v-model.number="kcptun.server_port">
        </div>
        <div class="four wide field">
          <label>Mode</label>
          <input type="text" v-model="kcptun.mode">
        </div>
      </div>
    </div>

    <div class="field">
      <div class="two fields">
        <div class="eight wide field">
          <label for="">Key</label>
          <input type="text" v-model="kcptun.key">
        </div>
        <div class="eight wide field">
          <label for="">Encrypt Method</label>
          <input type="text" v-model="kcptun.crypt">
        </div>
      </div>
    </div>

    <div class="field">
      <label for="">Others</label>
      <input type="text" v-model="kcptun.others">
    </div>
  </form>
</template>

<script>
export default {
  name: 'kt-form',
  props: ['kcptun']
}
</script>

<style lang="css">
.kcptun {
  margin: 15px 0;
}
</style>
