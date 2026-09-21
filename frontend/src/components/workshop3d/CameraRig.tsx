import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const FLY_DURATION = 1.2;
const OFFSET = new THREE.Vector3(9, 11, 9);

interface CameraRigProps {
  targetPosition: [number, number, number] | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controlsRef: React.MutableRefObject<any>;
}

/**
 * 飞镜动画：targetPosition 变化时，相机 1.2s ease-out cubic 飞向目标机台上方。
 * 动画期间 controls.enabled = false，结束后恢复。
 */
export function CameraRig({ targetPosition, controlsRef }: CameraRigProps) {
  const { camera } = useThree();
  const anim = useRef<{
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    elapsed: number;
  } | null>(null);

  useEffect(() => {
    if (!targetPosition) return;

    const target = new THREE.Vector3(targetPosition[0], targetPosition[1], targetPosition[2]);
    const controls = controlsRef.current;
    const fromTarget = controls ? controls.target.clone() : new THREE.Vector3(0, 0, 0);

    anim.current = {
      fromPos: camera.position.clone(),
      toPos: target.clone().add(OFFSET),
      fromTarget,
      toTarget: target,
      elapsed: 0,
    };

    if (controls) controls.enabled = false;
  }, [targetPosition, camera, controlsRef]);

  useFrame((_, delta) => {
    if (!anim.current) return;
    const a = anim.current;
    a.elapsed = Math.min(FLY_DURATION, a.elapsed + delta);
    const t = a.elapsed / FLY_DURATION;
    const ease = 1 - Math.pow(1 - t, 3);

    camera.position.lerpVectors(a.fromPos, a.toPos, ease);

    const controls = controlsRef.current;
    if (controls) {
      controls.target.lerpVectors(a.fromTarget, a.toTarget, ease);
      controls.update();
    }

    if (a.elapsed >= FLY_DURATION) {
      anim.current = null;
      if (controls) controls.enabled = true;
    }
  });

  // 防止 useMemo 未使用警告
  useMemo(() => null, []);

  return null;
}
