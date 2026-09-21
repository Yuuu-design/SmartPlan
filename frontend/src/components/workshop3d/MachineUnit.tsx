import { useRef, useState, type ReactNode } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Machine } from '../../types/schedule';
import type { MachinePhase } from './workshopSelectors';
import {
  DELAYED_RING_GEO,
  GEO,
  MAT_BODY,
  MAT_BODY_LIGHT,
  MAT_DARK,
  MAT_DELAYED_RING,
  MAT_HOVER_RING,
  MAT_IDLE_RING,
  MAT_SELECTED_RING,
  MAT_TANK,
  MAT_TRACK,
  RING_GEOMETRY,
  IDLE_RING_GEO,
  accentMaterial,
  statusLightMaterial,
} from './machineAssets';

const ROTOR_SPEED = 2.6;

function Spinner({
  axis,
  active,
  position,
  children,
}: {
  axis: 'x' | 'y' | 'z';
  active: boolean;
  position?: [number, number, number];
  children: ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (active && ref.current) ref.current.rotation[axis] += delta * ROTOR_SPEED;
  });
  return (
    <group ref={ref} position={position}>
      {children}
    </group>
  );
}

function Pulsar({ active, children }: { active: boolean; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const s = active ? 1 + 0.32 * Math.sin(clock.elapsedTime * 7) : 1;
    ref.current.scale.setScalar(s);
  });
  return <group ref={ref}>{children}</group>;
}

interface MeshPartProps {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
  shadow?: boolean;
}

function Part({ geo, mat, pos, rot, scale, shadow = true }: MeshPartProps) {
  return (
    <mesh
      geometry={geo}
      material={mat}
      position={pos}
      rotation={rot}
      scale={scale}
      castShadow={shadow}
      receiveShadow={false}
    />
  );
}

function StatusLight({ y, phase, processType }: { y: number; phase: MachinePhase; processType: string }) {
  return (
    <group position={[0, y, 0]}>
      <Part geo={GEO.lightPillar} mat={MAT_DARK} pos={[0, 0.11, 0]} shadow={false} />
      <Pulsar active={phase === 'setup'}>
        <group position={[0, 0.28, 0]}>
          <Part geo={GEO.lightBulb} mat={statusLightMaterial(phase, processType)} shadow={false} />
        </group>
      </Pulsar>
    </group>
  );
}

function ProgressBar({ phase, progress, processType }: { phase: MachinePhase; progress: number; processType: string }) {
  if (phase === 'idle') return null;
  const width = 1.3;
  const p = Math.min(1, Math.max(0, progress));
  return (
    <group position={[0, 0.045, 1.02]}>
      <Part geo={GEO.boxSmall} mat={MAT_TRACK} scale={[width, 0.07, 0.13]} shadow={false} />
      <Part
        geo={GEO.boxSmall}
        mat={phase === 'setup' ? MAT_DARK : accentMaterial(processType)}
        pos={[-(width * (1 - p)) / 2, 0.008, 0]}
        scale={[Math.max(p, 0.004) * width, 0.085, 0.14]}
        shadow={false}
      />
    </group>
  );
}

const PHASE_TEXT: Record<MachinePhase, string> = {
  running: '运行',
  setup: '换型',
  idle: '待机',
};

