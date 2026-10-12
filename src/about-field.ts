// The about page's 3D backdrop: a field of dots behind the phone, rippling like a signal that goes still
// around it ("no signal needed"). three.js WebGPURenderer with TSL; three falls back to WebGL 2 by itself.
// Decorative only: about.ts loads this lazily and only when motion and data allow, and the page looks
// complete without it (the static dotted backdrop stays). Verified against three r186.
import * as THREE from "three/webgpu";
import { Fn, cos, exp, float, floor, instanceIndex, length, mix, smoothstep, sin, time, uv, vec2, vec3 } from "three/tsl";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export interface Field { stop(): void }

/** Starts the field in `host` (a positioned box). Throws if neither WebGPU nor WebGL 2 is available. */
export async function startField(host: HTMLElement): Promise<Field> {
  // Wide screens only (about.ts): 120 x 64 dots, about 7,700 sprites.
  const [cols, rows] = [120, 64];
  const spacing = 0.3;

  const renderer = new THREE.WebGPURenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  // Opaque, in the page's own colour: the CSS mask on the host fades the edges into the page.
  renderer.setClearColor(new THREE.Color(css("--sheet")), 1);
  const canvas: HTMLCanvasElement = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
  // Low and close, so the field spreads out under the phone and recedes to a soft horizon behind it.
  camera.position.set(0, 2.4, 7.5);
  camera.lookAt(0, 0.4, -2.5);

  // Each instance is one dot; its place on the grid comes from its index, so there's no buffer to upload.
  const i = float(instanceIndex);
  const gx = i.mod(cols).sub((cols - 1) / 2).mul(spacing);
  const gz = floor(i.div(cols)).sub(rows - 6).mul(spacing);
  const r = length(vec2(gx, gz));
  // Rings travel inwards and fade out before they reach the phone in the middle.
  const calm = smoothstep(1.1, 3.4, r);
  const ring = sin(r.mul(1.35).add(time.mul(1.6)));
  const swell = sin(gx.mul(0.45).add(time.mul(0.5))).mul(cos(gz.mul(0.38).sub(time.mul(0.4))));
  const height = ring.mul(0.28).add(swell.mul(0.12)).mul(calm).mul(exp(r.mul(-0.06)));

  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  material.positionNode = vec3(gx, height, gz);
  material.scaleNode = float(0.055);
  const accent = new THREE.Color(css("--accent"));
  const ink = new THREE.Color(css("--ink"));
  const crest = smoothstep(0.05, 0.3, height);
  material.colorNode = mix(vec3(accent.r, accent.g, accent.b), vec3(ink.r, ink.g, ink.b), crest.mul(0.35));
  // Round dots, brighter on the crests, fading with distance and towards the still middle.
  material.opacityNode = Fn(() => {
    const dot = smoothstep(0.5, 0.36, length(uv().sub(0.5)));
    const fade = exp(r.mul(-0.11)).mul(calm.mul(0.75).add(0.25));
    const front = smoothstep(1.6, 0.4, gz); // the nearest rows fade out instead of ending in a hard edge
    return dot.mul(fade).mul(float(0.38).add(crest.mul(0.5))).mul(front);
  })();

  const dots = new THREE.Sprite(material);
  dots.count = cols * rows;
  dots.frustumCulled = false;
  scene.add(dots);

  const resize = () => {
    const { width, height: h } = host.getBoundingClientRect();
    renderer.setSize(Math.max(1, width), Math.max(1, h), false);
    camera.aspect = width / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  resize();
  const sizing = new ResizeObserver(resize);
  sizing.observe(host);

  await renderer.init();
  const render = () => renderer.render(scene, camera);
  // Draw only while the hero is on screen; time (and the waves) advance only inside the animation loop.
  let running = false;
  const play = (on: boolean) => {
    if (on === running) return;
    running = on;
    renderer.setAnimationLoop(on ? render : null);
  };
  const seen = new IntersectionObserver(([entry]) => play(entry.isIntersecting));
  seen.observe(host);
  render();

  return {
    stop() {
      seen.disconnect();
      sizing.disconnect();
      play(false);
      material.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
