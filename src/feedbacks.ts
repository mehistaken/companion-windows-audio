import type ModuleInstance from './main.js'

export type FeedbacksSchema = {
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
