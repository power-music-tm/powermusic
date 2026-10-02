import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/** Power Music brand palette (normalized 0–1 for shaders). */
const BRAND = {
  primary: new THREE.Vector3(26 / 255, 26 / 255, 46 / 255),
  accent: new THREE.Vector3(233 / 255, 69 / 255, 96 / 255),
  secondary: new THREE.Vector3(44 / 255, 95 / 255, 143 / 255),
  deep: new THREE.Vector3(37 / 255, 37 / 255, 66 / 255),
};

class TouchTexture {
  constructor() {
    this.size = 64;
    this.width = 64;
    this.height = 64;
    this.maxAge = 64;
    this.radius = 0.1;
    this.speed = 1 / 64;
    this.trail = [];
    this.last = null;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.fillStyle = 'black';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture = new THREE.Texture(this.canvas);
  }

  update() {
    this.ctx.fillStyle = 'black';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (let i = this.trail.length - 1; i >= 0; i -= 1) {
      const p = this.trail[i];
      const f = p.force * this.speed * (1 - p.age / this.maxAge);
      p.x += p.vx * f;
      p.y += p.vy * f;
      p.age += 1;
      if (p.age > this.maxAge) this.trail.splice(i, 1);
      else this.drawPoint(p);
    }
    this.texture.needsUpdate = true;
  }

  addTouch(point) {
    let force = 0;
    let vx = 0;
    let vy = 0;
    if (this.last) {
      const dx = point.x - this.last.x;
      const dy = point.y - this.last.y;
      if (dx === 0 && dy === 0) return;
      const d = Math.sqrt(dx * dx + dy * dy);
      vx = dx / d;
      vy = dy / d;
      force = Math.min((dx * dx + dy * dy) * 20000, 2.0);
    }
    this.last = { x: point.x, y: point.y };
    this.trail.push({ x: point.x, y: point.y, age: 0, force, vx, vy });
  }

  drawPoint(p) {
    const pos = { x: p.x * this.width, y: (1 - p.y) * this.height };
    let intensity =
      p.age < this.maxAge * 0.3
        ? Math.sin((p.age / (this.maxAge * 0.3)) * (Math.PI / 2))
        : -(
            (1 - (p.age - this.maxAge * 0.3) / (this.maxAge * 0.7)) *
            ((1 - (p.age - this.maxAge * 0.3) / (this.maxAge * 0.7)) - 2)
          );
    intensity *= p.force;
    const color = `${((p.vx + 1) / 2) * 255}, ${((p.vy + 1) / 2) * 255}, ${intensity * 255}`;
    const radius = this.radius * this.width;
    this.ctx.shadowOffsetX = this.size * 5;
    this.ctx.shadowOffsetY = this.size * 5;
    this.ctx.shadowBlur = radius;
    this.ctx.shadowColor = `rgba(${color},${0.2 * intensity})`;
    this.ctx.beginPath();
    this.ctx.fillStyle = 'rgba(255,0,0,1)';
    this.ctx.arc(pos.x - this.size * 5, pos.y - this.size * 5, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }
}

class GradientBackground {
  constructor(sceneManager) {
    this.mesh = null;
    this.sceneManager = sceneManager;
    this.isPaused = false;
    this.uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uColor1: { value: BRAND.accent.clone() },
      uColor2: { value: BRAND.primary.clone() },
      uColor3: { value: BRAND.accent.clone() },
      uColor4: { value: BRAND.secondary.clone() },
      uColor5: { value: BRAND.accent.clone() },
      uColor6: { value: BRAND.deep.clone() },
      uSpeed: { value: 1.0 },
      uIntensity: { value: 1.18 },
      uTouchTexture: { value: null },
      uGrainIntensity: { value: 0.05 },
      uDarkNavy: { value: BRAND.primary.clone() },
      uGradientSize: { value: 0.5 },
      uGradientCount: { value: 12.0 },
      uColor1Weight: { value: 0.52 },
      uColor2Weight: { value: 1.28 },
    };
  }

