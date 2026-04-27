import type ModuleInstance from './main.js'

export type ActionsSchema = {
	set_volume: {
		options: {
			device: string
			volume: number
		}
	}
	adjust_volume: {
		options: {
			device: string
			delta: number
			multipliers: string
		}
	}
	set_mute: {
		options: {
			device: string
			state: string
		}
	}
	set_default_device: {
		options: {
			device: string
		}
	}
}

// Persists across UpdateActions calls (which re-run on every device list change).
const lastTickMs = new Map<string, number>()

/**
 * Maps the inter-tick interval to a multiplier from the user-configured curve.
 *
 * The curve is a list of multipliers ordered slow → fast, e.g. "1,2,4".
 * The velocity range is fixed: ≥ SLOW_MS = index 0, ≤ FAST_MS = last index.
 * Values between those extremes are distributed evenly across the list.
 */
function velocityMultiplier(intervalMs: number, multipliers: number[]): number {
	const SLOW_MS = 200
	const FAST_MS = 50
	if (multipliers.length === 1) return multipliers[0]
	// 0 = slowest, 1 = fastest
	const velocity = Math.max(0, Math.min(1, (SLOW_MS - intervalMs) / (SLOW_MS - FAST_MS)))
	const idx = Math.round(velocity * (multipliers.length - 1))
	return multipliers[idx]
}

function parseMultipliers(raw: string): number[] {
	const parsed = String(raw)
		.split(',')
		.map((s) => parseFloat(s.trim()))
		.filter((n) => !isNaN(n) && n > 0)
	return parsed.length > 0 ? parsed : [1]
}

function deviceChoices(self: ModuleInstance): { id: string; label: string }[] {
	const choices = Array.from(self.devices.values()).map((d) => ({ id: d.id, label: d.name }))
	if (choices.length === 0) return [{ id: '', label: '(no devices — connect sidecar first)' }]
	return choices
}

export function UpdateActions(self: ModuleInstance): void {
	const choices = deviceChoices(self)
	const defaultDevice = choices[0]?.id ?? ''

	self.setActionDefinitions({
		set_volume: {
			name: 'Set Volume',
			options: [
				{
					id: 'device',
					type: 'dropdown',
					label: 'Device',
					default: defaultDevice,
					choices,
				},
				{
					id: 'volume',
					type: 'number',
					label: 'Volume (0–100)',
					default: 50,
					min: 0,
					max: 100,
				},
			],
			callback: async (event) => {
				const { device, volume } = event.options
				if (!device) return
				self.sidecar?.sendCommand({ cmd: 'set_volume', id: device, volume: Math.round(volume) })
			},
		},

		adjust_volume: {
			name: 'Adjust Volume',
			options: [
				{
					id: 'device',
					type: 'dropdown',
					label: 'Device',
					default: defaultDevice,
					choices,
				},
				{
					id: 'delta',
					type: 'number',
					label: 'Base delta per tick (negative to decrease)',
					default: 1,
					min: -20,
					max: 20,
				},
				{
					id: 'multipliers',
					type: 'textinput',
					label: 'Speed multipliers, slow → fast (comma-separated)',
					default: '1,2,4',
					tooltip:
						'Each value is a multiplier applied to the base delta at increasing dial speeds. ' +
						'E.g. "1,2,4" means 1× when turning slowly, up to 4× when spinning fast. ' +
						'Use "1" to disable acceleration.',
				},
			],
			callback: async (event) => {
				const { device, delta, multipliers } = event.options
				if (!device) return
				const state = self.devices.get(device)
				if (!state) return

				const now = Date.now()
				const intervalMs = now - (lastTickMs.get(device) ?? 0)
				lastTickMs.set(device, now)

				const curve = parseMultipliers(String(multipliers))
				const mult = velocityMultiplier(intervalMs, curve)
				const effectiveDelta = Math.sign(delta) * Math.ceil(Math.abs(delta) * mult)

				// Optimistically update local state so rapid sequential ticks each
				// start from the already-updated value rather than stale state.
				const newVolume = Math.max(0, Math.min(100, state.volume + effectiveDelta))
				state.volume = newVolume
				self.sidecar?.sendCommand({ cmd: 'set_volume', id: device, volume: newVolume })
			},
		},

		set_mute: {
			name: 'Set Mute',
			options: [
				{
					id: 'device',
					type: 'dropdown',
					label: 'Device',
					default: defaultDevice,
					choices,
				},
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					default: 'toggle',
					choices: [
						{ id: 'mute', label: 'Mute' },
						{ id: 'unmute', label: 'Unmute' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (event) => {
				const { device, state } = event.options
				if (!device) return
				if (state === 'toggle') {
					self.sidecar?.sendCommand({ cmd: 'toggle_mute', id: device })
				} else {
					self.sidecar?.sendCommand({ cmd: 'set_mute', id: device, muted: state === 'mute' })
				}
			},
		},

		set_default_device: {
			name: 'Set Default Device',
			options: [
				{
					id: 'device',
					type: 'dropdown',
					label: 'Device',
					default: defaultDevice,
					choices,
				},
			],
			callback: async (event) => {
				const { device } = event.options
				if (!device) return
				self.sidecar?.sendCommand({ cmd: 'set_default', id: device })
			},
		},
	})
}
