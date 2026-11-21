import React, { useRef, useState, useMemo, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html, Float, Points, PointMaterial, Line, useGLTF } from '@react-three/drei';
import type { OrganId, OrganMapping } from '../types';

type V3 = [number, number, number];
const noRaycast = () => null; // body / leader lines must never swallow organ clicks

// ============================================================================
// 1. MEDICAL HOLOGRAM MATERIALS                                   [CHANGED]
//    Replaces the custom Fresnel ShaderMaterial (alpha ≈ 0.08 at the centre of
//    every mesh – that is why the body was invisible and only the organs
//    looked like floating bubbles).
// ============================================================================

const HOLO_OPACITY = 0.5;
const HOLO_EMISSIVE = 0.35;
const WIRE_OPACITY = 0.35;

const createHologramMaterial = () =>
  new THREE.MeshPhysicalMaterial({
    color: '#38bdf8',
    emissive: '#0284c7',
    emissiveIntensity: HOLO_EMISSIVE,
    transmission: 0.9,
    thickness: 0.6,
    ior: 1.15,
    opacity: HOLO_OPACITY,
    transparent: true,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    // IMPORTANT: no depth writes, otherwise the front skin of the body
    // depth-occludes the organs that sit inside it.
    depthWrite: false,
  });

// Thin additive wire overlay -> gives the faceted "low-poly hologram" look
const createWireMaterial = () =>
  new THREE.MeshBasicMaterial({
    color: '#38bdf8',
    wireframe: true,
    transparent: true,
    opacity: WIRE_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

// ============================================================================
// 2. ORGAN TOOLTIP (DREI HTML OVERLAY WITH CALLOUT POINTER)       [CHANGED]
// ============================================================================

// Card geometry in CSS px (used both for styling and for the layout maths)
const CARD_W_PX = 176; // max width; shrinks on narrow canvases
const CARD_H_PX = 52;
const CONNECTOR_PX = 26;
// Narrow canvases (phones / tablets): name-only cards that may overlap the arms
const CONNECTOR_COMPACT_PX = 10;
const CARD_H_COMPACT_PX = 34;
// Was 8 -> every card rendered at ~2x (≈290×104px, 2.5 world-units wide).
// 4 => ~1:1 pixels at the default camera distance (5.2).
const TOOLTIP_DISTANCE_FACTOR = 4;

interface OrganTooltipProps {
  name: string;
  metric: string;
  status: 'safe' | 'warning' | 'critical';
  visible: boolean;
  offset: [number, number, number];
  side: 'left' | 'right';
  isSelected?: boolean;
  onClick?: () => void;
  cardWidth?: number;
  compact?: boolean;
}

const OrganTooltip: React.FC<OrganTooltipProps> = ({
  name,
  metric,
  status,
  visible,
  offset,
  side,
  isSelected,
  onClick,
  cardWidth = CARD_W_PX,
  compact = false
}) => {
  if (!visible) return null;
  const connectorPx = compact ? CONNECTOR_COMPACT_PX : CONNECTOR_PX;

  // Status is encoded as accent colour + dot (the full-width badge used to
  // squeeze the organ name down to "Tim & Mạc…").
  const accent = {
    safe: { bar: 'bg-emerald-400', dot: 'bg-emerald-500', label: 'Ổn định' },
    warning: { bar: 'bg-amber-400', dot: 'bg-amber-500', label: 'Theo dõi' },
    critical: { bar: 'bg-rose-500', dot: 'bg-rose-500 animate-pulse', label: 'Nguy cơ' },
  }[status];

  return (
    <Html
      position={offset}
      distanceFactor={TOOLTIP_DISTANCE_FACTOR}
      center={false}
      zIndexRange={[10, 0]} // stay below the HUD pills (z-20)
      style={{ pointerEvents: 'none' }}
    >
      <div
        onClick={onClick}
        title={`${name} · ${accent.label} — ${metric}`}
        // Absolute transform: anchor point = dot, row is vertically centred on it,
        // left-side cards grow leftwards (-100%) instead of using a Tailwind class.
        style={{
          transform: `translate3d(${side === 'left' ? '-100%' : '0'}, -50%, 0)`,
          width: cardWidth + connectorPx,
        }}
        className={`pointer-events-auto cursor-pointer select-none transition-all duration-200 hover:scale-105 flex items-center ${side === 'left' ? 'flex-row-reverse' : 'flex-row'
          }`}
      >
        {/* Callout connector beam */}
        <div className="flex items-center shrink-0" style={{ width: connectorPx }}>
          <div className="w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
          <div className="flex-1 h-[1.5px] bg-gradient-to-r from-sky-400 to-sky-300" />
        </div>

        {/* Compact Tooltip Card */}
        <div
          style={{ width: cardWidth, minHeight: (compact ? CARD_H_COMPACT_PX : CARD_H_PX) - 8 }}
          className={`relative backdrop-blur-md bg-white/95 border rounded-xl py-2 pr-2 pl-3 shadow-lg transition-all ${isSelected
            ? 'border-sky-500 ring-2 ring-sky-400/40 shadow-sky-200'
            : 'border-slate-200/90 hover:border-sky-300'
            }`}
        >
          <span className={`absolute left-1 top-2 bottom-2 w-[3px] rounded-full ${accent.bar}`} />
          <div className={`flex ${compact ? 'items-start' : 'items-center mb-1'} gap-1.5`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${compact ? 'mt-1' : ''} ${accent.dot}`} />
            <span className={`font-bold text-[11px] text-slate-900 leading-tight ${compact ? 'line-clamp-2' : 'truncate'}`}>{name}</span>
            <span className="sr-only">{accent.label}</span>
          </div>
          {!compact && (
            <div className="text-[10px] text-slate-500 font-mono leading-tight truncate">
              {metric}
            </div>
          )}
        </div>
      </div>
    </Html>
  );
};

// 3D leader line organ -> tooltip anchor (child of the organ mesh => local coords)
const Leader: React.FC<{ to: V3; opacity: number; active?: boolean }> = ({ to, opacity, active }) => (
  <Line
    points={[[0, 0, 0], to]}
    color="#38bdf8"
    lineWidth={active ? 1.8 : 1.1}
    transparent
    opacity={opacity * (active ? 0.95 : 0.5)}
    raycast={noRaycast}
  />
);

// ============================================================================
// 3. HUMANOID SILHOUETTE (PROCEDURAL, GROUPED PRIMITIVES)         [CHANGED]
//    Head = Sphere · Torso = Capsule · Arms/Legs = Cylinders
//    Limbs are built from joint -> joint endpoints, so the cylinder is always
//    positioned, oriented and sized to connect its two joints (the old code
//    hand-tilted each piece the *opposite* way from its drift => disjointed).
// ============================================================================

interface PartProps {
  holo: THREE.Material;
  wire: THREE.Material;
  position?: V3;
  scale?: V3;
  quaternion?: THREE.Quaternion;
  children: React.ReactNode; // the <xxxGeometry /> element
}

const Part: React.FC<PartProps> = ({ wire, children, ...transform }) => (
  <group {...transform}>
    {/* Sci-fi wireframe mesh only - no cloudy translucent layer */}
    <mesh material={wire} raycast={noRaycast}>{children}</mesh>
  </group>
);

interface LimbProps {
  holo: THREE.Material;
  wire: THREE.Material;
  from: V3;
  to: V3;
  r0: number; // radius at `from`
  r1: number; // radius at `to`
}

const UP = new THREE.Vector3(0, 1, 0);

const Limb: React.FC<LimbProps> = ({ holo, wire, from, to, r0, r1 }) => {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const dir = b.clone().sub(a);
  const length = dir.length();
  const mid = a.clone().add(b).multiplyScalar(0.5).toArray() as V3;
  const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  return (
    <Part holo={holo} wire={wire} position={mid} quaternion={quaternion}>
      {/* cylinder +Y end (radiusTop) points at `to` */}
      <cylinderGeometry args={[r1, r0, length, 10]} />
    </Part>
  );
};

const Joint: React.FC<{ holo: THREE.Material; wire: THREE.Material; at: V3; r: number }> = ({ holo, wire, at, r }) => (
  <Part holo={holo} wire={wire} position={at}>
    <sphereGeometry args={[r, 12, 10]} />
  </Part>
);

// Right-hand side joints (x > 0); the left side is mirrored in X
const ARM = {
  shoulder: [0.44, 1.08, 0] as V3,
  elbow: [0.56, 0.56, 0.02] as V3,
  wrist: [0.66, 0.08, 0.03] as V3,
  hand: [0.69, -0.06, 0.04] as V3,
};
const LEG = {
  hip: [0.17, -0.12, 0] as V3,
  knee: [0.20, -0.86, 0.02] as V3,
  ankle: [0.21, -1.52, 0] as V3,
  toe: [0.21, -1.60, 0.20] as V3,
};
const mirror = (p: V3, side: 1 | -1): V3 => [p[0] * side, p[1], p[2]];

interface HumanoidPlaceholderProps {
  holo: THREE.Material;
  wire: THREE.Material;
}

const HumanoidPlaceholder: React.FC<HumanoidPlaceholderProps> = React.memo(({ holo, wire }) => {
  const m = { holo, wire };
  return (
    <group position={[0, 0, 0]}>
      {/* Head – Sphere */}
      <Part {...m} position={[0, 1.52, 0]}>
        <sphereGeometry args={[0.21, 16, 14]} />
      </Part>

      {/* Neck – Cylinder */}
      <Part {...m} position={[0, 1.26, 0]}>
        <cylinderGeometry args={[0.075, 0.085, 0.2, 10]} />
      </Part>

      {/* Torso – Capsule (flattened front-to-back: ±0.34 wide, ±0.21 deep) */}
      <Part {...m} position={[0, 0.52, 0]} scale={[1, 1, 0.62]}>
        <capsuleGeometry args={[0.34, 0.8, 6, 16]} />
      </Part>

      {/* Pelvis – Cylinder */}
      <Part {...m} position={[0, -0.1, 0]} scale={[1, 1, 0.66]}>
        <cylinderGeometry args={[0.3, 0.26, 0.26, 14]} />
      </Part>

      {/* Arms + Legs – mirrored left/right */}
      {([1, -1] as const).map((s) => (
        <group key={s}>
          {/* Arm: shoulder -> elbow -> wrist -> hand */}
          <Joint {...m} at={mirror(ARM.shoulder, s)} r={0.11} />
          <Limb {...m} from={mirror(ARM.shoulder, s)} to={mirror(ARM.elbow, s)} r0={0.082} r1={0.065} />
          <Joint {...m} at={mirror(ARM.elbow, s)} r={0.065} />
          <Limb {...m} from={mirror(ARM.elbow, s)} to={mirror(ARM.wrist, s)} r0={0.062} r1={0.048} />
          <Joint {...m} at={mirror(ARM.hand, s)} r={0.058} />

          {/* Leg: hip -> knee -> ankle -> toe */}
          <Joint {...m} at={mirror(LEG.hip, s)} r={0.125} />
          <Limb {...m} from={mirror(LEG.hip, s)} to={mirror(LEG.knee, s)} r0={0.125} r1={0.088} />
          <Joint {...m} at={mirror(LEG.knee, s)} r={0.088} />
          <Limb {...m} from={mirror(LEG.knee, s)} to={mirror(LEG.ankle, s)} r0={0.085} r1={0.055} />
          <Joint {...m} at={mirror(LEG.ankle, s)} r={0.055} />
          <Limb {...m} from={[LEG.ankle[0] * s, -1.55, -0.03]} to={mirror(LEG.toe, s)} r0={0.05} r1={0.04} />
        </group>
      ))}
    </group>
  );
});

// ============================================================================
// 3.1 SEAMLESS 3D HUMAN BODY MESH (SDF + MARCHING TETRAHEDRA GLB)
// ============================================================================

interface SeamlessHumanBodyProps {
  holo: THREE.Material;
  wire: THREE.Material;
}

const SeamlessHumanBody: React.FC<SeamlessHumanBodyProps> = React.memo(({ holo, wire }) => {
  const { scene } = useGLTF('/human-body.glb');

  const geometry = useMemo(() => {
    let geo: THREE.BufferGeometry | null = null;
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && !geo) {
        geo = (child as THREE.Mesh).geometry;
      }
    });
    return geo;
  }, [scene]);

  if (!geometry) return null;

  return (
    <group position={[0, 0, 0]}>
      {/* Sci-fi low-poly wireframe glow grid (No translucent occlusion layer) */}
      <mesh geometry={geometry} material={wire} raycast={noRaycast} />
    </group>
  );
});

useGLTF.preload('/human-body.glb');

// ============================================================================
// 4. MACRO SCENE (HUMANOID SILHOUETTE & SPREAD OUT INTERNAL ORGANS) [CHANGED]
// ============================================================================

interface MacroSceneProps {
  opacity: number;
  alerts?: Record<OrganId, OrganMapping>;
  activeOrgan?: OrganId | null;
  onSelectOrgan?: (organId: OrganId) => void;
}

// Organ positions inside the torso (torso spans y -0.22 … 1.26, x ±0.34)
// Vertical pitch ≈ 0.35, horizontal spread ≈ ±0.19  (was 0.1–0.3 / ±0.16)
const HEART_POS: V3 = [0.15, 1.04, 0.04];
const LIVER_POS: V3 = [-0.18, 0.68, 0.04];
const KIDNEY_GROUP_POS: V3 = [0, 0.32, -0.06];
const KIDNEY_L_LOCAL: V3 = [-0.19, 0, 0];
const KIDNEY_R_LOCAL: V3 = [0.19, 0, 0];
const PANCREAS_POS: V3 = [0.12, -0.02, 0.05];
// [ADDED] the side panel lists 6 organs (incl. stomach + joints) but the 3D scene only had 4
const STOMACH_POS: V3 = [0.13, 0.5, 0.08];
const KNEE_L_POS: V3 = [-0.2, -0.86, 0.04];
const KNEE_R_POS: V3 = [0.2, -0.86, 0.04];

const REF_DIST = 5.2; // default camera distance
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const MacroScene: React.FC<MacroSceneProps> = ({ opacity, alerts = {} as Record<OrganId, OrganMapping>, activeOrgan, onSelectOrgan }) => {
  const { size } = useThree();

  const holoMat = useMemo(createHologramMaterial, []);
  const wireMat = useMemo(createWireMaterial, []);
  useEffect(() => () => { holoMat.dispose(); wireMat.dispose(); }, [holoMat, wireMat]);

  // Keep materials in sync with the macro<->micro cross-fade
  useFrame(() => {
    holoMat.opacity = HOLO_OPACITY * opacity;
    holoMat.emissiveIntensity = HOLO_EMISSIVE * opacity;
    wireMat.opacity = WIRE_OPACITY * opacity;
  });

  // ---- TOOLTIP FAN LAYOUT (scene space, independent of zoom) ---------------
  // Html uses distanceFactor, so a card has a FIXED size in world units:
  //   worldSize = cssPx * distanceFactor / canvasHeight   (zoom-invariant)
  // Every card gets its own Y slot spaced > card height, so no two cards can
  // overlap at any zoom OR any orbit angle. Left/right columns fan diagonally.
  const { anchors, cardWidth, compact } = useMemo(() => {
    const worldPerPx = TOOLTIP_DISTANCE_FACTOR / size.height;
    const pxPerUnit = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(21)) * REF_DIST);
    const halfWidth = size.width / 2 / pxPerUnit;
    const X_MIN = 0.78; // keep cards clear of the arms (hands reach x≈0.75)
    // px left beside the body for connector + card
    const roomPx = (halfWidth - X_MIN - 0.08) / worldPerPx;
    // not enough room for readable full cards -> compact name-only cards
    const isCompact = roomPx < 120 + CONNECTOR_PX;
    const connector = isCompact ? CONNECTOR_COMPACT_PX : CONNECTOR_PX;
    const xMin = isCompact ? 0.42 : X_MIN;
    const cardPx = isCompact
      ? THREE.MathUtils.clamp((halfWidth - xMin - 0.05) / worldPerPx - connector, 64, 104)
      : THREE.MathUtils.clamp(roomPx - CONNECTOR_PX, 120, CARD_W_PX);
    const cardH = isCompact ? CARD_H_COMPACT_PX : CARD_H_PX;
    const cardW = (cardPx + connector) * worldPerPx;
    const rowGap = (cardH + 5) * worldPerPx;
    const x = THREE.MathUtils.clamp(halfWidth - cardW - 0.05, xMin, 0.92);
    // 6 unique Y slots, ordered like the organs (top -> bottom), alternating sides.
    // Stack centred on y=0 (clear of the top HUD / bottom hint).
    const y = (slot: number) => (2.5 - slot) * rowGap;
    return {
      cardWidth: cardPx,
      compact: isCompact,
      anchors: {
        heart: [x, y(0), 0.15] as V3,
        liver: [-x, y(1), 0.15] as V3,
        stomach: [x, y(2), 0.15] as V3,
        kidneys: [-x, y(3), 0.15] as V3,
        pancreas: [x, y(4), 0.15] as V3,
        joints: [-x, y(5), 0.15] as V3,
      },
    };
  }, [size.width, size.height]);

  const showTips = opacity > 0.4;

  const heartOffset = sub(anchors.heart, HEART_POS);
  const liverOffset = sub(anchors.liver, LIVER_POS);
  const kidneyOffset = sub(anchors.kidneys, add(KIDNEY_GROUP_POS, KIDNEY_L_LOCAL));
  const pancreasOffset = sub(anchors.pancreas, PANCREAS_POS);
  const stomachOffset = sub(anchors.stomach, STOMACH_POS);
  const jointsOffset = sub(anchors.joints, KNEE_L_POS);

  const sev = (id: OrganId): 'safe' | 'warning' | 'critical' =>
    alerts[id]?.severity === 'critical' ? 'critical' : alerts[id]?.severity === 'warning' ? 'warning' : 'safe';

  const getTheme = (status: 'safe' | 'warning' | 'critical', isActive: boolean) => {
    if (status === 'critical') {
      return {
        color: '#f43f5e',
        emissive: '#e11d48',
        emissiveIntensity: isActive ? 2.2 : 0.95 * opacity,
      };
    }
    if (status === 'warning') {
      return {
        color: '#f59e0b',
        emissive: '#d97706',
        emissiveIntensity: isActive ? 1.8 : 0.7 * opacity,
      };
    }
    return {
      color: '#10b981',
      emissive: '#059669',
      emissiveIntensity: isActive ? 1.5 : 0.5 * opacity,
    };
  };

  const heartSev = sev('heart');
  const heartTheme = getTheme(heartSev, activeOrgan === 'heart');

  const liverSev = sev('liver');
  const liverTheme = getTheme(liverSev, activeOrgan === 'liver');

  const kidneySev = sev('kidneys');
  const kidneyTheme = getTheme(kidneySev, activeOrgan === 'kidneys');

  const pancreasSev = sev('pancreas');
  const pancreasTheme = getTheme(pancreasSev, activeOrgan === 'pancreas');

  const stomachSev = sev('stomach');
  const stomachTheme = getTheme(stomachSev, activeOrgan === 'stomach');

  const jointsSev = sev('joints');
  const jointsTheme = getTheme(jointsSev, activeOrgan === 'joints');

  // Tooltip visibility: show only if organ has active warning/critical alert OR if user explicitly selected it
  const hasAlert = (id: OrganId) => alerts[id]?.severity === 'critical' || alerts[id]?.severity === 'warning';
  const showHeartTip = showTips && (hasAlert('heart') || activeOrgan === 'heart');
  const showLiverTip = showTips && (hasAlert('liver') || activeOrgan === 'liver');
  const showKidneyTip = showTips && (hasAlert('kidneys') || activeOrgan === 'kidneys');
  const showPancreasTip = showTips && (hasAlert('pancreas') || activeOrgan === 'pancreas');
  const showStomachTip = showTips && (hasAlert('stomach') || activeOrgan === 'stomach');
  const showJointsTip = showTips && (hasAlert('joints') || activeOrgan === 'joints');

  return (
    <group visible={opacity > 0.02}>
      {/* 3D Anatomical Human Body Mesh (Seamless Low-Poly Hologram GLB) */}
      <Suspense fallback={<HumanoidPlaceholder holo={holoMat} wire={wireMat} />}>
        <SeamlessHumanBody holo={holoMat} wire={wireMat} />
      </Suspense>

      {/* ======================================================================
          INTERNAL ORGANS (Y: 1.04 → -0.02, X: ±0.19) – physically separated
          ====================================================================== */}

      {/* 1. TIM (Heart) - Upper Chest, patient's left */}
      <mesh
        position={HEART_POS}
        onClick={(e) => { e.stopPropagation(); onSelectOrgan?.('heart'); }}
      >
        <sphereGeometry args={[0.10, 24, 24]} />
        <meshStandardMaterial
          color={heartTheme.color}
          emissive={heartTheme.emissive}
          emissiveIntensity={heartTheme.emissiveIntensity}
          roughness={0.2}
          transparent
          opacity={opacity}
        />
        {showHeartTip && <Leader to={heartOffset} opacity={opacity} active={activeOrgan === 'heart'} />}
        <OrganTooltip
          name="Tim & Mạch máu"
          metric={alerts.heart?.reason || 'Huyết áp: 120/80 · Nhịp xoang đều'}
          status={heartSev}
          visible={showHeartTip}
          offset={heartOffset}
          side="right"
          isSelected={activeOrgan === 'heart'}
          cardWidth={cardWidth}
          compact={compact}
          onClick={() => onSelectOrgan?.('heart')}
        />
      </mesh>

      {/* 2. GAN (Liver) - Upper Abdomen, patient's right */}
      <mesh
        position={LIVER_POS}
        scale={[1.25, 0.85, 0.95]}
        onClick={(e) => { e.stopPropagation(); onSelectOrgan?.('liver'); }}
      >
        <sphereGeometry args={[0.11, 24, 24]} />
        <meshStandardMaterial
          color={liverTheme.color}
          emissive={liverTheme.emissive}
          emissiveIntensity={liverTheme.emissiveIntensity}
          roughness={0.25}
          transparent
          opacity={opacity}
        />
        {/* organ mesh is non-uniformly scaled -> counter-scale so the offset stays in world units */}
        <group scale={[1 / 1.25, 1 / 0.85, 1 / 0.95]}>
          {showLiverTip && <Leader to={liverOffset} opacity={opacity} active={activeOrgan === 'liver'} />}
          <OrganTooltip
            name="Gan & Chuyển hóa"
            metric={alerts.liver?.reason || 'ALT/AST bình thường · Men gan tốt'}
            status={liverSev}
            visible={showLiverTip}
            offset={liverOffset}
            side="left"
            isSelected={activeOrgan === 'liver'}
            cardWidth={cardWidth}
            compact={compact}
            onClick={() => onSelectOrgan?.('liver')}
          />
        </group>
      </mesh>

      {/* 3. THẬN (Kidneys) - Lumbar, set back (z<0) */}
      <group position={KIDNEY_GROUP_POS}>
        {/* Left Kidney (carries the tooltip) */}
        <mesh
          position={KIDNEY_L_LOCAL}
          onClick={(e) => { e.stopPropagation(); onSelectOrgan?.('kidneys'); }}
        >
          <sphereGeometry args={[0.075, 24, 24]} />
          <meshStandardMaterial
            color={kidneyTheme.color}
            emissive={kidneyTheme.emissive}
            emissiveIntensity={kidneyTheme.emissiveIntensity}
            roughness={0.2}
            transparent
            opacity={opacity}
          />
          {showKidneyTip && <Leader to={kidneyOffset} opacity={opacity} active={activeOrgan === 'kidneys'} />}
          <OrganTooltip
            name="Thận & Lọc Máu"
            metric={alerts.kidneys?.reason || 'eGFR: 95 mL/phút · Lọc máu tốt'}
            status={kidneySev}
            visible={showKidneyTip}
            offset={kidneyOffset}
            side="left"
            isSelected={activeOrgan === 'kidneys'}
            cardWidth={cardWidth}
            compact={compact}
            onClick={() => onSelectOrgan?.('kidneys')}
          />
        </mesh>
        {/* Right Kidney */}
        <mesh
          position={KIDNEY_R_LOCAL}
          onClick={(e) => { e.stopPropagation(); onSelectOrgan?.('kidneys'); }}
        >
          <sphereGeometry args={[0.075, 24, 24]} />
          <meshStandardMaterial
            color={kidneyTheme.color}
            emissive={kidneyTheme.emissive}
            emissiveIntensity={kidneyTheme.emissiveIntensity}
            roughness={0.2}
            transparent
            opacity={opacity}
          />
        </mesh>
      </group>

      {/* 4. TUYẾN TỤY & TIÊU HÓA (Pancreas / Stomach) - Lower abdomen */}
      <mesh
        position={PANCREAS_POS}
        onClick={(e) => { e.stopPropagation(); onSelectOrgan?.('pancreas'); }}
      >
        <sphereGeometry args={[0.085, 24, 24]} />
        <meshStandardMaterial
          color={pancreasTheme.color}
          emissive={pancreasTheme.emissive}
          emissiveIntensity={pancreasTheme.emissiveIntensity}
          roughness={0.25}
          transparent
          opacity={opacity}
        />
        {showPancreasTip && <Leader to={pancreasOffset} opacity={opacity} active={activeOrgan === 'pancreas'} />}
        <OrganTooltip
          name="Tuyến Tụy & Nội Tiết"
          metric={alerts.pancreas?.reason || 'Glucose đói 5.2 mmol/L · HbA1c 5.4%'}
          status={pancreasSev}
          visible={showPancreasTip}
          offset={pancreasOffset}
          side="right"
          isSelected={activeOrgan === 'pancreas'}
          cardWidth={cardWidth}
          compact={compact}
          onClick={() => onSelectOrgan?.('pancreas')}
        />
      </mesh>

      {/* 5. DẠ DÀY (Stomach) - [ADDED] left upper abdomen */}
      <mesh
        position={STOMACH_POS}
        scale={[1.15, 0.9, 0.9]}
        onClick={(e) => { e.stopPropagation(); onSelectOrgan?.('stomach'); }}
      >
        <sphereGeometry args={[0.085, 24, 24]} />
        <meshStandardMaterial
          color={stomachTheme.color}
          emissive={stomachTheme.emissive}
          emissiveIntensity={stomachTheme.emissiveIntensity}
          roughness={0.25}
          transparent
          opacity={opacity}
        />
        <group scale={[1 / 1.15, 1 / 0.9, 1 / 0.9]}>
          {showStomachTip && <Leader to={stomachOffset} opacity={opacity} active={activeOrgan === 'stomach'} />}
          <OrganTooltip
            name="Dạ dày & Tiêu hóa"
            metric={alerts.stomach?.reason || 'Niêm mạc tiêu hóa bình thường'}
            status={stomachSev}
            visible={showStomachTip}
            offset={stomachOffset}
            side="right"
            isSelected={activeOrgan === 'stomach'}
            cardWidth={cardWidth}
            compact={compact}
            onClick={() => onSelectOrgan?.('stomach')}
          />
        </group>
      </mesh>

      {/* 6. KHỚP (Knee joints / uric acid) - [ADDED] */}
      <mesh
        position={KNEE_L_POS}
        onClick={(e) => { e.stopPropagation(); onSelectOrgan?.('joints'); }}
      >
        <sphereGeometry args={[0.065, 20, 20]} />
        <meshStandardMaterial
          color={jointsTheme.color}
          emissive={jointsTheme.emissive}
          emissiveIntensity={jointsTheme.emissiveIntensity}
          roughness={0.25}
          transparent
          opacity={opacity}
        />
        {showJointsTip && <Leader to={jointsOffset} opacity={opacity} active={activeOrgan === 'joints'} />}
        <OrganTooltip
          name="Khớp & Acid Uric"
          metric={alerts.joints?.reason || 'Acid Uric 320 µmol/L · Khớp bình thường'}
          status={jointsSev}
          visible={showJointsTip}
          offset={jointsOffset}
          side="left"
          isSelected={activeOrgan === 'joints'}
          cardWidth={cardWidth}
          compact={compact}
          onClick={() => onSelectOrgan?.('joints')}
        />
      </mesh>
      <mesh
        position={KNEE_R_POS}
        onClick={(e) => { e.stopPropagation(); onSelectOrgan?.('joints'); }}
      >
        <sphereGeometry args={[0.065, 20, 20]} />
        <meshStandardMaterial
          color={jointsTheme.color}
          emissive={jointsTheme.emissive}
          emissiveIntensity={jointsTheme.emissiveIntensity}
          roughness={0.25}
          transparent
          opacity={opacity}
        />
      </mesh>
    </group>
  );
};

// ============================================================================
// 5. MICRO SCENE (CELLULAR & MOLECULAR VIEW)
// ============================================================================

interface MicroSceneProps {
  opacity: number;
}

const MicroScene: React.FC<MicroSceneProps> = ({ opacity }) => {
  const pointsRef = useRef<THREE.Points>(null);

  const [particlesPos] = useMemo(() => {
    const count = 350;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 4.2;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 4.2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4.2;
    }
    return [pos];
  }, []);

  useFrame((_, delta) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * 0.08;
      pointsRef.current.rotation.x += delta * 0.04;
    }
  });

  return (
    <group visible={opacity > 0.02}>
      {/* Floating Nano-particles */}
      <Points ref={pointsRef} positions={particlesPos} stride={3}>
        <PointMaterial
          transparent
          color="#38bdf8"
          size={0.04}
          sizeAttenuation
          depthWrite={false}
          opacity={opacity * 0.85}
        />
      </Points>

      {/* Center Molecular Complex (Hemoglobin Core & Erythrocyte) */}
      {/* [FIXED] the "Vi mô" preset camera sits at 1.3 -> the old 0.75-radius torus swallowed the whole
          viewport (only a red wall was visible). Scale it so the whole complex + label fit the frame. */}
      <Float speed={2.5} rotationIntensity={0.8} floatIntensity={0.5}>
        <group position={[0, 0, 0]} scale={0.42}>
          <mesh rotation={[Math.PI / 4, 0, 0]}>
            <torusGeometry args={[0.5, 0.25, 24, 48]} />
            <meshStandardMaterial
              color="#e11d48"
              emissive="#be123c"
              emissiveIntensity={0.6 * opacity}
              roughness={0.3}
              metalness={0.2}
              transparent
              opacity={opacity * 0.9}
            />
          </mesh>

          {/* Central Iron/Heme Core */}
          <mesh position={[0, 0, 0]}>
            <sphereGeometry args={[0.2, 24, 24]} />
            <meshStandardMaterial
              color="#fb7185"
              emissive="#fda4af"
              emissiveIntensity={1.0 * opacity}
              wireframe
              transparent
              opacity={opacity}
            />
          </mesh>

          {/* Drei HTML Molecular Indicator
              [FIXED] <group visible={false}> does NOT hide DOM overlays, so this card was
              floating (huge) over the body in the macro view. Mount it only in micro view. */}
          {opacity > 0.4 && (
            <Html distanceFactor={1.0} position={[0, 0.95, 0]} center zIndexRange={[10, 0]}>
              <div className="w-max max-w-none whitespace-nowrap backdrop-blur-md bg-white/95 border border-sky-300 rounded-xl px-2.5 py-1 text-center shadow-lg pointer-events-none">
                <div className="text-[10px] font-bold text-sky-900 font-mono">
                  CẤU TRÚC PHÂN TỬ HEMOGLOBIN & HỒNG CẦU
                </div>
                <div className="text-[8px] text-slate-500 font-mono">
                  Nồng độ Hb: 12.8 g/dL · Khả năng gắn Oxy: 98%
                </div>
              </div>
            </Html>
          )}
        </group>
      </Float>
    </group>
  );
};

// ============================================================================
// 6. LOD TRANSITION MANAGER (CAMERA DISTANCE TRACKING)
// ============================================================================

interface TransitionManagerProps {
  children: (macroOpacity: number, microOpacity: number) => React.ReactNode;
  onTransitionChange: (macroOpacity: number, microOpacity: number, distance: number) => void;
}

const TransitionManager: React.FC<TransitionManagerProps> = ({ children, onTransitionChange }) => {
  const [opacities, setOpacities] = useState({ macro: 1, micro: 0 });

  useFrame(({ camera }) => {
    const dist = camera.position.length();

    // Thresholds:
    // dist >= 3.4 -> Full Macro View (opacity 1.0)
    // 2.0 < dist < 3.4 -> Cross-fading transition
    // dist <= 2.0 -> Full Microscopic View (opacity 1.0)
    const MACRO_THRESHOLD = 3.4;
    const MICRO_THRESHOLD = 2.0;

    let macroOp = 0;
    let microOp = 0;

    if (dist >= MACRO_THRESHOLD) {
      macroOp = 1;
      microOp = 0;
    } else if (dist <= MICRO_THRESHOLD) {
      macroOp = 0;
      microOp = 1;
    } else {
      const progress = (dist - MICRO_THRESHOLD) / (MACRO_THRESHOLD - MICRO_THRESHOLD);
      macroOp = Math.sin((progress * Math.PI) / 2);
      microOp = Math.cos((progress * Math.PI) / 2);
    }

    if (
      Math.abs(opacities.macro - macroOp) > 0.02 ||
      Math.abs(opacities.micro - microOp) > 0.02
    ) {
      setOpacities({ macro: macroOp, micro: microOp });
    }

    onTransitionChange(macroOp, microOp, dist);
  });

  return <>{children(opacities.macro, opacities.micro)}</>;
};

// ============================================================================
// 7. MAIN EXPORT COMPONENT
// ============================================================================

export interface Medical3DViewerProps {
  alerts?: Record<OrganId, OrganMapping>;
  onSelectOrgan?: (organId: OrganId) => void;
  selectedOrganId?: OrganId | null;
  className?: string;
}

export function Medical3DViewer({
  alerts = {} as Record<OrganId, OrganMapping>,
  onSelectOrgan,
  selectedOrganId: extSelected,
  className = ''
}: Medical3DViewerProps) {
  const [internalSelected, setInternalSelected] = useState<OrganId | null>('kidneys');
  const activeOrgan = extSelected !== undefined ? extSelected : internalSelected;

  const [hudData, setHudData] = useState({
    macroOpacity: 1,
    microOpacity: 0,
    cameraDistance: 5.2,
  });

  const controlsRef = useRef<any>(null);

  const zoomTo = (distance: number) => {
    if (controlsRef.current) {
      const camera = controlsRef.current.object as THREE.PerspectiveCamera;
      camera.position.set(0, 0, distance);
      controlsRef.current.update();
    }
  };

  const handleSelect = (id: OrganId) => {
    setInternalSelected(id);
    if (onSelectOrgan) onSelectOrgan(id);
  };

  const isMicroMode = hudData.microOpacity > 0.5;

  return (
    <div className={`relative w-full h-[470px] select-none rounded-2xl bg-white/95 border border-slate-200 shadow-inner overflow-hidden ${className}`}>
      {/* --- HUD HEADER & LOD INDICATOR --- */}
      <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between gap-2 pointer-events-none">
        <div className="flex items-center gap-1.5 min-w-0 bg-white/90 backdrop-blur-md px-2.5 py-1 rounded-xl border border-slate-200 shadow-2xs">
          <span className={`w-2 h-2 rounded-full ${isMicroMode ? 'bg-sky-500 animate-pulse' : 'bg-teal-500'}`} />
          <span className="font-bold text-[11px] uppercase tracking-wider text-slate-800 truncate">
            {isMicroMode ? '🔬 Vi mô: Phân tử & Tế bào' : '🩺 Đại thể: Mô hình 3D Toàn thân'}
          </span>
          <span className="text-[10px] font-mono text-slate-500 font-semibold border-l border-slate-200 pl-1.5 ml-0.5">
            {hudData.cameraDistance.toFixed(1)}m
          </span>
        </div>

        {/* Quick Zoom Presets */}
        <div className="shrink-0 flex items-center gap-1 pointer-events-auto bg-white/95 backdrop-blur-md p-1 rounded-xl border border-slate-200 shadow-xs text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => zoomTo(5.2)}
            className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${!isMicroMode ? 'bg-teal-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
          >
            Đại thể
          </button>
          <button
            type="button"
            onClick={() => zoomTo(1.3)}
            className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${isMicroMode ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
          >
            Vi mô
          </button>
        </div>
      </div>

      {/* --- BOTTOM INSTRUCTION HINT --- */}
      <div className="hidden sm:block absolute bottom-2.5 left-3 z-20 pointer-events-none text-[10px] font-mono text-slate-500 bg-white/85 backdrop-blur-xs px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
        💡 Cuộn chuột phóng to xuyên qua cơ thể để chuyển sang cấp độ vi mô phân tử.
      </div>

      {/* --- WEBGL CANVAS --- */}
      <Canvas
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, 0, 5.2], fov: 42 }}
        style={{ background: 'transparent' }}
      >
        {/* [CHANGED] dark backdrop so the translucent blue hologram is actually visible */}
        <color attach="background" args={['#04122b']} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[5, 8, 5]} intensity={1.1} />
        <directionalLight position={[-5, -2, -4]} intensity={0.5} color="#38bdf8" />
        <pointLight position={[0, 0, 2]} intensity={0.4} color="#0284c7" />

        <OrbitControls
          ref={controlsRef}
          enablePan={false}
          minDistance={1.0}
          maxDistance={7.0}
          dampingFactor={0.06}
          rotateSpeed={0.7}
        />

        <TransitionManager
          onTransitionChange={(macroOp, microOp, dist) => {
            setHudData({
              macroOpacity: macroOp,
              microOpacity: microOp,
              cameraDistance: dist,
            });
          }}
        >
          {(macroOpacity, microOpacity) => (
            <>
              <MacroScene
                opacity={macroOpacity}
                alerts={alerts}
                activeOrgan={activeOrgan}
                onSelectOrgan={handleSelect}
              />
              <MicroScene opacity={microOpacity} />
            </>
          )}
        </TransitionManager>
      </Canvas>
    </div>
  );
}

export default Medical3DViewer;
