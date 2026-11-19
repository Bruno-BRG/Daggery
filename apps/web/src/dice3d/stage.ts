import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { cachedAtlas, cachedBumpAtlas } from './atlas';
import { buildBevelledMesh } from './bevel';
import { DEFAULT_APPEARANCE, mixHex, paletteFor, type DiceAppearance, type DiceFinish } from './appearance';
import { upwardResult } from './landing';
import { MAX_TRAY_DICE, type DieRequest } from './rollPlan';
import { getDieShape, type DieShape } from './shapes';
import { DIE_RADIUS, PHYSICS_STEP, type Bounds, type PreparedThrow } from './simulation';
import { prepareThrowOffThread } from './simulationClient';
import { FADE_MS, HOLD_MS, REDUCED_MOTION_SECONDS } from './motion';
import { getDiceQuality, type DiceQuality } from './quality';

export interface TrayRect { left: number; top: number; right: number; bottom: number }
export const DEFAULT_TRAY_RECT: TrayRect = { left: .08, top: .32, right: .92, bottom: .94 };
/** Lifecycle hooks: onIdle fires once the last dice have faded, and onLost fires if the WebGL context is lost. */
export interface StageHooks { onIdle?: () => void; onLost?: () => void }
type DieMaterial = THREE.MeshPhysicalMaterial;
type RingMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
interface Die {
  request: DieRequest; shape: DieShape; mesh: THREE.Mesh<THREE.BufferGeometry, DieMaterial>;
  material: DieMaterial; halo?: THREE.Sprite; settleRing?: RingMesh;
}
/** A ring on the floor where a die hit hard. It plays at `time` physics seconds into the throw. */
interface ImpactRing { mesh: RingMesh; time: number; strength: number }

/** Where the camera rests. A throw starts a little further back and pushes in. */
const CAMERA_REST = new THREE.Vector3(0, 16, 4.3);
/** Seconds a roll is stretched to on screen. The physics runs faster or slower to fit. */
const THROW_SCREEN_SECONDS = 2.9;
const IMPACT_RING_SECONDS = 0.5;
const SETTLE_RING_SECONDS = 0.9;
const MAX_IMPACT_RINGS = 14;

/** Surface look for each finish. Every die gets a clear coat except matte, which is what makes resin look like resin. */
const FINISHES: Record<DiceFinish, THREE.MeshPhysicalMaterialParameters> = {
  polished: { roughness: .3, metalness: .04, clearcoat: 1, clearcoatRoughness: .05, envMapIntensity: 1 },
  matte: { roughness: .8, metalness: 0, clearcoat: 0, envMapIntensity: .5 },
  metal: { roughness: .26, metalness: .9, clearcoat: .35, clearcoatRoughness: .18, envMapIntensity: 1.35 },
  pearl: { roughness: .34, metalness: .08, clearcoat: 1, clearcoatRoughness: .05, iridescence: 1, iridescenceIOR: 1.5, iridescenceThicknessMinimum: 180, iridescenceThicknessMaximum: 520, sheen: .7, sheenRoughness: .4, sheenColor: new THREE.Color('#ffffff'), envMapIntensity: 1.1 },
  marble: { roughness: .22, metalness: .02, clearcoat: 1, clearcoatRoughness: .04, envMapIntensity: 1.05 },
};

/** Pearl's iridescence and sheen are the costliest parts of a die's shader. Light quality leaves them out. */
function finishFor(finish: DiceFinish, fancy: boolean): THREE.MeshPhysicalMaterialParameters {
  const { iridescence: _i, iridescenceIOR: _o, iridescenceThicknessMinimum: _a, iridescenceThicknessMaximum: _b, sheen: _s, sheenRoughness: _r, sheenColor: _c, ...plain } = FINISHES[finish];
  return fancy ? FINISHES[finish] : plain;
}

/**
 * Resolution while dice move is adaptive. The stage times its frames: when they run slower than SLOW_MS it draws
 * fewer pixels, and when they run fast it draws more. What it learns is kept for the next roll on this page.
 */
const SLOW_MS = 23;
const FAST_MS = 17.5;
const SAMPLE_FRAMES = 14;
let learnedMoveRatio: number | null = null;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
interface Job { requests: DieRequest[]; appearance: DiceAppearance; resolve: ()=>void; reject: (reason: Error)=>void }
interface ActiveJob { job: Job; motion: PreparedThrow; elapsed: number }

