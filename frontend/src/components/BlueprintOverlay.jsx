import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { fitTransform, bboxToView } from '../services/coverMapping.js';
import { DETAIL_ICONS } from './detailMeta.js';
import { STRINGS } from '../i18n.js';

// Colors are passed as raw sRGB vec3 to a ShaderMaterial without color-space chunks,
// so they render exactly as specified.
const hex3 = (h) => {
  const n = parseInt(h.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const CYAN = hex3('#22e5ff');
const AMBER = hex3('#ffb547');

const EXIT_MS = 450;
const MAX_SEGMENTS = 24;

// ---------------------------------------------------------------- shaders

const strokeVert = /* glsl */ `
  attribute float aEdge;
  attribute float aAlong;
  varying float vEdge;
  varying float vAlong;
  void main() {
    vEdge = aEdge;
    vAlong = aAlong;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const strokeFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uDash;
  uniform float uCore;
  varying float vEdge;
  varying float vAlong;
  void main() {
    float e = abs(vEdge);
    float core = 1.0 - smoothstep(uCore, uCore + 0.12, e);
    float glow = pow(1.0 - e, 2.2) * 0.5;
    float a = max(core, glow);
    if (uDash > 0.0) {
      float d = fract((vAlong - uTime * 45.0) / uDash);
      a *= smoothstep(0.0, 0.08, d) * (1.0 - smoothstep(0.5, 0.58, d));
    }
    vec3 col = mix(uColor, vec3(1.0), core * 0.45);
    gl_FragColor = vec4(col * a, a * uOpacity);
  }
`;

const fillVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fillFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uPhase;
  uniform vec2 uSize;
  varying vec2 vUv;
  void main() {
    vec2 px = vUv * uSize;
    float scan = step(1.5, mod(px.y, 3.0)) * 0.05;
    float gx = 1.0 - step(1.0, mod(px.x, 18.0));
    float gy = 1.0 - step(1.0, mod(px.y, 18.0));
    float grid = max(gx, gy) * 0.07;
    float s = fract(uTime * 0.42 + uPhase);
    float band = exp(-pow((vUv.y - s) * 9.0, 2.0)) * 0.22;
    float ed = min(min(px.x, uSize.x - px.x), min(px.y, uSize.y - px.y));
    float inner = exp(-ed / 9.0) * 0.32;
    float a = (0.035 + scan + grid + band + inner) * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

function makeStrokeMaterial({ core = 0.22, dash = 0 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: strokeVert,
    fragmentShader: strokeFrag,
    uniforms: {
      uColor: { value: CYAN.clone() },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
      uDash: { value: dash },
      uCore: { value: core },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

function makeFillMaterial(phase) {
  return new THREE.ShaderMaterial({
    vertexShader: fillVert,
    fragmentShader: fillFrag,
    uniforms: {
      uColor: { value: CYAN.clone() },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
      uPhase: { value: phase },
      uSize: { value: new THREE.Vector2(1, 1) },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

// ---------------------------------------------------------------- geometry

/** Non-indexed quad-strip geometry for up to MAX_SEGMENTS thick segments. */
function makeStrokeGeometry() {
  const g = new THREE.BufferGeometry();
  const n = MAX_SEGMENTS * 6;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aEdge', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aAlong', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); // never frustum-culled
  return g;
}

/**
 * Write segments (screen px, top-left origin) into geometry as quads of `thickness` px.
 * @param {number[][]} segs [[x1, y1, x2, y2], ...]
 */
function writeSegments(g, segs, thickness, view) {
  const pos = g.attributes.position.array;
  const edge = g.attributes.aEdge.array;
  const along = g.attributes.aAlong.array;
  const hw = view.w / 2;
  const hh = view.h / 2;
  const t = thickness / 2;
  let v = 0;
  let acc = 0;
  const count = Math.min(segs.length, MAX_SEGMENTS);
  for (let i = 0; i < count; i++) {
    let [x1, y1, x2, y2] = segs[i];
    // to world (y up, centered)
    x1 -= hw; x2 -= hw;
    y1 = hh - y1; y2 = hh - y2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // extend by half thickness so joints overlap cleanly
    const ax = x1 - ux * t * 0.5, ay = y1 - uy * t * 0.5;
    const bx = x2 + ux * t * 0.5, by = y2 + uy * t * 0.5;
    const nx = -uy * t;
    const ny = ux * t;
    const quad = [
      [ax + nx, ay + ny, 1, acc],
      [ax - nx, ay - ny, -1, acc],
      [bx + nx, by + ny, 1, acc + len],
      [bx + nx, by + ny, 1, acc + len],
      [ax - nx, ay - ny, -1, acc],
      [bx - nx, by - ny, -1, acc + len],
    ];
    for (const [px, py, e, al] of quad) {
      pos[v * 3] = px;
      pos[v * 3 + 1] = py;
      pos[v * 3 + 2] = 0;
      edge[v] = e;
      along[v] = al;
      v++;
    }
    acc += len;
  }
  g.setDrawRange(0, v);
  g.attributes.position.needsUpdate = true;
  g.attributes.aEdge.needsUpdate = true;
  g.attributes.aAlong.needsUpdate = true;
}

function bracketSegments({ x, y, w, h }, p) {
  const L = Math.max(8, Math.min(42, Math.min(w, h) * 0.3)) * p;
  const tick = 7 * p;
  const r = x + w;
  const b = y + h;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return [
    // corner brackets
    [x, y, x + L, y], [x, y, x, y + L],
    [r, y, r - L, y], [r, y, r, y + L],
    [x, b, x + L, b], [x, b, x, b - L],
    [r, b, r - L, b], [r, b, r, b - L],
    // outward mid-edge ticks
    [cx, y, cx, y - tick], [cx, b, cx, b + tick],
    [x, cy, x - tick, cy], [r, cy, r + tick, cy],
  ];
}

function outlineSegments({ x, y, w, h }) {
  const r = x + w;
  const b = y + h;
  return [[x, y, r, y], [r, y, r, b], [r, b, x, b], [x, b, x, y]];
}

// ---------------------------------------------------------------- box

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Screen bands owned by the HUD: top bar + style pill, and the narration / controls / sheet dock.
const TOP_SAFE = 116;
const BOTTOM_SAFE = 250;
const BADGE_HALF_H = 22;
const LEADER = 18;

/**
 * Badge layout: hang it above the box, or below it when the space above is covered by the
 * top HUD (and the space below is not covered by the bottom dock). It extends to the right
 * of the leader elbow, or is flipped to the left when it would overflow the viewport.
 */
function placeBadge(rect, view, badgeW) {
  const margin = 8;
  const gap = 20; // elbow → badge
  const roomAbove = rect.y - LEADER - BADGE_HALF_H > TOP_SAFE;
  const roomBelow = rect.y + rect.h + LEADER + BADGE_HALF_H < view.h - BOTTOM_SAFE;
  const above = roomAbove || !roomBelow;
  const elbowY = above ? rect.y - LEADER : rect.y + rect.h + LEADER;
  const flip = rect.x + 22 + gap + badgeW > view.w - margin;
  if (!flip) {
    const ax = clamp(rect.x + 22, margin, Math.max(margin, view.w - margin - gap - badgeW));
    return { above, flip, ax, elbowY, sx: rect.x + 2, ex: ax + 18, bx: ax + gap };
  }
  const ax = clamp(rect.x + rect.w - 22, Math.min(view.w - margin, margin + gap + badgeW), view.w - margin);
  return { above, flip, ax, elbowY, sx: rect.x + rect.w - 2, ex: ax - 18, bx: ax - gap };
}

function BlueprintBox({ detail, target, view, selected, dimmed, leaving, index, lang, onSelect }) {
  const cur = useRef(null);
  const appear = useRef(0);
  const fade = useRef(1);
  const fillRef = useRef();
  const badgeGroup = useRef();
  const badgeEl = useRef(null);
  const [layout, setLayout] = useState('above');

  const mats = useMemo(
    () => ({
      core: makeStrokeMaterial({ core: 0.2 }),
      outline: makeStrokeMaterial({ core: 0.12 }),
      leader: makeStrokeMaterial({ core: 0.18, dash: 10 }),
      fill: makeFillMaterial(index * 0.37),
    }),
    [index],
  );
  const geos = useMemo(
    () => ({ core: makeStrokeGeometry(), outline: makeStrokeGeometry(), leader: makeStrokeGeometry() }),
    [],
  );
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      Object.values(geos).forEach((g) => g.dispose());
    },
    [mats, geos],
  );

  useFrame((state, dt) => {
    if (!target) return;
    const d = Math.min(dt, 0.1);
    if (!cur.current) {
      // enter from a slightly inflated rect for a "lock-on" feel
      const pad = 24;
      cur.current = { x: target.x - pad, y: target.y - pad, w: target.w + pad * 2, h: target.h + pad * 2 };
    }
    const k = 1 - Math.exp(-d * 9); // frame-rate independent lerp
    const c = cur.current;
    c.x += (target.x - c.x) * k;
    c.y += (target.y - c.y) * k;
    c.w += (target.w - c.w) * k;
    c.h += (target.h - c.h) * k;

    appear.current = Math.min(1, appear.current + d * 2.4);
    fade.current = leaving ? Math.max(0, fade.current - d * (1000 / EXIT_MS)) : Math.min(1, fade.current + d * 4);
    const p = 1 - Math.pow(1 - appear.current, 3);

    const t = state.clock.elapsedTime;
    const color = selected ? AMBER : CYAN;
    const pulse = selected ? 0.85 + Math.sin(t * 5) * 0.15 : 1;
    const op = fade.current * (dimmed ? 0.35 : 1) * pulse;

    for (const m of Object.values(mats)) {
      m.uniforms.uColor.value.copy(color);
      m.uniforms.uTime.value = t;
    }
    mats.core.uniforms.uOpacity.value = op;
    mats.outline.uniforms.uOpacity.value = op * 0.35 * p;
    mats.leader.uniforms.uOpacity.value = op * 0.9 * p;
    mats.fill.uniforms.uOpacity.value = op * p * (selected ? 1.6 : 1);
    mats.fill.uniforms.uSize.value.set(Math.max(1, c.w), Math.max(1, c.h));

    writeSegments(geos.core, bracketSegments(c, p), selected ? 9 : 7, view);
    writeSegments(geos.outline, outlineSegments(c), 4, view);

    const badge = placeBadge(c, view, badgeEl.current?.offsetWidth || 200);
    const sy = badge.above ? c.y : c.y + c.h;
    writeSegments(
      geos.leader,
      [
        [badge.sx, sy, badge.ax, badge.elbowY],
        [badge.ax, badge.elbowY, badge.ex, badge.elbowY],
      ],
      5,
      view,
    );

    if (fillRef.current) {
      fillRef.current.position.set(c.x + c.w / 2 - view.w / 2, view.h / 2 - (c.y + c.h / 2), 0);
      fillRef.current.scale.set(Math.max(1, c.w), Math.max(1, c.h), 1);
    }
    if (badgeGroup.current) {
      // badge hangs off the end of the leader elbow
      badgeGroup.current.position.set(badge.bx - view.w / 2, view.h / 2 - badge.elbowY, 0);
    }
    const nextLayout = `${badge.above ? 'above' : 'below'}${badge.flip ? ' flip' : ''}`;
    if (nextLayout !== layout) setLayout(nextLayout);
  });

  const Icon = DETAIL_ICONS[detail.type] ?? DETAIL_ICONS.architectural_element;
  const typeName = STRINGS[lang].types[detail.type] ?? detail.type;

  return (
    <group renderOrder={selected ? 10 : 1}>
      <mesh ref={fillRef} material={mats.fill} renderOrder={1}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh geometry={geos.outline} material={mats.outline} renderOrder={2} frustumCulled={false} />
      <mesh geometry={geos.core} material={mats.core} renderOrder={3} frustumCulled={false} />
      <mesh geometry={geos.leader} material={mats.leader} renderOrder={3} frustumCulled={false} />
      <group ref={badgeGroup}>
        <Html zIndexRange={[selected ? 40 : 30, 0]} style={{ pointerEvents: 'none' }}>
          <button
            ref={badgeEl}
            type="button"
            className={`bp-badge ${layout} ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''} ${leaving ? 'leaving' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(selected ? null : detail.id);
            }}
          >
            <span className="bp-badge-icon">
              <Icon size={14} strokeWidth={2.2} />
            </span>
            <span className="bp-badge-text">
              <span className="bp-badge-type">{typeName}</span>
              <span className="bp-badge-label">{detail.label}</span>
            </span>
            {detail.raw_text && (
              <span className="bp-badge-inscription">
                “{detail.raw_text}”{detail.translated_text ? <em> · {detail.translated_text}</em> : null}
              </span>
            )}
          </button>
        </Html>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------- scene

/** Keeps leaving items around briefly so they can fade out. */
function useTrackedDetails(details) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const ids = new Set(details.map((d) => d.id));
    setItems((prev) => {
      const next = details.map((d) => ({ detail: d, leaving: false }));
      for (const it of prev) if (!ids.has(it.detail.id)) next.push({ detail: it.detail, leaving: true, since: performance.now() });
      return next;
    });
    const timer = setTimeout(() => {
      setItems((prev) => prev.filter((it) => !it.leaving || performance.now() - it.since < EXIT_MS));
    }, EXIT_MS + 50);
    return () => clearTimeout(timer);
  }, [details]);
  return items;
}

function Scene({ details, sourceSize, fit, selectedId, onSelect, lang }) {
  const size = useThree((s) => s.size);
  const view = { w: size.width, h: size.height };
  const t = fitTransform(sourceSize.width, sourceSize.height, size.width, size.height, fit);
  const items = useTrackedDetails(details);

  return items.map(({ detail, leaving }, i) => (
    <BlueprintBox
      key={detail.id}
      index={i}
      detail={detail}
      target={bboxToView(detail.bbox, t)}
      view={view}
      lang={lang}
      leaving={leaving}
      selected={selectedId === detail.id}
      dimmed={selectedId != null && selectedId !== detail.id}
      onSelect={onSelect}
    />
  ));
}

/**
 * Transparent WebGL overlay aligned with an `object-fit: cover` media element that fills
 * the same container. `sourceSize` is the intrinsic size of the frame the bboxes refer to.
 */
export default function BlueprintOverlay({ details, sourceSize, fit = 'cover', selectedId, onSelect, lang }) {
  const ready = sourceSize?.width > 0 && sourceSize?.height > 0;
  return (
    <div className="bp-overlay" aria-hidden={details.length === 0}>
      <Canvas
        orthographic
        camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 1000 }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' }}
        style={{ pointerEvents: 'none' }}
      >
        {ready && (
          <Scene details={details} sourceSize={sourceSize} fit={fit} selectedId={selectedId} onSelect={onSelect} lang={lang} />
        )}
      </Canvas>
    </div>
  );
}
