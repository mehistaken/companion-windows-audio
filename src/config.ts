import { type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	port: number
	autoStart: boolean
	pollInterval: number
	meterFps: number
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'number',
			id: 'port',
			label: 'Sidecar Port',
			width: 4,
			min: 1,
			max: 65535,
			default: 37891,
		},
		{
			type: 'checkbox',
			id: 'autoStart',
			label: 'Auto-start Sidecar — blocked by Companion sandbox, start AudioSidecar.exe manually',
			width: 8,
			default: false,
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Reconnect retry ms',
			width: 4,
			min: 500,
			max: 30000,
			default: 2000,
		},
		{
			type: 'number',
			id: 'meterFps',
			label: 'Peak level refresh rate (updates/sec)',
			tooltip:
				'Only used while a Peak Level feedback is on a button. Higher values look smoother but load Companion more.',
			width: 4,
			min: 5,
			max: 30,
			default: 15,
		},
	]
}