/** Exact playback of a precomputed physical throw. No visible face correction after landing. */
export class DiceStage {
  readonly kind = 'three' as const;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36,1,.1,200);
  private readonly resizeObserver: ResizeObserver;
  private readonly quality: DiceQuality = getDiceQuality();
  private dirty = true;
  private pumpScheduled = false;
  /** The job whose throw is being simulated off the page's thread. */
  private preparing: Job | null = null;
  private moveRatio = Math.min(learnedMoveRatio ?? this.quality.moveRatio, this.quality.moveRatio);
  private ratio = this.moveRatio;
  private frameSamples = 0;
  private frameMs = 0;
  private fastStreak = 0;
  private readonly shadowFloor: THREE.Mesh;
  private readonly geometries = new Map<number,THREE.BufferGeometry>();
  private readonly baseMaterials = new Map<string,DieMaterial>();
  private readonly haloTexture: THREE.CanvasTexture;
  private readonly ringTexture: THREE.CanvasTexture;
  private readonly ringGeometry = new THREE.PlaneGeometry(1,1);
  private readonly environment: THREE.Texture;
  private readonly impactRings: ImpactRing[] = [];
  private readonly sparks: THREE.Points<THREE.BufferGeometry,THREE.PointsMaterial>;
  private readonly sparkPositions = new Float32Array(MAX_TRAY_DICE*18*3);
  private readonly sparkColors = new Float32Array(MAX_TRAY_DICE*18*3);
  private readonly dice: Die[] = [];
  private readonly queue: Job[] = [];
  private bounds: Bounds = { minX:-4,maxX:4,minZ:-3,maxZ:3 };
  private active: ActiveJob | null = null;
  private frameId = 0;
  private lastFrame = 0;
  private holdUntil = 0;
  private fadeStart: number | null = null;
  private disposed = false;
  private materialStyle = '';
  private rollsStarted = 0;
  private rollsCompleted = 0;
  private effect: DiceAppearance['effect'] = 'none';
  private settledAt = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly container: HTMLElement, private readonly rect: TrayRect, private readonly hooks: StageHooks = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.dataset.diceStage = 'true';
    this.canvas.dataset.rollState = 'idle';
    this.canvas.dataset.rollsStarted = '0';
    this.canvas.dataset.rollsCompleted = '0';
    this.renderer = new THREE.WebGLRenderer({ canvas:this.canvas,alpha:true,antialias:true,premultipliedAlpha:true });
    this.renderer.setClearColor(0x000000,0);
    // Neutral tone mapping keeps the colours the player picked, where filmic curves would wash them out.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = .92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The shadow map is drawn only while dice move. A resting scene keeps the last one.
    this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = true;
    Object.assign(this.canvas.style,{display:'block',width:'100%',height:'100%'});
    container.appendChild(this.canvas);
    // A lost context cannot draw again. Report it, so the tray moves future rolls to flat dice.
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    // Look down at the table from 15 degrees off vertical, retaining a little depth.
    this.placeCamera(0,0,0);
    // A small studio room gives the clear coat and the metal something to reflect.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(),0.04,0.1,100,{size:this.quality.envSize}).texture;
    pmrem.dispose();
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = .62;
    const hemisphere = new THREE.HemisphereLight(0xffffff,0x3b3550,.3);
    const sun = new THREE.DirectionalLight(0xfff4e0,1.7);
    sun.position.set(-5,14,6); sun.castShadow = true; sun.shadow.mapSize.set(this.quality.shadowMapSize,this.quality.shadowMapSize); sun.shadow.radius = 3;
    Object.assign(sun.shadow.camera,{left:-10,right:10,top:10,bottom:-10,near:1,far:40});
    sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -.0006; sun.shadow.normalBias = .02;
    // A cool light from behind picks out every bevelled edge.
    const rim = new THREE.DirectionalLight(0xaecbff,1.1);
    rim.position.set(7,6,-9);
    this.scene.add(hemisphere,sun,sun.target,rim);
    this.shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.ShadowMaterial({opacity:.3}));
    this.shadowFloor.rotation.x = -Math.PI/2; this.shadowFloor.receiveShadow = true; this.scene.add(this.shadowFloor);

    const haloCanvas = document.createElement('canvas'); haloCanvas.width = haloCanvas.height = 64;
    const ctx = haloCanvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,'rgba(255,255,255,.7)'); gradient.addColorStop(.25,'rgba(255,255,255,.3)'); gradient.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0,0,64,64);
    this.haloTexture = new THREE.CanvasTexture(haloCanvas);
    const ringCanvas = document.createElement('canvas'); ringCanvas.width = ringCanvas.height = 128;
    const ringContext = ringCanvas.getContext('2d')!;
    const ringGradient = ringContext.createRadialGradient(64,64,30,64,64,63);
    ringGradient.addColorStop(0,'rgba(255,255,255,0)'); ringGradient.addColorStop(.55,'rgba(255,255,255,.95)'); ringGradient.addColorStop(.72,'rgba(255,255,255,.3)'); ringGradient.addColorStop(1,'rgba(255,255,255,0)');
    ringContext.fillStyle = ringGradient; ringContext.fillRect(0,0,128,128);
    this.ringTexture = new THREE.CanvasTexture(ringCanvas);
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute('position',new THREE.BufferAttribute(this.sparkPositions,3));
    sparkGeometry.setAttribute('color',new THREE.BufferAttribute(this.sparkColors,3));
    sparkGeometry.setDrawRange(0,0);
    this.sparks = new THREE.Points(sparkGeometry,new THREE.PointsMaterial({size:.13,map:this.haloTexture,transparent:true,vertexColors:true,blending:THREE.AdditiveBlending,depthWrite:false}));
    this.sparks.frustumCulled = false; this.scene.add(this.sparks);
    this.resizeObserver = new ResizeObserver(()=>this.resize());
    this.resizeObserver.observe(container); this.resize();
  }

  enqueue(requests: DieRequest[], appearance: DiceAppearance = DEFAULT_APPEARANCE): Promise<void> {
    return new Promise((resolve, reject)=>{
      if (this.disposed || !requests.length) { resolve(); return; }
      this.queue.push({requests:requests.slice(0,MAX_TRAY_DICE),appearance,resolve,reject}); this.schedulePump();
    });
  }

  /** Rejects the rolls still waiting here, so the tray can replay them flat, then releases the GPU. */
  abort(reason: Error): void {
    if (this.disposed) return;
    const pending = this.active ? [this.active.job] : this.preparing ? [this.preparing] : [];
    pending.push(...this.queue.splice(0));
    this.active = null; this.preparing = null;
    this.dispose();
    pending.forEach(job=>job.reject(reason));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frameId); this.resizeObserver.disconnect();
    this.active?.job.resolve(); this.active = null; this.preparing?.resolve(); this.preparing = null;
    this.queue.splice(0).forEach(job=>job.resolve()); this.clearDice();
    this.geometries.forEach(g=>g.dispose()); this.clearMaterials();
    this.haloTexture.dispose(); this.ringTexture.dispose(); this.ringGeometry.dispose(); this.environment.dispose(); this.sparks.geometry.dispose(); this.sparks.material.dispose();
    this.shadowFloor.geometry.dispose(); (this.shadowFloor.material as THREE.Material).dispose();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.dispose();
    // A context the browser already lost is released; asking for another loss only logs a warning.
    if (!this.renderer.getContext().isContextLost()) this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  /** Sets how many device pixels the canvas draws per CSS pixel. The device's own ratio is the ceiling. */
  private applyRatio(ratio: number, width = Math.max(1,this.container.clientWidth), height = Math.max(1,this.container.clientHeight)): void {
    this.ratio = Math.min(window.devicePixelRatio||1,ratio);
    this.renderer.setPixelRatio(this.ratio); this.renderer.setSize(width,height,false);
    this.dirty = true;
  }

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1,this.container.clientWidth), height = Math.max(1,this.container.clientHeight);
    this.applyRatio(this.ratio,width,height);
    this.camera.aspect = width/height; this.camera.updateProjectionMatrix(); this.placeCamera(0,0,0); this.camera.updateMatrixWorld();
    const floor = new THREE.Plane(new THREE.Vector3(0,1,0),0), ray = new THREE.Raycaster(), hit = new THREE.Vector3();
    const {left,top,right,bottom} = this.rect;
    const bounds = {minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
    for (const [x,y] of [[left,top],[right,top],[right,bottom],[left,bottom]]) {
      ray.setFromCamera(new THREE.Vector2(x!*2-1,1-y!*2),this.camera);
      if (!ray.ray.intersectPlane(floor,hit)) continue;
      bounds.minX = Math.min(bounds.minX,hit.x); bounds.maxX = Math.max(bounds.maxX,hit.x);
      bounds.minZ = Math.min(bounds.minZ,hit.z); bounds.maxZ = Math.max(bounds.maxZ,hit.z);
    }
    if (Number.isFinite(bounds.minX)) {
      this.bounds = bounds;
      // The shadow catcher only has to cover where the dice can land, not the whole screen: its pixels all run a shader.
      this.shadowFloor.scale.set(bounds.maxX-bounds.minX+6,bounds.maxZ-bounds.minZ+6,1);
      this.shadowFloor.position.set((bounds.minX+bounds.maxX)/2,0,(bounds.minZ+bounds.maxZ)/2);
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.render();
  }

  /**
   * The throw is simulated once, up front, which takes a moment on a tablet. Starting it a frame later lets the tap
   * that asked for it paint first (the button, the summary) instead of freezing while the physics runs.
   */
  private schedulePump(): void {
    if (this.pumpScheduled || this.active || this.preparing || this.disposed) return;
    this.pumpScheduled = true;
    requestAnimationFrame(() => { this.pumpScheduled = false; this.pump(); });
  }

  /** True when no roll is playing or waiting and no die is on screen, so the stage can be released. */
  get idle(): boolean { return !this.active && !this.preparing && this.queue.length === 0 && this.dice.length === 0; }

  private pump(): void {
    if (this.active || this.preparing || this.disposed) return;
    const job = this.queue.shift(); if (!job) return;
    this.preparing = job;
    this.canvas.style.visibility = 'visible';
    // Moving dice are drawn at the adaptive ratio. The sharp, resting ratio comes back when they stop.
    if (this.ratio !== this.moveRatio) this.applyRatio(this.moveRatio);
    prepareThrowOffThread(job.requests,this.bounds).then(motion=>{
      if (this.disposed || this.preparing !== job) return;
      this.preparing = null; this.start(job,motion);
    },(error: unknown)=>{
      if (this.disposed || this.preparing !== job) return;
      this.preparing = null; job.reject(error instanceof Error ? error : new Error(String(error))); this.pump();
    });
  }

  private start(job: Job, motion: PreparedThrow): void {
    this.dirty = true; this.frameSamples = 0; this.frameMs = 0; this.fastStreak = 0;
    this.clearDice();
    const style = JSON.stringify(job.appearance);
    if (style !== this.materialStyle) { this.clearMaterials(); this.materialStyle = style; }
    this.effect = this.reducedMotion.matches ? 'none' : job.appearance.effect;
    job.requests.forEach(request=>{
      const shape = getDieShape(request.sides), material = this.baseMaterial(shape,request,job.appearance).clone();
      material.transparent = true;
      const mesh = new THREE.Mesh(this.geometryFor(shape),material); mesh.castShadow = true; this.scene.add(mesh);
      const die: Die = {request,shape,mesh,material};
      if (this.effect !== 'none') {
        const color = paletteFor(request.colorway,job.appearance).body;
        die.halo = new THREE.Sprite(new THREE.SpriteMaterial({map:this.haloTexture,color,transparent:true,opacity:.5,blending:THREE.AdditiveBlending,depthWrite:false}));
        die.halo.scale.setScalar(DIE_RADIUS*3.5); this.scene.add(die.halo);
      }
      this.dice.push(die);
    });
    if (!this.reducedMotion.matches) for (const impact of motion.impacts.slice(0,MAX_IMPACT_RINGS)) {
      const ring = this.makeRing(mixHex('#ffffff',paletteFor(job.requests[0]!.colorway,job.appearance).body,.25));
      ring.mesh.position.set(impact.x,.02,impact.z);
      this.impactRings.push({mesh:ring.mesh,time:impact.time,strength:impact.strength});
    }
    this.active = {job,motion,elapsed:0};
    this.canvas.dataset.rollState = 'rolling'; this.canvas.dataset.rollsStarted = String(++this.rollsStarted);
    this.canvas.dataset.appearance = style;
    this.applyFrame(0); this.lastFrame = performance.now(); this.ensureLoop();
  }

  private applyFrame(seconds: number): void {
    const active = this.active; if (!active) return;
    const index = Math.min(active.motion.frames.length-1,seconds/PHYSICS_STEP);
    const low = Math.floor(index), high = Math.min(low+1,active.motion.frames.length-1), t = index-low;
    this.dice.forEach((die,i)=>{
      const a = active.motion.frames[low]![i]!, b = active.motion.frames[high]![i]!;
      die.mesh.position.copy(a.position).lerp(b.position,t);
      die.mesh.quaternion.copy(a.quaternion).slerp(b.quaternion,t).multiply(active.motion.rotations[i]!);
      die.halo?.position.copy(die.mesh.position);
    });
    this.updateSparks(index);
    this.updateImpacts(seconds,active.motion);
  }

  /** Puts the camera at rest, plus a push-in offset and a shake offset. Both are zero once a roll has landed. */
  private placeCamera(push: number, shakeX: number, shakeZ: number): void {
    this.camera.position.copy(CAMERA_REST).multiplyScalar(1+push*.07).add(new THREE.Vector3(shakeX,0,shakeZ));
    this.camera.lookAt(0,0,0);
  }

  /** Floor rings and a short camera shake at every hard hit. Skipped for reduced motion. */
  private updateImpacts(seconds: number, motion: PreparedThrow): void {
    if (this.reducedMotion.matches) return;
    let shakeX = 0, shakeZ = 0;
    for (const impact of motion.impacts) {
      const age = seconds-impact.time;
      if (age<0 || age>.4) continue;
      const amplitude = Math.min(.07,impact.strength*.0055)*Math.exp(-age*11);
      shakeX += Math.sin(age*72+impact.x)*amplitude; shakeZ += Math.cos(age*58+impact.z)*amplitude;
    }
    this.placeCamera((1-easeOutCubic(Math.min(1,seconds/Math.max(motion.duration,PHYSICS_STEP))))*1,shakeX,shakeZ);
    for (const ring of this.impactRings) {
      const progress = (seconds-ring.time)/IMPACT_RING_SECONDS;
      ring.mesh.visible = progress>=0 && progress<1;
      if (!ring.mesh.visible) continue;
      const reach = Math.min(2.6,1+ring.strength*.1);
      ring.mesh.scale.setScalar(DIE_RADIUS*(.8+easeOutCubic(progress)*reach));
      ring.mesh.material.opacity = (1-progress)**2*Math.min(.55,.14+ring.strength*.035);
    }
  }

  private makeRing(color: THREE.ColorRepresentation): { mesh: RingMesh } {
    const material = new THREE.MeshBasicMaterial({map:this.ringTexture,color,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false});
    const mesh: RingMesh = new THREE.Mesh(this.ringGeometry,material);
    mesh.rotation.x = -Math.PI/2; mesh.visible = false; mesh.renderOrder = -1; this.scene.add(mesh);
    return { mesh };
  }

  /** When dice land, a ring spreads from each one, tinted with its colour, so the eye goes to the result. */
  private startSettle(): void {
    if (this.reducedMotion.matches) return;
    for (const die of this.dice) {
      const ring = this.makeRing(mixHex('#ffffff',paletteFor(die.request.colorway,this.active?.job.appearance ?? DEFAULT_APPEARANCE).body,.55));
      ring.mesh.position.set(die.mesh.position.x,.025,die.mesh.position.z);
      die.settleRing = ring.mesh;
    }
  }
  private updateSettle(now: number, fade: number): void {
    const progress = (now-this.settledAt)/1000/SETTLE_RING_SECONDS;
    for (const die of this.dice) {
      const ring = die.settleRing; if (!ring) continue;
      ring.visible = progress<1;
      if (!ring.visible) continue;
      ring.scale.setScalar(DIE_RADIUS*(1.2+easeOutCubic(progress)*2.4));
      ring.material.opacity = (1-progress)**1.5*.7*fade;
    }
  }

  private updateSparks(frame: number): void {
    if (this.effect !== 'sparks' || !this.active) { this.sparks.geometry.setDrawRange(0,0); return; }
    let count = 0;
    this.dice.forEach((die,i)=>{
      const color = new THREE.Color(paletteFor(die.request.colorway,this.active!.job.appearance).body);
      for (let tail=0; tail<18; tail++) {
        const index = Math.floor(frame-tail*1.3);
        if (index<0) break;
        const point = this.active!.motion.frames[index]?.[i]?.position; if (!point) continue;
        const offset = count*3;
        this.sparkPositions[offset] = point.x + Math.sin(index*2+i)*tail*.012;
        this.sparkPositions[offset+1] = point.y + Math.cos(index+i)*tail*.012;
        this.sparkPositions[offset+2] = point.z + Math.sin(index+i*2)*tail*.012;
        const strength = (1-tail/18)*.9;
        this.sparkColors[offset] = color.r*strength; this.sparkColors[offset+1] = color.g*strength; this.sparkColors[offset+2] = color.b*strength;
        count++;
      }
    });
    this.sparks.geometry.setDrawRange(0,count);
    this.sparks.geometry.attributes.position!.needsUpdate = true; this.sparks.geometry.attributes.color!.needsUpdate = true;
  }

  private readonly handleContextLost = (event: Event): void => {
    // Stop the browser from restoring a context this stage no longer draws with.
    event.preventDefault();
    if (!this.disposed) this.hooks.onLost?.();
  };
  private readonly frame = (now: number): void => {
    this.frameId = 0; if (this.disposed) return; let faded = false;
    const dt = Math.max(0,(now-this.lastFrame)/1000); this.lastFrame = now;
    if (this.active) {
      const current = this.active;
      const speed = this.reducedMotion.matches ? Math.max(current.motion.duration,PHYSICS_STEP)/REDUCED_MOTION_SECONDS : Math.max(1,current.motion.duration/THROW_SCREEN_SECONDS);
      current.elapsed = Math.min(current.motion.duration,current.elapsed+dt*speed);
      this.renderer.shadowMap.autoUpdate = true;
      this.applyFrame(current.elapsed);
      this.adaptResolution(dt);
      if (current.elapsed>=current.motion.duration) {
        this.canvas.dataset.rollState = 'settled';
        this.canvas.dataset.visibleValues = this.dice.map(die=>upwardResult(die.shape,die.mesh.quaternion)).join(',');
        this.canvas.dataset.rollsCompleted = String(++this.rollsCompleted);
        this.settledAt = now; this.startSettle(); this.placeCamera(0,0,0);
        this.renderer.shadowMap.needsUpdate = true;
        this.active = null; this.sparks.geometry.setDrawRange(0,0); this.holdUntil = now+HOLD_MS;
        current.job.resolve(); this.pump();
      }
    } else if (this.dice.length) {
      this.landingSparks(now);
      let fade = 1;
      if (now>=this.holdUntil) {
        this.fadeStart ??= now; const opacity = Math.max(0,1-(now-this.fadeStart)/FADE_MS); fade = opacity;
        this.dice.forEach(die=>{die.material.opacity=opacity; if (die.halo) die.halo.material.opacity=opacity*.5;});
        if (!opacity) { this.clearDice(); this.canvas.dataset.rollState = 'idle'; faded = true; }
      }
      this.updateSettle(now,fade);
    }
    // While the dice rest and nothing else moves, the last frame stays on screen: drawing it again would only cost battery.
    const moving = !!this.active || this.fadeStart !== null || faded || this.dirty
      || (now-this.settledAt)/1000 < SETTLE_RING_SECONDS + .1 || (this.effect==='sparks' && now-this.settledAt < 1200);
    if (!this.active) this.renderer.shadowMap.autoUpdate = false;
    // At rest, one frame at the full ratio makes the numerals sharp. It costs nothing while the dice are still.
    if (!moving && this.dice.length && this.ratio < Math.min(window.devicePixelRatio||1,this.quality.restRatio)) {
      this.applyRatio(this.quality.restRatio); this.renderer.shadowMap.needsUpdate = true;
    }
    if (moving || this.dirty) { this.render(); this.dirty = false; }
    // A resting canvas is hidden, so the page under it is not blended with a full-screen layer.
    if (faded) this.canvas.style.visibility = 'hidden';
    if (this.active || this.dice.length) this.ensureLoop(); else if (faded) this.hooks.onIdle?.();
  };

  /**
   * Times the frames of a throw and trades pixels for speed. Slow frames lower the ratio at once; a long run of fast
   * frames raises it a little. The result is remembered for the next roll.
   */
  private adaptResolution(dt: number): void {
    // The first frames pay for shader compiles and texture uploads, and a long gap means the tab was away.
    if (this.frameSamples++ < 4 || dt > 0.12 || dt <= 0) return;
    this.frameMs += dt*1000;
    if ((this.frameSamples-4) % SAMPLE_FRAMES !== 0) return;
    const average = this.frameMs/SAMPLE_FRAMES; this.frameMs = 0;
    if (average > SLOW_MS && this.moveRatio > this.quality.minRatio) {
      this.moveRatio = Math.max(this.quality.minRatio,+(this.moveRatio-.2).toFixed(2)); this.fastStreak = 0;
      learnedMoveRatio = this.moveRatio; this.applyRatio(this.moveRatio);
    } else if (average < FAST_MS && this.moveRatio < this.quality.moveRatio) {
      if (++this.fastStreak >= 4) { this.moveRatio = Math.min(this.quality.moveRatio,+(this.moveRatio+.1).toFixed(2)); this.fastStreak = 0; learnedMoveRatio = this.moveRatio; this.applyRatio(this.moveRatio); }
    } else this.fastStreak = 0;
  }

  private ensureLoop(): void { if (!this.frameId && !this.disposed) this.frameId = requestAnimationFrame(this.frame); }
  private landingSparks(now: number): void {
    const t = (now-this.settledAt)/1100;
    if (this.effect!=='sparks' || t>1) { this.sparks.geometry.setDrawRange(0,0); return; }
    let count = 0;
    this.dice.forEach((die,index)=>{
      const color = die.material.emissive;
      for (let p=0;p<18;p++) {
        const angle = p*Math.PI*2/18+index, radius = .65+t*(.7+(p%3)*.15), offset = count*3;
        this.sparkPositions[offset] = die.mesh.position.x+Math.cos(angle)*radius;
        this.sparkPositions[offset+1] = .15+Math.sin(Math.PI*t)*(.25+(p%4)*.12);
        this.sparkPositions[offset+2] = die.mesh.position.z+Math.sin(angle)*radius;
        const strength = (1-t)*1.5;
        this.sparkColors[offset] = color.r*strength; this.sparkColors[offset+1] = color.g*strength; this.sparkColors[offset+2] = color.b*strength;
        count++;
      }
    });
    this.sparks.geometry.setDrawRange(0,count);
    this.sparks.geometry.attributes.position!.needsUpdate=true; this.sparks.geometry.attributes.color!.needsUpdate=true;
  }
  private render(): void { this.renderer.render(this.scene,this.camera); }
  private clearDice(): void {
    this.dice.forEach(die=>{this.scene.remove(die.mesh);die.material.dispose();if(die.halo){this.scene.remove(die.halo);die.halo.material.dispose();}if(die.settleRing){this.scene.remove(die.settleRing);die.settleRing.material.dispose();}});
    this.impactRings.forEach(ring=>{this.scene.remove(ring.mesh);ring.mesh.material.dispose();});
    this.impactRings.length=0; this.dice.length=0; this.sparks.geometry.setDrawRange(0,0); this.fadeStart=null;
  }
  private clearMaterials(): void { this.baseMaterials.forEach(material=>{material.map?.dispose();material.bumpMap?.dispose();material.dispose();});this.baseMaterials.clear(); }
  private baseMaterial(shape: DieShape, request: DieRequest, appearance: DiceAppearance): DieMaterial {
    const key = shape.sides+':'+request.colorway+':'+(request.reading ?? ''); let material = this.baseMaterials.get(key);
    if (!material) {
      const palette = paletteFor(request.colorway,appearance), anisotropy = Math.min(this.quality.anisotropy,this.renderer.capabilities.getMaxAnisotropy());
      const color = new THREE.CanvasTexture(cachedAtlas(shape,palette,{finish:appearance.finish,reading:request.reading,cellPx:this.quality.atlasCellPx}));
      color.colorSpace = THREE.SRGBColorSpace; color.anisotropy = anisotropy;
      // The numerals are cut into the die, so light catches their edges as it would on a real one.
      const engraving = new THREE.CanvasTexture(cachedBumpAtlas(shape,request.reading,this.quality.atlasCellPx));
      engraving.anisotropy = anisotropy;
      material = new THREE.MeshPhysicalMaterial({map:color,bumpMap:engraving,bumpScale:appearance.finish==='metal'?2.2:3,...finishFor(appearance.finish,this.quality.fancyMaterials),emissive:this.effect==='none' ? '#000000' : palette.body,emissiveIntensity:.15});
      this.baseMaterials.set(key,material);
    }
    return material;
  }
  private geometryFor(shape: DieShape): THREE.BufferGeometry {
    const cached = this.geometries.get(shape.sides); if (cached) return cached;
    const {positions,normals,uvs} = buildBevelledMesh(shape,DIE_RADIUS);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    this.geometries.set(shape.sides,geometry);return geometry;
  }
}
