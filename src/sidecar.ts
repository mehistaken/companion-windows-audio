import net from 'net'
import type { DeviceState, SidecarCommand, SidecarMessage } from './types.js'

export interface SidecarEventHandlers {
	onConnected: () => void
	onDisconnected: () => void
	onSnapshot: (devices: DeviceState[]) => void
	onVolumeChanged: (id: string, volume: number, muted: boolean) => void
	onDeviceAdded: (device: DeviceState) => void
	onDeviceRemoved: (id: string) => void
}

export class SidecarClient {
	private socket: net.Socket | null = null
	private lineBuffer = ''
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private connected = false
	private destroyed = false

	constructor(
		private readonly port: number,
		private readonly pollInterval: number,
		private readonly handlers: SidecarEventHandlers,
		private readonly log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void,
	) {}

	connect(): void {
		if (this.destroyed) return

		const socket = new net.Socket()
		this.socket = socket

		socket.on('connect', () => {
			this.connected = true
			this.lineBuffer = ''
			this.log('debug', 'Connected to AudioSidecar')
			this.handlers.onConnected()
		})

		socket.on('data', (data: Buffer) => {
			this.lineBuffer += data.toString('utf8')
			const lines = this.lineBuffer.split('\n')
			// Last element may be incomplete; keep it in the buffer
			this.lineBuffer = lines.pop() ?? ''
			for (const line of lines) {
				const trimmed = line.trim()
				if (trimmed) this.parseLine(trimmed)
			}
		})

		socket.on('close', () => {
			this.connected = false
			this.socket = null
			this.log('debug', 'Disconnected from AudioSidecar')
			this.handlers.onDisconnected()
			this.scheduleReconnect()
		})

		socket.on('error', (err) => {
			// Error is always followed by close; just log it
			this.log('debug', `Sidecar socket error: ${err.message}`)
		})

		socket.connect(this.port, '127.0.0.1')
	}

	private parseLine(line: string): void {
		let msg: SidecarMessage
		try {
			msg = JSON.parse(line) as SidecarMessage
		} catch {
			this.log('warn', `Unparseable sidecar message: ${line}`)
			return
		}

		switch (msg.type) {
			case 'snapshot':
				this.handlers.onSnapshot(msg.devices)
				break
			case 'volume_changed':
				this.handlers.onVolumeChanged(msg.id, msg.volume, msg.muted)
				break
			case 'device_added':
				this.handlers.onDeviceAdded(msg.device)
				break
			case 'device_removed':
				this.handlers.onDeviceRemoved(msg.id)
				break
			case 'error':
				this.log('warn', `Sidecar error: ${msg.message}`)
				break
		}
	}

	sendCommand(cmd: SidecarCommand): void {
		if (!this.socket || !this.connected) {
			this.log('debug', `Dropping command (not connected): ${cmd.cmd}`)
			return
		}
		try {
			this.socket.write(JSON.stringify(cmd) + '\n', 'utf8')
		} catch (err) {
			this.log('warn', `Failed to send command: ${String(err)}`)
		}
	}

	private scheduleReconnect(): void {
		if (this.destroyed) return
		this.reconnectTimer = setTimeout(() => {
			if (!this.destroyed) this.connect()
		}, this.pollInterval)
	}

	destroy(): void {
		this.destroyed = true
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		if (this.socket) {
			this.socket.destroy()
			this.socket = null
		}
		this.connected = false
	}

	isConnected(): boolean {
		return this.connected
	}
}
