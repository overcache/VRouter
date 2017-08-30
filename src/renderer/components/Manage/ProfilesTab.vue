<template>
  <div id="profiles-tab">
    <profile-list-item
      v-for="(item, index) in profiles"
      :profile="item"
      :index="index"
      :bus="bus"
      :key="index"
    ></profile-list-item>

    <add-profile-btns :bus="bus"></add-profile-btns>

    <edit-extra-list-btns :bus="bus"></edit-extra-list-btns>
  </div>
</template>

<script>
import AddProfileBtns from './ProfilesTab/AddProfileBtns'
import ProfileListItem from './ProfilesTab/ProfileListItem'
import EditExtraListBtns from './ProfilesTab/EditExtraListBtns'

export default {
  name: 'profiles-tab',
  props: ['profiles', 'bus'],
  components: {
    AddProfileBtns,
    ProfileListItem,
    EditExtraListBtns
  },
  mounted: function () {
  }
}
</script>

<style>
#profiles-tab {
  padding-bottom: 60px;
}
</style>
