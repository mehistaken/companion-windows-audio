import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, BuildVariableValues, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { SidecarClient } from './sidecar.js'
import type { DeviceState } from './types.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig
	devices: Map<string, DeviceState> = new Map()
	sidecar: SidecarClient | null = null

	private sidecarProcess: ChildProcess | null = null

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config
		this.devices = new Map()

		this.updateStatus(InstanceStatus.Connecting)
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.setVariableValues({ sidecar_connected: 'false', device_count: '0' })

		this.initSidecar()
	}

	async destroy(): Promise<void> {
		this.log('debug', 'destroy')
		this.sidecar?.destroy()
		this.sidecar = null
		this.killSidecarProcess()
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.sidecar?.destroy()
		this.sidecar = null
		this.killSidecarProcess()
		this.config = config
		this.devices = new Map()
		this.updateStatus(InstanceStatus.Connecting)
		this.initSidecar()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	private initSidecar(): void {
		if (this.config.autoStart) {
			this.startSidecarProcess()
		}

		this.sidecar = new SidecarClient(
			this.config.port,
			this.config.pollInterval,
			{
				onConnected: () => {
					// Waiting for snapshot before setting Ok
					this.updateStatus(InstanceStatus.Connecting)
					this.setVariableValues({ sidecar_connected: 'true' })
				},

				onSnapshot: (devices) => {
					this.devices = new Map(devices.map((d) => [d.id, d]))
					this.updateStatus(InstanceStatus.Ok)
					this.updateActions()
					this.updateFeedbacks()
					this.updatePresets()
					this.updateVariableDefinitions()
					this.setVariableValues(BuildVariableValues(this))
					this.checkFeedbacks('device_muted', 'volume_above', 'volume_below', 'is_default_device')
				},

				onVolumeChanged: (id, volume, muted) => {
					const device = this.devices.get(id)
					if (!device) return
					device.volume = volume
					device.muted = muted
					this.setVariableValues({
						[`volume_${id}`]: String(volume),
						[`muted_${id}`]: String(muted),
					})
					this.checkFeedbacks('device_muted', 'volume_above', 'volume_below')
				},

				onDeviceAdded: (device) => {
					this.devices.set(device.id, device)
					this.updateActions()
					this.updateFeedbacks()
					this.updatePresets()
					this.updateVariableDefinitions()
					this.setVariableValues(BuildVariableValues(this))
					this.checkFeedbacks('device_muted', 'volume_above', 'volume_below', 'is_default_device')
				},

				onDeviceRemoved: (id) => {
					this.devices.delete(id)
					this.updateActions()
					this.updateFeedbacks()
					this.updatePresets()
					this.updateVariableDefinitions()
					this.setVariableValues(BuildVariableValues(this))
					this.checkFeedbacks('device_muted', 'volume_above', 'volume_below', 'is_default_device')
				},

				onDisconnected: () => {
					this.updateStatus(InstanceStatus.ConnectionFailure)
					this.setVariableValues({ sidecar_connected: 'false' })
				},
			},
			(level, msg) => this.log(level, msg),
		)

		this.sidecar.connect()
	}

	private startSidecarProcess(): void {
		const moduleDir = path.dirname(fileURLToPath(import.meta.url))
		const exePath = path.resolve(moduleDir, '..', 'resources', 'AudioSidecar.exe')

		if (!fs.existsSync(exePath)) {
			this.log(
				'error',
				`AudioSidecar.exe not found at ${exePath}. Build it with: cd AudioSidecar && dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o ../resources/`,
			)
			return
		}

		this.log('info', `Spawning AudioSidecar on port ${this.config.port}`)
		let proc: ReturnType<typeof spawn>
		try {
			proc = spawn(exePath, ['--port', String(this.config.port)], {
				detached: false,
				stdio: ['ignore', 'pipe', 'pipe'],
			})
		} catch (err: unknown) {
			// Node.js Permission Model blocks child_process.spawn() inside Companion's sandbox.
			// Fall through to manual-sidecar mode — connect will still work if the user
			// starts AudioSidecar.exe externally before enabling this connection.
			const code = (err as NodeJS.ErrnoException).code
			if (code === 'ERR_ACCESS_DENIED') {
				this.log(
					'warn',
					'Companion sandbox blocked auto-start (ERR_ACCESS_DENIED). ' +
						'Start AudioSidecar.exe manually or add it to Windows startup. ' +
						'The module will connect once the sidecar is running.',
				)
			} else {
				this.log('error', `Failed to spawn AudioSidecar: ${String(err)}`)
			}
			return
		}

		proc.stdout?.on('data', (data: Buffer) => {
			this.log('debug', `[sidecar] ${data.toString('utf8').trim()}`)
		})

		proc.stderr?.on('data', (data: Buffer) => {
			this.log('warn', `[sidecar] ${data.toString('utf8').trim()}`)
		})

		proc.on('exit', (code) => {
			this.log('info', `AudioSidecar exited with code ${code ?? 'null'}`)
			this.sidecarProcess = null
		})

		proc.on('error', (err) => {
			this.log('error', `Failed to spawn AudioSidecar: ${err.message}`)
		})

		this.sidecarProcess = proc
	}

	private killSidecarProcess(): void {
		if (this.sidecarProcess) {
			this.sidecarProcess.kill()
			this.sidecarProcess = null
		}
	}
}
