import { useMemo } from 'react';
import { Grid, Html, RoundedBox } from '@react-three/drei';
import type { Machine } from '../../types/schedule';
import type { WorkshopSnapshot } from './workshopSelectors';
import { layoutMachines, PLATFORM_TOP_Y, type ZoneLayout } from './machineLayout';
import { MachineUnit } from './MachineUnit';

function ZonePlatform({ zone }: { zone: ZoneLayout }) {
  return (
    <group position={[zone.x, 0, 0]}>
      <RoundedBox args={[zone.width, PLATFORM_TOP_Y, zone.depth]} radius={0.12} smoothness={4} position={[0, PLATFORM_TOP_Y / 2, 0]}>
        <meshStandardMaterial color="#ffffff" roughness={0.85} metalness={0.05} />
      </RoundedBox>
      <mesh position={[0, PLATFORM_TOP_Y + 0.02, zone.depth / 2 - 0.35]}>
        <boxGeometry args={[zone.width - 1.2, 0.05, 0.1]} />
        <meshStandardMaterial color={zone.color} roughness={0.6} />
      </mesh>
      <Html position={[0, 1.15, -zone.depth / 2 + 0.4]} center distanceFactor={30} occlude={false}>
        <div className="ws-zone-label">
          <span className="ws-zone-dot" style={{ background: zone.color }} />
          {zone.label}
          <span className="ws-zone-count">{zone.machineIds.length} 台</span>
        </div>
      </Html>
    </group>
  );
}

interface FactorySceneProps {
  machines: Machine[];
  snapshot: WorkshopSnapshot;
  selectedMachineId: string | null;
  onSelectMachine: (machineId: string) => void;
}

export function FactoryScene({ machines, snapshot, selectedMachineId, onSelectMachine }: FactorySceneProps) {
  const layout = useMemo(() => layoutMachines(machines), [machines]);

  return (
    <>
      <ambientLight intensity={0.78} />
      <directionalLight
        position={[16, 26, 12]}
        intensity={1.15}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-35}
        shadow-camera-right={35}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
      />
      <directionalLight position={[-14, 12, -10]} intensity={0.3} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[90, 56]} />
        <meshStandardMaterial color="#fbfbfd" roughness={0.95} />
      </mesh>

      <Grid
        position={[0, 0.01, 0]}
        args={[90, 56]}
        cellSize={1}
        cellThickness={0.6}
        cellColor="#e8e8ed"
        sectionSize={4}
        sectionThickness={1}
        sectionColor="#d8d8de"
        fadeDistance={60}
        fadeStrength={1.5}
        infiniteGrid={false}
      />

      {layout.zones.map((z) => (
        <ZonePlatform key={z.processType} zone={z} />
      ))}

      {layout.positioned.map(({ machine, position }) => {
        const state = snapshot.machines[machine.machine_id];
        const delayed = state?.phase === 'running' && state.task?.status === 'DELAYED';
        return (
          <MachineUnit
            key={machine.machine_id}
            machine={machine}
            position={position}
            phase={state?.phase ?? 'idle'}
            progress={state?.progress ?? 0}
            selected={selectedMachineId === machine.machine_id}
            delayed={delayed}
            onSelect={onSelectMachine}
          />
        );
      })}
    </>
  );
}
