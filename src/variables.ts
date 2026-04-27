import type ModuleInstance from './main.js'

export type VariablesSchema = {
	sidecar_connected: string
	device_count: string
	[key: string]: string
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const fixed = {
		sidecar_connected: { name: 'Sidecar Connected' },
		device_count: { name: 'Device Count' },
	}

	const dynamic: Record<string, { name: string }> = {}
	for (const device of self.devices.values()) {
		dynamic[`volume_${device.id}`] = { name: `Volume: ${device.name}` }
		dynamic[`muted_${device.id}`] = { name: `Muted: ${device.name}` }
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	self.setVariableDefinitions({ ...fixed, ...dynamic } as any)
}

export function BuildVariableValues(self: ModuleInstance): Record<string, string> {
	const values: Record<string, string> = {
		sidecar_connected: self.sidecar?.isConnected() ? 'true' : 'false',
		device_count: String(self.devices.size),
	}

	for (const device of self.devices.values()) {
		values[`volume_${device.id}`] = String(device.volume)
		values[`muted_${device.id}`] = String(device.muted)
	}

	return values
}