function DelayedRing() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const s = 1 + 0.06 * Math.sin(clock.elapsedTime * 4);
      ref.current.scale.setScalar(s);
    }
  });
  return (
    <group ref={ref}>
      <mesh
        geometry={DELAYED_RING_GEO}
        material={MAT_DELAYED_RING}
        position={[0, 0.015, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      />
    </group>
  );
}

function IdleRing() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const s = 1 + 0.04 * Math.sin(clock.elapsedTime * 2.5);
      ref.current.scale.setScalar(s);
    }
  });
  return (
    <group ref={ref}>
      <mesh
        geometry={IDLE_RING_GEO}
        material={MAT_IDLE_RING}
        position={[0, 0.012, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      />
    </group>
  );
}

function DrawingMachine({ processType, phase }: { processType: string; phase: MachinePhase }) {
  const accent = accentMaterial(processType);
  return (
    <group>
      <Part geo={GEO.boxSmall} mat={MAT_TANK} pos={[0, 0.24, 0]} scale={[1.9, 0.48, 1.25]} />
      <Part geo={GEO.boxSmall} mat={MAT_BODY_LIGHT} pos={[0, 0.52, 0]} scale={[1.7, 0.08, 1.0]} shadow={false} />
      {[-0.55, 0, 0.55].map((x) => (
        <group key={x} position={[x, 0.66, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <Spinner axis="y" active={phase === 'running'}>
            <Part geo={GEO.rollerX} mat={MAT_DARK} />
          </Spinner>
        </group>
      ))}
      <group position={[0.62, 0.34, 0.5]} rotation={[Math.PI / 2, 0, 0]}>
        <Spinner axis="y" active={phase === 'running'}>
          <Part geo={GEO.spoolBarrelZ} mat={MAT_DARK} shadow={false} />
          <Part geo={GEO.spoolDiscZ} mat={MAT_BODY} pos={[0, 0.2, 0]} shadow={false} />
          <Part geo={GEO.spoolDiscZ} mat={MAT_BODY} pos={[0, -0.2, 0]} shadow={false} />
        </Spinner>
      </group>
      <Part geo={GEO.boxSmall} mat={accent} pos={[0, 0.24, 0.64]} scale={[1.5, 0.07, 0.04]} shadow={false} />
      <StatusLight y={0.75} phase={phase} processType={processType} />
    </group>
  );
}

function StrandingMachine({ processType, phase }: { processType: string; phase: MachinePhase }) {
  const accent = accentMaterial(processType);
  return (
    <group>
      <Part geo={GEO.boxSmall} mat={MAT_BODY_LIGHT} pos={[0, 0.08, 0]} scale={[1.8, 0.16, 1.0]} />
      <Part geo={GEO.boxSmall} mat={MAT_BODY} pos={[-0.72, 0.42, 0]} scale={[0.18, 0.62, 1.05]} />
      <Part geo={GEO.boxSmall} mat={MAT_BODY} pos={[0.72, 0.42, 0]} scale={[0.18, 0.62, 1.05]} />
      <Spinner axis="x" active={phase === 'running'} position={[0, 0.72, 0]}>
        <Part geo={GEO.tubeX} mat={MAT_DARK} rot={[0, 0, Math.PI / 2]} />
        <Part geo={GEO.torusRing} mat={accent} pos={[-0.45, 0, 0]} rot={[0, Math.PI / 2, 0]} shadow={false} />
        <Part geo={GEO.torusRing} mat={accent} pos={[0.45, 0, 0]} rot={[0, Math.PI / 2, 0]} shadow={false} />
      </Spinner>
      <Part geo={GEO.boxSmall} mat={MAT_DARK} pos={[-0.4, 0.22, 0.35]} scale={[0.42, 0.2, 0.28]} shadow={false} />
      <StatusLight y={1.02} phase={phase} processType={processType} />
    </group>
  );
}

function RopingMachine({ processType, phase }: { processType: string; phase: MachinePhase }) {
  const accent = accentMaterial(processType);
  return (
    <group>
      <Part geo={GEO.boxSmall} mat={MAT_BODY_LIGHT} pos={[0, 0.12, 0]} scale={[1.7, 0.24, 1.05]} />
      <Part geo={GEO.boxSmall} mat={MAT_BODY} pos={[-0.58, 0.55, 0.12]} scale={[0.12, 0.82, 0.12]} />
      <Part geo={GEO.boxSmall} mat={MAT_BODY} pos={[0.58, 0.55, 0.12]} scale={[0.12, 0.82, 0.12]} />
      <group position={[0, 0.72, 0.12]} rotation={[Math.PI / 2, 0, 0]}>
        <Spinner axis="y" active={phase === 'running'}>
          <Part geo={GEO.bigBarrelZ} mat={MAT_DARK} />
          <Part geo={GEO.bigDiscZ} mat={MAT_BODY} pos={[0, 0.4, 0]} />
          <Part geo={GEO.bigDiscZ} mat={MAT_BODY} pos={[0, -0.4, 0]} />
          <Part geo={GEO.torusRing} mat={accent} pos={[0, 0, 0]} rot={[Math.PI / 2, 0, 0]} scale={[1.35, 1.35, 1.35]} shadow={false} />
        </Spinner>
      </group>
      <Part geo={GEO.boxSmall} mat={MAT_DARK} pos={[0, 0.46, -0.42]} scale={[1.3, 0.06, 0.08]} shadow={false} />
      <Part geo={GEO.boxSmall} mat={accent} pos={[0.3, 0.46, -0.42]} scale={[0.22, 0.12, 0.16]} shadow={false} />
      <StatusLight y={1.05} phase={phase} processType={processType} />
    </group>
  );
}

interface MachineUnitProps {
  machine: Machine;
  position: [number, number, number];
  phase: MachinePhase;
  progress: number;
  selected: boolean;
  delayed: boolean;
  onSelect: (machineId: string) => void;
}

export function MachineUnit({ machine, position, phase, progress, selected, delayed, onSelect }: MachineUnitProps) {
  const [hovered, setHovered] = useState(false);
  const active = hovered || selected;
  const { process_type: pt } = machine;
  const idle = phase === 'idle';
  const rootRef = useRef<THREE.Group>(null);

  // 待机时降整体透明度（用 mesh material 实现，因为 <group> 本身不支持 opacity）
  useFrame(() => {
    if (!rootRef.current) return;
    const targetOpacity = idle && !active ? 0.55 : 1;
    rootRef.current.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
        mesh.material.transparent = true;
        if (Math.abs(mesh.material.opacity - targetOpacity) > 0.01) {
          mesh.material.opacity = targetOpacity;
        }
      }
    });
  });

  const handleOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    document.body.style.cursor = 'pointer';
  };
  const handleOut = () => {
    setHovered(false);
    document.body.style.cursor = '';
  };
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(machine.machine_id);
  };

  return (
    <group
      ref={rootRef}
      position={position}
      scale={1.12}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
      onClick={handleClick}
    >
      {pt === 'DRAWING' && <DrawingMachine processType={pt} phase={phase} />}
      {pt === 'STRANDING' && <StrandingMachine processType={pt} phase={phase} />}
      {pt === 'ROPING' && <RopingMachine processType={pt} phase={phase} />}

      <ProgressBar phase={phase} progress={progress} processType={pt} />

      {idle && !active && <IdleRing />}

      {active && (
        <mesh
          geometry={RING_GEOMETRY}
          material={selected ? MAT_SELECTED_RING : MAT_HOVER_RING}
          position={[0, 0.015, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      )}

      {delayed && <DelayedRing />}

      <Html position={[0, 1.5, 0]} center distanceFactor={52} occlude={false} zIndexRange={[20, 0]}>
        <div className={`ws-machine-label${active ? ' is-active' : ''}`}>
          <span className="ws-machine-id">{machine.machine_id}</span>
          {active && (
            <span className="ws-machine-name">
              {machine.machine_name}
              {phase !== 'idle' && (
                <em className={`ws-machine-phase ws-phase-${phase}`}>
                  {PHASE_TEXT[phase]} {Math.round(progress * 100)}%
                </em>
              )}
            </span>
          )}
        </div>
      </Html>
    </group>
  );
}
