<template lang="html">
  <div class="blacklist">
    <h4 class="ui teal header">blacklist</h4>

    <div class="ui list">
      <div class="item">
        <div class="ui checkbox">
          <input type="checkbox" name="gwf-list">
          <label for="">GFW-List</label>
        </div>
      </div>

      <div class="item">
        <div class="ui checkbox">
          <input type="checkbox" name="extra-blacklist">
          <label for="">custom</label>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
}
</script>

<style lang="css">
.blacklist {
  margin: 20px 0;
}
</style>
