import { useCallback, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { FactoryScene } from './FactoryScene';
import { CameraRig } from './CameraRig';
import { findPeakTime, workshopSnapshotAt } from './workshopSelectors';
import { layoutMachines } from './machineLayout';
import { OrderScheduleDistCard } from './OrderScheduleDistCard';
import { useScheduleStore } from '../../store/useScheduleStore';

/**
 * 车间 3D 实时看板入口。
 * 数据源：useScheduleStore 的 tasks / machines。
 * 默认显示 peakTime（车间最繁忙时刻）的快照，让用户一眼看到满载运行。
 */
export function WorkshopBoard() {
  const tasks = useScheduleStore((s) => s.tasks);
  const machines = useScheduleStore((s) => s.machines);
  const selectedTaskId = useScheduleStore((s) => s.selectedTaskId);
  const setSelectedTask = useScheduleStore((s) => s.setSelectedTask);

  const taskList = useMemo(() => Object.values(tasks), [tasks]);

  const peakTime = useMemo(() => findPeakTime(taskList), [taskList]);
  const snapshot = useMemo(() => workshopSnapshotAt(taskList, peakTime), [taskList, peakTime]);

  const layout = useMemo(() => layoutMachines(machines), [machines]);

  const selectedMachineId = useMemo(
    () => (selectedTaskId ? tasks[selectedTaskId]?.machine_id ?? null : null),
    [selectedTaskId, tasks],
  );

  const targetPosition = selectedMachineId
    ? layout.positionById.get(selectedMachineId) ?? null
    : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);

  const handleSelectMachine = useCallback(
    (machineId: string) => {
      if (!setSelectedTask) return;
      const active = snapshot.machines[machineId]?.task;
      if (active) {
        setSelectedTask(active.task_id);
        return;
      }
      const onMachine = taskList
        .filter((t) => t.machine_id === machineId)
        .sort((a, b) => a.start_time - b.start_time);
      const next = onMachine.find((t) => t.start_time - t.setup_duration_min >= peakTime);
      const target = next ?? onMachine[onMachine.length - 1];
      if (target) setSelectedTask(target.task_id);
    },
    [snapshot, taskList, peakTime, setSelectedTask],
  );

  return (
    <div className="workshop-wrap">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [34, 27, 34], fov: 42, far: 400 }}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          gl.setClearColor('#f5f5f7');
        }}
      >
        <FactoryScene
          machines={machines}
          snapshot={snapshot}
          selectedMachineId={selectedMachineId}
          onSelectMachine={handleSelectMachine}
        />
        <CameraRig
          targetPosition={targetPosition}
          controlsRef={controlsRef}
        />
        <OrbitControls
          ref={controlsRef}
          target={[0, 0, 0]}
          maxPolarAngle={Math.PI / 2.15}
          minDistance={10}
          maxDistance={110}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>

      <div className="ws-hud ws-hud-title">
        <div className="ws-hud-name">车间 3D 实时看板</div>
        <div className="ws-hud-sub">当前排产计划 · 三工序车间数字孪生</div>
      </div>

      <OrderScheduleDistCard />
    </div>
  );
}
