import * as THREE from 'three';
import { buildAtlas } from './atlas';
import { DEFAULT_APPEARANCE, paletteFor, type DiceAppearance } from './appearance';
import { upwardResult } from './landing';
import { MAX_TRAY_DICE, type DieRequest } from './rollPlan';
import { atlasPoint, faceTriangles, getDieShape, type DieShape } from './shapes';
import { DIE_RADIUS, PHYSICS_STEP, prepareThrow, type Bounds, type PreparedThrow } from './simulation';
import { FADE_MS, HOLD_MS, MAX_PIXEL_RATIO, REDUCED_MOTION_SECONDS } from './motion';

export interface TrayRect { left: number; top: number; right: number; bottom: number }
export const DEFAULT_TRAY_RECT: TrayRect = { left: .08, top: .32, right: .92, bottom: .94 };
/** Lifecycle hooks: onIdle fires once the last dice have faded, and onLost fires if the WebGL context is lost. */
export interface StageHooks { onIdle?: () => void; onLost?: () => void }
interface Die {
  request: DieRequest; shape: DieShape; mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  material: THREE.MeshStandardMaterial; halo?: THREE.Sprite;
}
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
  private readonly shadowFloor: THREE.Mesh;
  private readonly geometries = new Map<number,THREE.BufferGeometry>();
  private readonly baseMaterials = new Map<string,THREE.MeshStandardMaterial>();
  private readonly haloTexture: THREE.CanvasTexture;
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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    Object.assign(this.canvas.style,{display:'block',width:'100%',height:'100%'});
    container.appendChild(this.canvas);
    // A lost context cannot draw again. Report it, so the tray moves future rolls to flat dice.
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    // Look down at the table from 15 degrees off vertical, retaining a little depth.
    this.camera.position.set(0,16,4.3); this.camera.lookAt(0,0,0);
    const hemisphere = new THREE.HemisphereLight(0xffffff,0x3b3550,1.5);
    const sun = new THREE.DirectionalLight(0xffffff,2.1);
    sun.position.set(-5,14,6); sun.castShadow = true; sun.shadow.mapSize.set(1024,1024);
    Object.assign(sun.shadow.camera,{left:-10,right:10,top:10,bottom:-10,near:1,far:40});
    sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -.0008; sun.shadow.normalBias = .02;
    this.scene.add(hemisphere,sun,sun.target);
    this.shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.ShadowMaterial({opacity:.22}));
    this.shadowFloor.rotation.x = -Math.PI/2; this.shadowFloor.receiveShadow = true; this.scene.add(this.shadowFloor);

    const haloCanvas = document.createElement('canvas'); haloCanvas.width = haloCanvas.height = 64;
    const ctx = haloCanvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,'rgba(255,255,255,.7)'); gradient.addColorStop(.25,'rgba(255,255,255,.3)'); gradient.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0,0,64,64);
    this.haloTexture = new THREE.CanvasTexture(haloCanvas);
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
      this.queue.push({requests:requests.slice(0,MAX_TRAY_DICE),appearance,resolve,reject}); this.pump();
    });
  }

  /** Rejects the rolls still waiting here, so the tray can replay them flat, then releases the GPU. */
  abort(reason: Error): void {
    if (this.disposed) return;
    const pending = this.active ? [this.active.job] : [];
    pending.push(...this.queue.splice(0));
    this.active = null;
    this.dispose();
    pending.forEach(job=>job.reject(reason));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frameId); this.resizeObserver.disconnect();
    this.active?.job.resolve(); this.active = null;
    this.queue.splice(0).forEach(job=>job.resolve()); this.clearDice();
    this.geometries.forEach(g=>g.dispose()); this.clearMaterials();
    this.haloTexture.dispose(); this.sparks.geometry.dispose(); this.sparks.material.dispose();
    this.shadowFloor.geometry.dispose(); (this.shadowFloor.material as THREE.Material).dispose();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.dispose();
    // A context the browser already lost is released; asking for another loss only logs a warning.
    if (!this.renderer.getContext().isContextLost()) this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1,this.container.clientWidth), height = Math.max(1,this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,MAX_PIXEL_RATIO)); this.renderer.setSize(width,height,false);
    this.camera.aspect = width/height; this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    const floor = new THREE.Plane(new THREE.Vector3(0,1,0),0), ray = new THREE.Raycaster(), hit = new THREE.Vector3();
    const {left,top,right,bottom} = this.rect;
    const bounds = {minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
    for (const [x,y] of [[left,top],[right,top],[right,bottom],[left,bottom]]) {
      ray.setFromCamera(new THREE.Vector2(x!*2-1,1-y!*2),this.camera);
      if (!ray.ray.intersectPlane(floor,hit)) continue;
      bounds.minX = Math.min(bounds.minX,hit.x); bounds.maxX = Math.max(bounds.maxX,hit.x);
      bounds.minZ = Math.min(bounds.minZ,hit.z); bounds.maxZ = Math.max(bounds.maxZ,hit.z);
    }
    if (Number.isFinite(bounds.minX)) this.bounds = bounds;
    this.render();
  }

  private pump(): void {
    if (this.active || this.disposed) return;
    const job = this.queue.shift(); if (!job) return;
    this.clearDice();
    const style = JSON.stringify(job.appearance);
    if (style !== this.materialStyle) { this.clearMaterials(); this.materialStyle = style; }
    this.effect = this.reducedMotion.matches ? 'none' : job.appearance.effect;
    const motion = prepareThrow(job.requests,this.bounds);
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
      const speed = this.reducedMotion.matches ? Math.max(current.motion.duration,PHYSICS_STEP)/REDUCED_MOTION_SECONDS : Math.max(1,current.motion.duration/2.6);
      current.elapsed = Math.min(current.motion.duration,current.elapsed+dt*speed);
      this.applyFrame(current.elapsed);
      if (current.elapsed>=current.motion.duration) {
        this.canvas.dataset.rollState = 'settled';
        this.canvas.dataset.visibleValues = this.dice.map(die=>upwardResult(die.shape,die.mesh.quaternion)).join(',');
        this.canvas.dataset.rollsCompleted = String(++this.rollsCompleted);
        this.active = null; this.settledAt = now; this.sparks.geometry.setDrawRange(0,0); this.holdUntil = now+HOLD_MS;
        current.job.resolve(); this.pump();
      }
    } else if (this.dice.length) {
      this.landingSparks(now);
      if (now>=this.holdUntil) {
        this.fadeStart ??= now; const opacity = Math.max(0,1-(now-this.fadeStart)/FADE_MS);
        this.dice.forEach(die=>{die.material.opacity=opacity; if (die.halo) die.halo.material.opacity=opacity*.5;});
        if (!opacity) { this.clearDice(); this.canvas.dataset.rollState = 'idle'; faded = true; }
      }
    }
    this.render(); if (this.active || this.dice.length) this.ensureLoop(); else if (faded) this.hooks.onIdle?.();
  };

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
    this.dice.forEach(die=>{this.scene.remove(die.mesh);die.material.dispose();if(die.halo){this.scene.remove(die.halo);die.halo.material.dispose();}});
    this.dice.length=0; this.sparks.geometry.setDrawRange(0,0); this.fadeStart=null;
  }
  private clearMaterials(): void { this.baseMaterials.forEach(material=>{material.map?.dispose();material.dispose();});this.baseMaterials.clear(); }
  private baseMaterial(shape: DieShape, request: DieRequest, appearance: DiceAppearance): THREE.MeshStandardMaterial {
    const key = shape.sides+':'+request.colorway; let material = this.baseMaterials.get(key);
    if (!material) {
      const palette = paletteFor(request.colorway,appearance), texture = new THREE.CanvasTexture(buildAtlas(shape,palette));
      texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
      const finish = appearance.finish === 'metal' ? {roughness:.27,metalness:.65} : appearance.finish === 'matte' ? {roughness:.9,metalness:0} : {roughness:.3,metalness:.12};
      material = new THREE.MeshStandardMaterial({map:texture,...finish,emissive:this.effect==='none' ? '#000000' : palette.body,emissiveIntensity:.15});
      this.baseMaterials.set(key,material);
    }
    return material;
  }
  private geometryFor(shape: DieShape): THREE.BufferGeometry {
    const cached = this.geometries.get(shape.sides); if (cached) return cached;
    const positions:number[]=[],normals:number[]=[],uvs:number[]=[];
    shape.faces.forEach((face,faceIndex)=>{
      for (const triangle of faceTriangles(shape,faceIndex)) for (const [x,y,z] of triangle) {
        positions.push(x*DIE_RADIUS,y*DIE_RADIUS,z*DIE_RADIUS); normals.push(...face.normal);
        const [u,v]=atlasPoint(shape,faceIndex,[x,y,z]);uvs.push(u,1-v);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    this.geometries.set(shape.sides,geometry);return geometry;
  }
}

