import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'

export function UpdatePresets(self: ModuleInstance): void {
	const structure: CompanionPresetSection[] = []
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}

	for (const device of self.devices.values()) {
		const upId = `vol_up_${device.id}`
		const downId = `vol_down_${device.id}`
		const muteId = `toggle_mute_${device.id}`

		structure.push({
			id: `device_${device.id}`,
			name: device.name,
			definitions: [
				{
					id: `group_${device.id}`,
					name: 'Controls',
					type: 'simple',
					presets: [upId, downId, muteId],
				},
			],
		})

		presets[upId] = {
			type: 'simple',
			name: `Vol Up — ${device.name}`,
			style: {
				text: `▲ Vol\n${device.name}`,
				size: 'auto',
				color: 0xffffff,
				bgcolor: 0x004400,
				show_topbar: false,
			},
			steps: [
				{
					down: [
						{
							actionId: 'adjust_volume',
							options: { device: device.id, delta: 1, multipliers: '1,2,4' },
						},
					],
					up: [],
				},
			],
			feedbacks: [],
		}

		presets[downId] = {
			type: 'simple',
			name: `Vol Down — ${device.name}`,
			style: {
				text: `▼ Vol\n${device.name}`,
				size: 'auto',
				color: 0xffffff,
				bgcolor: 0x440000,
				show_topbar: false,
			},
			steps: [
				{
					down: [
						{
							actionId: 'adjust_volume',
							options: { device: device.id, delta: -1, multipliers: '1,2,4' },
						},
					],
					up: [],
				},
			],
			feedbacks: [],
		}

		presets[muteId] = {
			type: 'simple',
			name: `Toggle Mute — ${device.name}`,
			style: {
				text: `🔇 Mute\n${device.name}`,
				size: 'auto',
				color: 0xffffff,
				bgcolor: 0x222222,
				show_topbar: false,
			},
			steps: [
				{
					down: [
						{
							actionId: 'set_mute',
							options: { device: device.id, state: 'toggle' },
						},
					],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'device_muted',
					options: { device: device.id },
					style: {
						bgcolor: 0xff0000,
						color: 0xffffff,
					},
				},
			],
		}
	}

	// Show placeholder section when no devices are connected
	if (self.devices.size === 0) {
		structure.push({
			id: 'no_devices',
			name: 'No Devices',
			definitions: [
				{
					id: 'no_devices_group',
					name: 'Connect the sidecar to populate presets',
					type: 'simple',
					presets: [],
				},
			],
		})
	}

	self.setPresetDefinitions(structure, presets)
}
