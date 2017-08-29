<template lang="html">
  <div class="ui form modeform">
    <h4 class="ui header dividing teal">Mode</h4>
    <mode-dropdown></mode-dropdown>
    <blacklist></blacklist>
    <whitelist></whitelist>
  </div>
</template>

<script>
import ModeDropdown from './ModeForm/ModeDropdown'
import Blacklist from './ModeForm/Blacklist'
import Whitelist from './ModeForm/Whitelist'

export default {
  name: 'mode-form',
  components: {
    ModeDropdown,
    Blacklist,
    Whitelist
  }
}
</script>

<style lang="css">
.modeform {
  border: 1px dashed teal;
  border-radius: 10px;
  padding: 10px;
}
</style>
