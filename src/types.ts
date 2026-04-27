export interface DeviceState {
	id: string
	name: string
	volume: number
	muted: boolean
	isDefault: boolean
}

// Sidecar → Client messages
export type SnapshotMessage = {
	type: 'snapshot'
	devices: DeviceState[]
}

export type VolumeChangedMessage = {
	type: 'volume_changed'
	id: string
	volume: number
	muted: boolean
}

export type DeviceAddedMessage = {
	type: 'device_added'
	device: DeviceState
}

export type DeviceRemovedMessage = {
	type: 'device_removed'
	id: string
}

export type ErrorMessage = {
	type: 'error'
	message: string
}

export type SidecarMessage =
	| SnapshotMessage
	| VolumeChangedMessage
	| DeviceAddedMessage
	| DeviceRemovedMessage
	| ErrorMessage

// Client → Sidecar commands
export type SetVolumeCommand = { cmd: 'set_volume'; id: string; volume: number }
export type SetMuteCommand = { cmd: 'set_mute'; id: string; muted: boolean }
export type ToggleMuteCommand = { cmd: 'toggle_mute'; id: string }
export type SetDefaultCommand = { cmd: 'set_default'; id: string }
export type ListDevicesCommand = { cmd: 'list_devices' }

export type SidecarCommand =
	| SetVolumeCommand
	| SetMuteCommand
	| ToggleMuteCommand
	| SetDefaultCommand
	| ListDevicesCommand

export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
}
