import type ModuleInstance from './main.js'
import { levelToPercent } from './level.js'

export type FeedbacksSchema = {
	peak_level: {
		type: 'value'
		options: {
			device: string
			channel: string
			scale: string
			dbFloor: number
			dbCeiling: number
		}
	}
	device_muted: {
		type: 'boolean'
		options: {
			device: string
		}
	}
	volume_above: {
		type: 'boolean'
		options: {
			device: string
			threshold: number
		}
	}
	volume_below: {
		type: 'boolean'
		options: {
			device: string
			threshold: number
		}
	}
	is_default_device: {
		type: 'boolean'
		options: {
			device: string
		}
	}
}

function deviceChoices(self: ModuleInstance): { id: string; label: string }[] {
	const choices = Array.from(self.devices.values()).map((d) => ({ id: d.id, label: d.name }))
	if (choices.length === 0) return [{ id: '', label: '(no devices)' }]
	return choices
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	const choices = deviceChoices(self)
	const defaultDevice = choices[0]?.id ?? ''

	self.setFeedbackDefinitions({
		peak_level: {
			name: 'Peak Level',
			description:
				"Live output level of a device as 0–100. Use it to drive a Gauge element: set the gauge's Value to $(this:value).",
			type: 'value',
			options: [
				{ id: 'device', type: 'dropdown', label: 'Device', default: defaultDevice, choices },
				{
					id: 'channel',
					type: 'dropdown',
					label: 'Channel',
					default: 'max',
					choices: [
						{ id: 'max', label: 'Loudest of L/R' },
						{ id: 'left', label: 'Left' },
						{ id: 'right', label: 'Right' },
					],
				},
				{
					id: 'scale',
					type: 'dropdown',
					label: 'Scale',
					default: 'db',
					choices: [
						{ id: 'db', label: 'dB' },
						{ id: 'linear', label: 'Linear' },
					],
				},
				{
					id: 'dbFloor',
					type: 'number',
					label: 'Floor (dB)',
					tooltip:
						'Level that reads 0. Anything quieter reads 0. Raise it (e.g. -40) to ignore faint background signal.',
					default: -60,
					min: -90,
					max: -6,
					isVisibleExpression: `$(options:scale) == 'db'`,
				},
				{
					id: 'dbCeiling',
					type: 'number',
					label: 'Ceiling (dB)',
					tooltip:
						'Level that reads 100. Anything louder reads 100. Lower it (e.g. -10) so quieter sources fill the gauge.',
					default: 0,
					min: -84,
					max: 0,
					isVisibleExpression: `$(options:scale) == 'db'`,
				},
			],
			callback: (feedback) => {
				self.meterFeedbacks.add(feedback.id)
				self.updateMeterSubscription()

				const o = feedback.options
				const [left, right] = self.levels.get(o.device) ?? [0, 0]
				const peak = o.channel === 'left' ? left : o.channel === 'right' ? right : Math.max(left, right)
				return levelToPercent(peak, o.scale !== 'linear', Number(o.dbFloor ?? -60), Number(o.dbCeiling ?? 0))
			},
			unsubscribe: (feedback) => {
				self.meterFeedbacks.delete(feedback.id)
				self.updateMeterSubscription()
			},
		},

		device_muted: {
			name: 'Device is Muted',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0xff0000,
				color: 0xffffff,
			},
			options: [
				{
					id: 'device',
					type: 'dropdown',
					label: 'Device',
					default: defaultDevice,
					choices,
				},
			],
			callback: (feedback) => {
				const device = self.devices.get(feedback.options.device)
				return device?.muted ?? false
			},
		},

		volume_above: {
			name: 'Volume Above Threshold',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x00aa00,
				color: 0xffffff,
			},
			options: [
				{
					id: 'device',
					type: 'dropdown',
					label: 'Device',
					default: defaultDevice,
					choices,
				},
				{
					id: 'threshold',
					type: 'number',
					label: 'Threshold (0–100)',
					default: 50,
					min: 0,
					max: 100,
				},
			],
			callback: (feedback) => {
				const device = self.devices.get(feedback.options.device)
				if (!device) return false
				return device.volume >= feedback.options.threshold
			},
		},

		volume_below: {
			name: 'Volume Below Threshold',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0xffaa00,
				color: 0x000000,
			},
			options: [
				{
					id: 'device',
					type: 'dropdown',
					label: 'Device',
					default: defaultDevice,
					choices,
				},
				{
					id: 'threshold',
					type: 'number',
					label: 'Threshold (0–100)',
					default: 50,
					min: 0,
					max: 100,
				},
			],
			callback: (feedback) => {
				const device = self.devices.get(feedback.options.device)
				if (!device) return false
				return device.volume <= feedback.options.threshold
			},
		},

		is_default_device: {
			name: 'Is Default Device',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x0055ff,
				color: 0xffffff,
			},
			options: [
				{
					id: 'device',
					type: 'dropdown',
					label: 'Device',
					default: defaultDevice,
					choices,
				},
			],
			callback: (feedback) => {
				const device = self.devices.get(feedback.options.device)
				return device?.isDefault ?? false
			},
		},
	})
}
