"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { FloorGeometry } from "@/lib/building/geometry";

const TYPE_COLORS: Record<string, number> = {
  "فصل دراسي": 0x83bda4,
  "معمل": 0x7fa8d9,
  "مكتب إداري": 0xd9bd7f,
  "غرفة معلمين": 0xb49fd1,
  "مصادر تعلم": 0xb49fd1,
  "ممر": 0xd8d4c8,
  "سلم": 0xa8a394,
  "دورة مياه": 0x8fc4cf,
  "خدمات": 0x8fc4cf,
};

export default function IsoView({
  floors,
}: {
  floors: { key: string; nameAr: string; level: number; geometry: FloorGeometry }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleLevels, setVisibleLevels] = useState<Set<number>>(new Set(floors.map((f) => f.level)));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const width = container.clientWidth;
    const height = 520;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xfaf9f7);

    // كاميرا متساوية القياس
    const d = 32;
    const aspect = width / height;
    const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 1000);
    camera.position.set(50, 45, 50);
    camera.lookAt(20, 0, 8);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(30, 60, 20);
    scene.add(dir);

    const floorHeight = 3.2;
    for (const floor of floors) {
      if (!visibleLevels.has(floor.level)) continue;
      const baseY = floor.level * floorHeight;
      for (const room of floor.geometry.rooms) {
        const color = TYPE_COLORS[room.type] ?? 0xcfcabc;
        const geo = new THREE.BoxGeometry(room.w, floorHeight - 0.3, room.h);
        const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.95 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(room.x + room.w / 2, baseY + (floorHeight - 0.3) / 2, room.y + room.h / 2);
        scene.add(mesh);
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x6b675c }),
        );
        edges.position.copy(mesh.position);
        scene.add(edges);
      }
    }

    // أرضية
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 40),
      new THREE.MeshLambertMaterial({ color: 0xe5e1d8 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(22, -0.1, 7);
    scene.add(ground);

    let angle = 0;
    let dragging = false;
    let lastX = 0;
    const onDown = (e: MouseEvent) => { dragging = true; lastX = e.clientX; };
    const onUp = () => { dragging = false; };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      angle += (e.clientX - lastX) * 0.008;
      lastX = e.clientX;
      const r = 70;
      camera.position.set(20 + r * Math.cos(angle + 0.8), 45, 8 + r * Math.sin(angle + 0.8));
      camera.lookAt(20, 0, 8);
    };
    renderer.domElement.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [floors, visibleLevels]);

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap gap-2">
        {floors.map((f) => (
          <label key={f.key} className="flex items-center gap-1 rounded-lg border border-sand-200 px-3 py-1.5 text-sm">
            <input
              type="checkbox"
              checked={visibleLevels.has(f.level)}
              onChange={(e) => {
                const next = new Set(visibleLevels);
                if (e.target.checked) next.add(f.level);
                else next.delete(f.level);
                setVisibleLevels(next);
              }}
            />
            {f.nameAr}
          </label>
        ))}
        <span className="self-center text-xs text-gray-400">اسحب بالفأرة للدوران</span>
      </div>
      <div ref={containerRef} className="overflow-hidden rounded-xl border border-sand-200" />
    </div>
  );
}
