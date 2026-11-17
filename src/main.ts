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

	/** Smoothed peak levels per device, [left, right] linear 0–1 */
	levels: Map<string, [number, number]> = new Map()
	/** Ids of Peak Level feedback instances currently on buttons */
	meterFeedbacks: Set<string> = new Set()

	private meterSubscribed = false
	private lastLevelsAt = 0
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

	/**
	 * Ask the sidecar to stream levels only while at least one Peak Level
	 * feedback is in use, so idle setups cost nothing.
	 */
	updateMeterSubscription(): void {
		const want = this.meterFeedbacks.size > 0 && (this.sidecar?.isConnected() ?? false)
		if (want === this.meterSubscribed) return
		this.meterSubscribed = want
		if (want) {
			const fps = Math.max(5, Math.min(30, Number(this.config.meterFps) || 15))
			this.sidecar?.sendCommand({ cmd: 'meter', enabled: true, interval: Math.round(1000 / fps) })
		} else {
			this.sidecar?.sendCommand({ cmd: 'meter', enabled: false })
			this.levels.clear()
		}
	}

	private handleLevels(levels: Record<string, [number, number]>): void {
		const now = Date.now()
		const dt = this.lastLevelsAt ? Math.min(500, now - this.lastLevelsAt) : 66
		this.lastLevelsAt = now
		// Peak fall-off: ~0.8x per 66ms frame (≈ 30 dB/s), independent of refresh rate
		const decay = Math.pow(0.8, dt / 66)

		let changed = false
		for (const [id, [l, r]] of Object.entries(levels)) {
			const prev = this.levels.get(id) ?? [0, 0]
			const next: [number, number] = [Math.max(l, prev[0] * decay), Math.max(r, prev[1] * decay)]
			if (next[0] < 0.001) next[0] = 0
			if (next[1] < 0.001) next[1] = 0
			if (Math.abs(next[0] - prev[0]) > 0.002 || Math.abs(next[1] - prev[1]) > 0.002) changed = true
			this.levels.set(id, next)
		}

		// Skip redraws when nothing moved (e.g. silence)
		if (changed) this.checkFeedbacks('peak_level')
	}

	private initSidecar(): void {
		this.meterSubscribed = false
		this.levels.clear()

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
					// New socket: sidecar has no subscription for us yet
					this.meterSubscribed = false
					this.updateMeterSubscription()
				},

				onLevels: (levels) => this.handleLevels(levels),

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
					this.meterSubscribed = false
					if (this.levels.size > 0) {
						this.levels.clear()
						this.checkFeedbacks('peak_level')
					}
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
