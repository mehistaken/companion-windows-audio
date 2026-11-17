/**
 * Converts a linear peak level (0.0–1.0) to a 0–100 meter position.
 *
 * dB scale: dbFloor maps to 0 and dbCeiling to 100; anything quieter than the floor
 * reads 0 and anything louder than the ceiling reads 100. At least 6 dB of range
 * is enforced so the scale can't collapse or invert.
 */
export function levelToPercent(peak: number, db: boolean, dbFloor: number, dbCeiling: number): number {
	if (!(peak > 0)) return 0
	if (!db) return Math.round(Math.min(1, peak) * 100)

	const ceiling = Math.max(-84, Math.min(0, dbCeiling))
	const floor = Math.max(-90, Math.min(ceiling - 6, dbFloor))
	const value = 20 * Math.log10(peak)
	const pos = (value - floor) / (ceiling - floor)
	return Math.round(Math.max(0, Math.min(1, pos)) * 100)
}