  init() {
    const viewSize = this.sceneManager.getViewSize();
    const geometry = new THREE.PlaneGeometry(viewSize.width, viewSize.height, 1, 1);
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `varying vec2 vUv; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); vUv = uv; }`,
      fragmentShader: `
        uniform float uTime, uSpeed, uIntensity, uGrainIntensity, uGradientSize, uGradientCount, uColor1Weight, uColor2Weight;
        uniform vec2 uResolution;
        uniform vec3 uColor1, uColor2, uColor3, uColor4, uColor5, uColor6, uDarkNavy;
        uniform sampler2D uTouchTexture;
        varying vec2 vUv;

        float grain(vec2 uv, float t) {
          return fract(sin(dot(uv * uResolution * 0.5 + t, vec2(12.9898, 78.233))) * 43758.5453) * 2.0 - 1.0;
        }

        vec3 getGradientColor(vec2 uv, float time) {
          vec2 c1 = vec2(0.5 + sin(time * uSpeed * 0.4) * 0.4, 0.5 + cos(time * uSpeed * 0.5) * 0.4);
          vec2 c2 = vec2(0.5 + cos(time * uSpeed * 0.6) * 0.5, 0.5 + sin(time * uSpeed * 0.45) * 0.5);
          vec2 c3 = vec2(0.5 + sin(time * uSpeed * 0.35) * 0.45, 0.5 + cos(time * uSpeed * 0.55) * 0.45);
          vec2 c4 = vec2(0.5 + cos(time * uSpeed * 0.5) * 0.4, 0.5 + sin(time * uSpeed * 0.4) * 0.4);
          vec2 c5 = vec2(0.5 + sin(time * uSpeed * 0.7) * 0.35, 0.5 + cos(time * uSpeed * 0.6) * 0.35);
          vec2 c6 = vec2(0.5 + cos(time * uSpeed * 0.45) * 0.5, 0.5 + sin(time * uSpeed * 0.65) * 0.5);

          float i1 = 1.0 - smoothstep(0.0, uGradientSize, length(uv - c1));
          float i2 = 1.0 - smoothstep(0.0, uGradientSize, length(uv - c2));
          float i3 = 1.0 - smoothstep(0.0, uGradientSize, length(uv - c3));
          float i4 = 1.0 - smoothstep(0.0, uGradientSize, length(uv - c4));
          float i5 = 1.0 - smoothstep(0.0, uGradientSize, length(uv - c5));
          float i6 = 1.0 - smoothstep(0.0, uGradientSize, length(uv - c6));

          vec3 color = vec3(0.0);
          color += uColor1 * i1 * (0.55 + 0.45 * sin(time * uSpeed)) * uColor1Weight;
          color += uColor2 * i2 * (0.55 + 0.45 * cos(time * uSpeed * 1.2)) * uColor2Weight;
          color += uColor3 * i3 * (0.55 + 0.45 * sin(time * uSpeed * 0.8)) * uColor1Weight;
          color += uColor4 * i4 * (0.55 + 0.45 * cos(time * uSpeed * 1.3)) * uColor2Weight;
          color += uColor5 * i5 * (0.55 + 0.45 * sin(time * uSpeed * 1.1)) * uColor1Weight;
          color += uColor6 * i6 * (0.55 + 0.45 * cos(time * uSpeed * 0.9)) * uColor2Weight;

          color = clamp(color * uIntensity, vec3(0.0), vec3(1.0));

          // Cap luminance so overlapping blobs never blow out to white.
          float lum = dot(color, vec3(0.299, 0.587, 0.114));
          float maxLum = 0.6;
          if (lum > maxLum) {
            color *= maxLum / lum;
          }

          color = mix(uDarkNavy, color, smoothstep(0.05, 0.65, lum));
          color = pow(color, vec3(1.06));
          return color;
        }

        void main() {
          vec2 uv = vUv;
          vec4 touchTex = texture2D(uTouchTexture, uv);
          uv.x -= (touchTex.r * 2.0 - 1.0) * 0.35 * touchTex.b;
          uv.y -= (touchTex.g * 2.0 - 1.0) * 0.35 * touchTex.b;
          vec2 center = vec2(0.5);
          float dist = length(uv - center);
          float ripple = sin(dist * 20.0 - uTime * 3.0) * 0.02 * touchTex.b;
          uv += vec2(ripple);
          vec3 color = getGradientColor(uv, uTime);
          color += grain(uv, uTime) * uGrainIntensity;
          color = clamp(color, vec3(0.0), vec3(0.78));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.sceneManager.scene.add(this.mesh);
  }

  update(delta) {
    if (!this.isPaused) this.uniforms.uTime.value += delta;
  }

  onResize(w, h) {
    const viewSize = this.sceneManager.getViewSize();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = new THREE.PlaneGeometry(viewSize.width, viewSize.height, 1, 1);
    }
    this.uniforms.uResolution.value.set(w, h);
  }
}

class GradientApp {
  constructor(container, { interactive = false } = {}) {
    this.container = container;
    this.interactive = interactive;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      10000,
    );
    this.camera.position.z = 50;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.clock = new THREE.Clock();
    this.touchTexture = new TouchTexture();
    this.gradientBackground = new GradientBackground(this);
    this.gradientBackground.uniforms.uTouchTexture.value = this.touchTexture.texture;
    this.animationId = null;
    this.resizeObserver = null;
    this.onMove = this.onMove.bind(this);
    this.onResize = this.onResize.bind(this);
    this.init();
  }

  getViewSize() {
    const fov = (this.camera.fov * Math.PI) / 180;
    const height = Math.abs(this.camera.position.z * Math.tan(fov / 2) * 2);
    return { width: height * this.camera.aspect, height };
  }

  onMove(x, y) {
    this.touchTexture.addTouch({
      x: x / this.container.clientWidth,
      y: 1 - y / this.container.clientHeight,
    });
  }

  init() {
    this.gradientBackground.init();
    if (this.interactive) {
      this.container.addEventListener('mousemove', (e) => this.onMove(e.offsetX, e.offsetY));
      this.container.addEventListener(
        'touchmove',
        (e) => {
          const rect = this.container.getBoundingClientRect();
          this.onMove(e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top);
        },
        { passive: true },
      );
    }
    window.addEventListener('resize', this.onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this.container);
    }
    this.onResize();
    this.tick();
  }

  onResize() {
    const { clientWidth, clientHeight } = this.container;
    if (!clientWidth || !clientHeight) return;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
    this.gradientBackground.onResize(clientWidth, clientHeight);
  }

  setPaused(paused) {
    this.gradientBackground.isPaused = paused;
  }

  tick() {
    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.touchTexture.update();
    this.gradientBackground.update(delta);
    this.renderer.render(this.scene, this.camera);
    this.animationId = requestAnimationFrame(() => this.tick());
  }

  cleanup() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
    if (
      this.container &&
      this.renderer.domElement &&
      this.container.contains(this.renderer.domElement)
    ) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

/**
 * Full-bleed animated brand gradient — used behind manager auth screens.
 */
export function FlowGradientBackground({ className = '', interactive = false }) {
  const containerRef = useRef(null);
  const appRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    appRef.current = new GradientApp(container, { interactive: !reducedMotion && interactive });
    if (reducedMotion) appRef.current.setPaused(true);

    return () => {
      appRef.current?.cleanup();
      appRef.current = null;
    };
  }, [interactive]);

  return (
    <div className={`${className}`.trim()} aria-hidden="true">
      <div ref={containerRef} className="h-full min-h-full w-full" />
    </div>
  );
}

export default FlowGradientBackground;
export { FlowGradientBackground as Component };
