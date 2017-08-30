<template lang="html">
  <div class="info-list">
    <h4 class="ui header teal">{{ header }}</h4>
    <div class="ui list" v-for="item in infoList">
      <transition name="fade" duration="{ enter: 500, leave: 800 }">
        <div class="item" v-show="showAllLabel || !item.hide">
          <div class="ui label">
            {{ item.label }}: <span class="detail">{{ item.value }}</span>
            <i class="ui circle icon" :class="item.icon" v-if="item.icon"></i>
          </div>
        </div>
      </transition>
    </div>
    <div class="ui basic button" v-if="moreBtn" @click="toggleHidden">
      <i class="icon chevron circle" :class="moreBtnIconClass"></i>
      {{ moreBtnLabel }}
    </div>
  </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'info-list',
  props: ['header', 'infoList'],
  data: function () {
    return {
      showAllLabel: false
    }
  },
  computed: {
    moreBtn: function () {
      let more = false
      this.infoList.forEach(item => {
        if (item.hide) more = true
      })
      return more
    },
    moreBtnLabel: function () {
      return this.showAllLabel ? 'LESS' : 'MORE'
    },
    moreBtnIconClass: function () {
      return this.showAllLabel ? 'up' : 'down'
    }
  },
  methods: {
    toggleHidden: function () {
      this.showAllLabel = !this.showAllLabel
      setTimeout(() => {
        this.showAllLabel = false
      }, 6000)
    }
  }
}
</script>

<style lang="css">
.info-list {
  margin-bottom: 20px;
}
.fade-enter-active, .fade-leave-active {
  transition: opacity .3s
}
.fade-enter, .fade-leave-to /* .fade-leave-active in below version 2.1.8 */ {
  opacity: 0
}
</style>
