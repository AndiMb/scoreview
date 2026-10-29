<template>
	<!--
		A switch in a tool group (ToolGroup.vue), with the pin next to it
		(E23) - like ToolRow, for the tools that are flipped rather than
		opened.
	-->
	<div class="scoreview-tool-switch">
		<NcCheckboxRadioSwitch
			class="scoreview-tool-switch-control"
			:modelValue="modelValue"
			type="switch"
			@update:modelValue="$emit('update:modelValue', $event)">
			{{ label }}
		</NcCheckboxRadioSwitch>
		<ToolPin
			v-if="pinnable"
			:label="label"
			:pinned="pinned"
			:disabled="pinDisabled"
			@pin="$emit('pin')" />
	</div>
</template>

<script>
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import ToolPin from './ToolPin.vue'

export default {
	name: 'ToolSwitch',

	components: {
		NcCheckboxRadioSwitch,
		ToolPin,
	},

	props: {
		label: {
			type: String,
			required: true,
		},

		modelValue: {
			type: Boolean,
			required: true,
		},

		pinnable: {
			type: Boolean,
			default: false,
		},

		pinned: {
			type: Boolean,
			default: false,
		},

		pinDisabled: {
			type: Boolean,
			default: false,
		},
	},

	emits: ['update:modelValue', 'pin'],
}
</script>

<style scoped>
.scoreview-tool-switch {
	display: flex;
	align-items: center;
	gap: 2px;
}

.scoreview-tool-switch-control {
	flex: 1 1 auto;
	min-inline-size: 0;
}
</style>
