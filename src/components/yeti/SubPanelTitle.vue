<template>
  <div class="columns is-mobile">
    <div class="column">
      <h2 class="title is-3">
        <slot></slot>
      </h2>
    </div>
  </div>
</template>

<style scoped lang="scss">
@import '@/assets/sass/variables';

h2 {
  display: inline-block;
  margin-left: -1.25rem;
  padding: 0.25em 1.25rem;
  background: $grey-lighter;
}
</style>
