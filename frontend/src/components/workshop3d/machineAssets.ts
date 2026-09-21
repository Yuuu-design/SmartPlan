import * as THREE from 'three';
import type { MachinePhase } from './workshopSelectors';

const ACCENT_COLORS: Record<string, string> = {
  DRAWING: '#d4e7ff',
  STRANDING: '#0a84ff',
  ROPING: '#5e5ce6',
};

// 88 台机共用的材质（模块级单例，避免重复 new）
export const MAT_BODY = new THREE.MeshStandardMaterial({ color: '#dfe3e9', roughness: 0.55, metalness: 0.3 });
export const MAT_BODY_LIGHT = new THREE.MeshStandardMaterial({ color: '#eef0f4', roughness: 0.6, metalness: 0.2 });
export const MAT_DARK = new THREE.MeshStandardMaterial({ color: '#8a8f98', roughness: 0.5, metalness: 0.35 });
export const MAT_TANK = new THREE.MeshStandardMaterial({ color: '#c6ccd6', roughness: 0.4, metalness: 0.5 });
export const MAT_TRACK = new THREE.MeshStandardMaterial({ color: '#e2e4e9', roughness: 0.7, metalness: 0.1 });

const accentMatCache = new Map<string, THREE.MeshStandardMaterial>();
export function accentMaterial(processType: string): THREE.MeshStandardMaterial {
  let mat = accentMatCache.get(processType);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: ACCENT_COLORS[processType] ?? '#999',
      roughness: 0.5,
      metalness: 0.1,
    });
    accentMatCache.set(processType, mat);
  }
  return mat;
}

const lightMatCache = new Map<string, THREE.MeshStandardMaterial>();
export function statusLightMaterial(phase: MachinePhase, processType: string): THREE.MeshStandardMaterial {
  const color =
    phase === 'running'
      ? ACCENT_COLORS[processType] ?? '#0a84ff'
      : phase === 'setup'
        ? '#1c1c1e'
        : '#c7c7cc';
  let mat = lightMatCache.get(color);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.35,
      metalness: 0.1,
      emissive: new THREE.Color(color),
      emissiveIntensity: phase === 'idle' ? 0.15 : 0.55,
    });
    lightMatCache.set(color, mat);
  }
  return mat;
}

export const MAT_HOVER_RING = new THREE.MeshBasicMaterial({
  color: '#0a84ff',
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
});
export const MAT_SELECTED_RING = new THREE.MeshBasicMaterial({
  color: '#003da6',
  transparent: true,
  opacity: 0.95,
  side: THREE.DoubleSide,
});
export const MAT_DELAYED_RING = new THREE.MeshBasicMaterial({
  color: '#ff3b30',
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
});
export const MAT_IDLE_RING = new THREE.MeshBasicMaterial({
  color: '#c7c7cc',
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
});
export const RING_GEOMETRY = new THREE.RingGeometry(1.02, 1.18, 40);
export const DELAYED_RING_GEO = new THREE.RingGeometry(1.05, 1.25, 40);
export const IDLE_RING_GEO = new THREE.RingGeometry(0.95, 1.05, 40);

export const GEO = {
  boxSmall: new THREE.BoxGeometry(1, 1, 1),
  rollerX: new THREE.CylinderGeometry(0.1, 0.1, 0.55, 16),
  spoolDiscZ: new THREE.CylinderGeometry(0.24, 0.24, 0.1, 20),
  spoolBarrelZ: new THREE.CylinderGeometry(0.12, 0.12, 0.36, 16),
  tubeX: new THREE.CylinderGeometry(0.28, 0.28, 1.7, 20),
  torusRing: new THREE.TorusGeometry(0.28, 0.035, 10, 28),
  bigDiscZ: new THREE.CylinderGeometry(0.42, 0.42, 0.09, 24),
  bigBarrelZ: new THREE.CylinderGeometry(0.16, 0.16, 0.74, 20),
  lightPillar: new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10),
  lightBulb: new THREE.SphereGeometry(0.085, 16, 12),
};
