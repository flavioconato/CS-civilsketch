import * as THREE from 'three';
import { OrbitLite } from './controls';
import { SLOPE_COLORS } from '../core/config';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export interface TerrainUniforms {
  uZBase: { value: number };
  uExag: { value: number };
  uContour: { value: number };
  uStep: { value: number };
  uSlope: { value: number };
  uZmin: { value: number };
  uZmax: { value: number };
  uLo: { value: THREE.Color };
  uHi: { value: THREE.Color };
  uLine: { value: THREE.Color };
  uB: { value: THREE.Vector4 };
  uC0: { value: THREE.Color };
  uC1: { value: THREE.Color };
  uC2: { value: THREE.Color };
  uC3: { value: THREE.Color };
  uC4: { value: THREE.Color };
  uGrid: { value: number };
  uGridStep: { value: number };
  uGridColor: { value: THREE.Color };
}

/**
 * Contesto three.js: renderer, scena, camera, controlli, luci e il materiale del terreno
 * (con isoipse e mappa delle pendenze iniettate via onBeforeCompile). Un solo contesto per app.
 */
export class ThreeContext {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.5, 20000);
  controls: OrbitLite;
  terrainMat: THREE.MeshStandardMaterial;
  uniforms: TerrainUniforms;
  terrainGroup: THREE.Group | null = null;
  markerGroup = new THREE.Group();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.camera.position.set(300, 300, 300);
    this.controls = new OrbitLite(this.camera, this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xeef3ff, 0x4a4a3c, 0.5));
    const sun = new THREE.DirectionalLight(0xfff6e8, 0.62);
    sun.position.set(-0.6, 1, -0.45);
    this.scene.add(sun);
    this.scene.add(this.markerGroup);

    this.uniforms = {
      uZBase: { value: 0 }, uExag: { value: 1 }, uContour: { value: 1 }, uStep: { value: 5 },
      uSlope: { value: 0 }, uZmin: { value: 0 }, uZmax: { value: 1 },
      uLo: { value: new THREE.Color() }, uHi: { value: new THREE.Color() }, uLine: { value: new THREE.Color() },
      uB: { value: new THREE.Vector4(10, 30, 50, 100) },
      uC0: { value: new THREE.Color(SLOPE_COLORS[0]) }, uC1: { value: new THREE.Color(SLOPE_COLORS[1]) },
      uC2: { value: new THREE.Color(SLOPE_COLORS[2]) }, uC3: { value: new THREE.Color(SLOPE_COLORS[3]) },
      uC4: { value: new THREE.Color(SLOPE_COLORS[4]) },
      uGrid: { value: 0 }, uGridStep: { value: 0.5 }, uGridColor: { value: new THREE.Color() },
    };

    this.terrainMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    this.terrainMat.onBeforeCompile = (sh: THREE.WebGLProgramParametersWithUniforms) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\nvWNorm = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNorm;
uniform float uZBase, uExag, uContour, uStep, uSlope, uZmin, uZmax, uGrid, uGridStep;
uniform vec3 uLo, uHi, uLine, uC0, uC1, uC2, uC3, uC4, uGridColor;
uniform vec4 uB;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  float zr = vWPos.y / uExag + uZBase;
  vec3 base;
  if (uSlope > 0.5) {
    vec3 n = normalize(vWNorm);
    float s = length(n.xz) / max(abs(n.y), 1e-4) / uExag * 100.0;
    base = s < uB.x ? uC0 : s < uB.y ? uC1 : s < uB.z ? uC2 : s < uB.w ? uC3 : uC4;
  } else {
    float t = clamp((zr - uZmin) / max(uZmax - uZmin, 1.0), 0.0, 1.0);
    base = mix(uLo, uHi, smoothstep(0.0, 1.0, t));
  }
  if (uContour > 0.5) {
    float f = zr / uStep;
    float w = fwidth(f);
    float d = abs(fract(f - 0.5) - 0.5) / max(w, 1e-5);
    float line = 1.0 - min(d, 1.0);
    float fm = zr / (uStep * 5.0);
    float dm = abs(fract(fm - 0.5) - 0.5) / max(fwidth(fm), 1e-5);
    float major = 1.0 - min(dm / 1.4, 1.0);
    float fade = 1.0 - smoothstep(0.25, 0.6, w);
    base = mix(base, uLine, max(line * 0.28, major * 0.5) * fade);
  }
  if (uGrid > 0.5) {
    vec2 g = vWPos.xz / uGridStep;
    vec2 gw = fwidth(g);
    vec2 gd = abs(fract(g - 0.5) - 0.5) / max(gw, vec2(1e-5));
    float gridLine = 1.0 - min(min(gd.x, gd.y), 1.0);
    float gfade = 1.0 - smoothstep(0.25, 0.6, max(gw.x, gw.y));
    base = mix(base, uGridColor, gridLine * 0.4 * gfade);
  }
  diffuseColor.rgb = base;
}`);
    };

    this.applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    new MutationObserver(() => this.applyTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  applyTheme(): void {
    const bg = new THREE.Color(cssVar('--scene'));
    this.scene.background = bg;
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color = bg;
    this.uniforms.uLo.value.set(cssVar('--terrain-lo'));
    this.uniforms.uHi.value.set(cssVar('--terrain-hi'));
    this.uniforms.uLine.value.set(cssVar('--contour'));
    this.uniforms.uGridColor.value.set(cssVar('--accent'));
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
