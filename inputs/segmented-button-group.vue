<docs>
  # `segmented-button-group`

  A group of segmented buttons allowing the user to select one (or more!) of a few related options.

  ### Segmented Button Group Arguments

  * **multiple** - allow multiple things to be selected. `false` by default
  * **options** _(required)_ an array of options
  * **help** - description / helper text for the field
  * **validate.required** - either `true` or an object that described the conditions that should make this field required
  * **validate.requiredMessage** - will appear when required validation fails

  Each option should be an object with `title` and `values` properties. The `values` should be an array of objects with `icon`, `text`, and `value` properties, which will be passed into each `segmented-button`.

  > #### info::Data Format
  >
  > By default, the data for this field will be the selected option's `value`. If multiple selection is turned on, it'll be an object with boolean values keyed to each option's `value`, similar to `checkbox-group`.
</docs>

<style lang="sass">
  @import '../styleguide/mixins';
  @import '../styleguide/typography';
  @import '../styleguide/colors';

  .segmented-button-group {
    align-items: flex-start;
    display: flex;
    flex-flow: row wrap;
    font-family: $font-stack;
    margin-bottom: 16px;

    .ui-textbox__label {
      @include clearfix();

      width: 100%;
    }

    &:hover {
      .ui-textbox__label-text {
        color: rgba(black, 0.75);
      }
    }

    &.has-floating-label {
      .ui-textbox__label-text {
        display: table;
      }
    }

    &.is-invalid {
      .ui-textbox__label-text {
        color: $md-red;
      }

      .ui-textbox__feedback {
        color: $md-red;
      }
    }
  }

  // some tiny styling tweaks when buttons are grouped
  .segmented-button-group-input {
    .segmented-button {
      margin-bottom: 0;
    }

    .ui-textbox__label-text {
      font-size: 14px;
    }
  }
</style>

<template>
  <div class="segmented-button-group has-label has-floating-label" :class="{ 'is-invalid': this.isInvalid }">
    <span class="ui-textbox__label">
      <div class="ui-textbox__label-text is-floating">{{ label }}</div>
      <div v-for="(option, index) in options" :key="index" class="segmented-button-group-input">
        <segmented-button :name="name" :data="data" :schema="option.schema" :args="option.args"></segmented-button>
      </div>
    </span>

    <div class="ui-textbox__feedback" v-if="hasFeedback">
      <div class="ui-textbox__feedback-text" v-if="showError">{{ error }}</div>
      <div class="ui-textbox__feedback-text" v-else-if="showHelp">{{ args.help }}</div>
    </div>
  </div>
</template>

<script>
  import _ from 'lodash';
  import { labelProp } from '../lib/utils/references';
  import { shouldBeRequired, getValidationError } from '../lib/forms/field-helpers';
  import label from '../lib/utils/label';
  import segmentedButton from './segmented-button.vue';

  export default {
    props: ['name', 'data', 'schema', 'args'],
    data() {
      return {
        isActive: false,
        isTouched: false,
        isDisabled: false
      };
    },
    computed: {
      multiple() {
        return this.args.multiple || false;
      },
      options() {
        return _.map(this.args.options, (option) => ({
          schema: _.assign({}, this.schema, { [labelProp]: option.title }),
          args: _.assign({}, { options: option.values, multiple: this.multiple })
        }));
      },
      isRequired() {
        return _.get(this.args, 'validate.required') === true || shouldBeRequired(this.args.validate, this.$store, this.name);
      },
      label() {
        return `${label(this.name, this.schema)}${this.isRequired ? '*' : ''}`;
      },
      error() {
        return getValidationError(this.data || '', this.args.validate, this.$store, this.name);
      },
      isInvalid() {
        return !!this.error;
      },
      isSelected() {
        return !!this.data && !_.isEmpty(this.data);
      },
      hasFeedback() {
        return this.args.help || this.error;
      },
      showError() {
        return this.isInvalid && this.error;
      },
      showHelp() {
        return !this.showError && this.args.help;
      }
    },
    components: {
      'segmented-button': segmentedButton
    }
  };
</script>
