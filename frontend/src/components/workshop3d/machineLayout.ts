import type { Machine, ProcessType } from '../../types/schedule';
import { PROCESS_ORDER } from '../../types/schedule';

export const CELL_W = 2.6;
export const CELL_D = 2.6;
const PAD_W = 1.6;
const PAD_D = 1.4;

export interface ZoneConfig {
  processType: ProcessType;
  x: number;
  cols: number;
  color: string;
  label: string;
}

export const ZONE_CONFIGS: Record<ProcessType, ZoneConfig> = {
  DRAWING:   { processType: 'DRAWING',   x: -22, cols: 7, color: '#d4e7ff', label: '拉丝区 Drawing' },
  STRANDING: { processType: 'STRANDING', x: 0,    cols: 8, color: '#0a84ff', label: '捻股区 Stranding' },
  ROPING:    { processType: 'ROPING',    x: 22,   cols: 5, color: '#5e5ce6', label: '合绳区 Roping' },
};

export interface PositionedMachine {
  machine: Machine;
  position: [number, number, number];
  zone: ZoneConfig;
}

export interface ZoneLayout extends ZoneConfig {
  width: number;
  depth: number;
  rows: number;
  machineIds: string[];
}

export const PLATFORM_TOP_Y = 0.4;

export interface MachineLayout {
  zones: ZoneLayout[];
  positioned: PositionedMachine[];
  positionById: Map<string, [number, number, number]>;
}

export function layoutMachines(machines: Machine[]): MachineLayout {
  const byProcess = new Map<ProcessType, Machine[]>();
  for (const pt of PROCESS_ORDER) byProcess.set(pt, []);
  for (const m of machines) {
    byProcess.get(m.process_type)?.push(m);
  }

  const zones: ZoneLayout[] = [];
  const positioned: PositionedMachine[] = [];
  const positionById = new Map<string, [number, number, number]>();

  for (const pt of PROCESS_ORDER) {
    const cfg = ZONE_CONFIGS[pt];
    const list = byProcess.get(pt) ?? [];
    const cols = cfg.cols;
    const rows = Math.max(1, Math.ceil(list.length / cols));

    for (let i = 0; i < list.length; i += 1) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = cfg.x + (col - (cols - 1) / 2) * CELL_W;
      const z = (row - (rows - 1) / 2) * CELL_D;
      const pos: [number, number, number] = [x, PLATFORM_TOP_Y, z];
      positioned.push({ machine: list[i], position: pos, zone: cfg });
      positionById.set(list[i].machine_id, pos);
    }

    zones.push({
      ...cfg,
      width: cols * CELL_W + PAD_W * 2,
      depth: rows * CELL_D + PAD_D * 2,
      rows,
      machineIds: list.map((m) => m.machine_id),
    });
  }

  return { zones, positioned, positionById };
}
