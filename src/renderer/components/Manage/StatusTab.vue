<template>
  <div>
    <div id="logo">
      <img src="./StatusTab/logo.png" alt="logo">
    </div>

    <div id="demonstration" class="ui message">
      <div id="icons">
        <i class="ui huge laptop icon"></i>
        <i class="ui circle icon" :class="{green: routing}"></i>
        <i class="ui circle icon" :class="{green: routing}"></i>
        <i class="ui circle icon" :class="{green: routing}"></i>
        <i class="ui circle icon" :class="{green: routing}"></i>
        <i class="ui huge cube icon" :class="{teal: routing}"></i>
        <i class="ui circle icon" :class="{green: routing}"></i>
        <i class="ui circle icon" :class="{green: routing}"></i>
        <i class="ui circle icon" :class="{green: routing}"></i>
        <i class="ui circle icon" :class="{green: routing}"></i>
        <i class="ui huge wifi icon"></i>
      </div>
      <div class="proxies ui label" :class="{teal: routing}">
        代理: <div class="detail">
          {{ proxies }}
        </div>
      </div>
      <div class="proxies ui label" :class="{teal: routing}">
        模式: <div class="detail">
          {{ mode }}
        </div>
      </div>
    </div>

    <div class="ui labeled icon button right floated" :class="[routing ? 'red' : 'teal']" @click="bus.$emit('toggleRouting')">
      <i class="icon" :class="[routing ? 'pause' : 'play']"></i>
      {{ routing ? '暂停' : '启用' }}
    </div>
  </div>
</template>

<script>
export default {
  name: 'status-tab',
  props: ['routing', 'proxies', 'mode', 'bus']
}
</script>

<style>
#logo {
  background-color: #6bae7f;
  border-radius: 5px;
  text-align: center;
}
#logo img {
  width: 200px;
  padding: 5px;
}
#demonstration {
  min-width: 270px;
  text-align: center;
  margin: 50px 0;
}
#icons {
  padding: 30px 0;
  font-size: 10px;
}
#icons .laptop,
#icons .wifi,
#icons .cube {
  margin-left: 26px;
  margin-right: 26px;
}
</style>
