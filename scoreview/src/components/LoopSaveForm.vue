<!--
	Saving the running loop (B5): a name and whom it is for. A loop is kept
	as a note with an end measure (lib/Db/Annotation KIND_LOOP), so the
	audience is the one notes have - private, shared, or for voices, the
	last only for leaders. Inline below the loop fields rather than a modal:
	on a music stand a modal over the score is one tap too many.
-->
<template>
	<form class="scoreview-loop-save" @submit.prevent="save">
		<NcTextField
			v-model="name"
			:label="t('Name of the loop')"
			:placeholder="t('Measures {from}–{to}', { from, to })"
			:maxlength="120" />
		<fieldset class="scoreview-popover-group">
			<legend>{{ t('For') }}</legend>
			<div class="scoreview-loop-save-audience">
				<NcButton :pressed="audience === 'private'" :aria-label="t('Private')" @click="audience = 'private'">
					<template #icon>
						<LockOutline :size="20" />
					</template>
					{{ t('Private') }}
				</NcButton>
				<NcButton
					:pressed="audience === 'shared'"
					:aria-label="t('Shared with everyone who has access to this file')"
					:title="t('Shared with everyone who has access to this file')"
					@click="audience = 'shared'">
					<template #icon>
						<AccountGroup :size="20" />
					</template>
					{{ t('Shared') }}
				</NcButton>
				<NcButton
					v-if="isLeader && parts.length > 0"
					:pressed="audience === 'parts'"
					:aria-label="t('Voices')"
					:title="t('Only singers of the chosen voices see it')"
					@click="audience = 'parts'">
					<template #icon>
						<AccountMusic :size="20" />
					</template>
					{{ t('Voices') }}
				</NcButton>
			</div>
			<div v-if="audience === 'parts'" class="scoreview-loop-save-voices">
				<NcCheckboxRadioSwitch
					v-for="part in parts"
					:key="part.id"
					:modelValue="targetIds.includes(String(part.id))"
					type="checkbox"
					@update:modelValue="toggleTarget(part)">
					{{ part.name }}
				</NcCheckboxRadioSwitch>
				<p v-if="targetIds.length === 0" class="scoreview-popover-hint">
					{{ t('Choose at least one voice.') }}
				</p>
			</div>
		</fieldset>
		<NcNoteCard v-if="error" type="error">
			{{ error }}
		</NcNoteCard>
		<div class="scoreview-loop-save-actions">
			<NcButton variant="primary" type="submit" :disabled="!complete">
				<template #icon>
					<Check :size="20" />
				</template>
				{{ t('Save') }}
			</NcButton>
			<NcButton :aria-label="t('Cancel')" @click="$emit('cancel')">
				<template #icon>
					<Close :size="20" />
				</template>
				{{ t('Cancel') }}
			</NcButton>
		</div>
	</form>
</template>

<script>
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import AccountGroup from 'vue-material-design-icons/AccountGroup.vue'
import AccountMusic from 'vue-material-design-icons/AccountMusic.vue'
import Check from 'vue-material-design-icons/Check.vue'
import Close from 'vue-material-design-icons/Close.vue'
import LockOutline from 'vue-material-design-icons/LockOutline.vue'
import { translate } from '../l10n.js'

export default {
	name: 'LoopSaveForm',

	components: {
		AccountGroup,
		AccountMusic,
		Check,
		Close,
		LockOutline,
		NcButton,
		NcCheckboxRadioSwitch,
		NcNoteCard,
		NcTextField,
	},

	props: {
		from: {
			type: Number,
			required: true,
		},

		to: {
			type: Number,
			required: true,
		},

		// Display aid for "Voices"; the role is enforced on the server (E9).
		isLeader: {
			type: Boolean,
			default: false,
		},

		// meta.parts - the voices a leader can address.
		parts: {
			type: Array,
			default: () => [],
		},

		// The server's answer to the last save, if it refused.
		error: {
			type: String,
			default: '',
		},
	},

	emits: ['save', 'cancel'],

	data() {
		return {
			name: '',
			// 'private' | 'shared' | 'parts'
			audience: 'private',
			targetIds: [],
		}
	},

	computed: {
		complete() {
			return this.audience !== 'parts' || this.targetIds.length > 0
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		toggleTarget(part) {
			const id = String(part.id)
			this.targetIds = this.targetIds.includes(id) ? this.targetIds.filter((x) => x !== id) : [...this.targetIds, id]
		},

		save() {
			if (!this.complete) {
				return
			}
			this.$emit('save', {
				name: this.name.trim(),
				visibility: this.audience,
				targetParts: this.audience === 'parts'
					? this.parts.filter((p) => this.targetIds.includes(String(p.id))).map((p) => ({ id: String(p.id), name: p.name }))
					: null,
			})
		},
	},
}
</script>

<style scoped src="./scoreviewPopover.css"></style>

<style scoped>
.scoreview-loop-save {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.scoreview-loop-save-audience,
.scoreview-loop-save-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.scoreview-loop-save-voices {
	margin-block-start: 4px;
}
</style>
