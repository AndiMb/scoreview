<script>
/**
 * Rendert seinen Slot mit einem Wert, den erst DIESE Komponente liest.
 *
 * Wozu: Die Wiedergabezeit ändert sich mit jedem Frame. Liest der Viewer
 * sie in seinem eigenen Template, rendert er in jedem Frame ganz neu - samt
 * aller Seiten, Leisten und Panels. Hier gelesen, hängt nur dieser kleine
 * Teilbaum an der Zeit. Der Slot bleibt im Template des Viewers, damit
 * dessen scoped Styles weiter greifen (Slotinhalt trägt die Scope-ID des
 * Elternteils, der Inhalt einer Kindkomponente nicht).
 *
 * Verwendung: `<LiveValue v-slot="{ value }" :get="() => zeit">…</LiveValue>`
 */
export default {
	name: 'LiveValue',

	props: {
		get: {
			type: Function,
			required: true,
		},
	},

	render() {
		return this.$slots.default?.({ value: this.get() })
	},
}
</script>
