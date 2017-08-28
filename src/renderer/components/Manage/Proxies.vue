<template>
  <div>

    <div class="ui dropdown button left pointing labeled icon teal">
      <i class="add user icon"></i>
      添加配置
      <div class="menu">
        <div class="item">
          <i class="ui plus icon"></i>
          新建
        </div>

        <div class="item">
          <i class="ui paste icon"></i>
          导入
        </div>
      </div>
    </div>

    <div class="ui divider hidden"></div>

    <div class="profiles" v-for="item in profiles">
      <profile :profile="item"></profile>
    </div>

    <div class="ui divider hidden"></div>

    <div class="buttons">
      <div class="ui teal labeled icon button right floated" @click="$emit('editExtraList', 'white')">
        <i class="ui write icon"></i>
        自定义白名单
      </div>

      <div class="ui teal labeled icon button right floated" @click="$emit('editExtraList', 'black')">
        <i class="ui write icon"></i>
        自定义黑名单
      </div>
    </div>
  </div>
</template>

<script>
/* global $ */
import Profile from './Proxies/Profile.vue'

export default {
  name: 'proxies-tab',
  props: ['profiles'],
  components: {
    Profile
  },
  mounted: function () {
    $('.dropdown').dropdown({on: 'hover'})
  }
}
</script>
