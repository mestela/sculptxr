import TR from './GuiTR.js';
import { saveAs } from 'file-saver';
import { zip } from 'zip';
import { zipSync, strToU8 } from 'fflate';
import Export from '../files/Export.js';
import ExportOBJ from '../files/ExportOBJ.js';
import StorageDB from '../misc/StorageDB.js';
import Skeleton from '../editing/Skeleton.js';
import * as THREE from 'three';

import Rtt from '../drawables/Rtt.js';
import ShaderPaintUV from '../render/shaders/ShaderPaintUV.js';
import ShaderBlur from '../render/shaders/ShaderBlur.js';
import Enums from '../misc/Enums.js';

class GuiFiles {

  constructor(guiParent, ctrlGui) {
    this._main = ctrlGui._main; // main application
    this._ctrlGui = ctrlGui;
    this._menu = null; // ui menu
    this._parent = guiParent;
    this._exportAll = true;
    this._bakeAnimation = true;

    this._objColorZbrush = true;
    this._objColorAppended = false;
    this._browserSaves = []; // Cache for gallery
    this._browserSavePage = 0;
    this._browserThumbCache = new Map();
    this._texSize = 1024; // default 2^10
    this.init(guiParent);
    this.refreshBrowserSaves();
  }

  refreshBrowserSaves() {
    return StorageDB.getAll().then(saves => {
      // Sort by timestamp desc (newest first)
      this._browserSaves = saves.sort((a, b) => {
        const tA = a.value && a.value.timestamp ? a.value.timestamp : 0;
        const tB = b.value && b.value.timestamp ? b.value.timestamp : 0;
        return tB - tA;
      });
      
      const pageCount = Math.max(1, Math.ceil(this._browserSaves.length / 12));
      this._browserSavePage = Math.min(this._browserSavePage, pageCount - 1);
      for (const save of this._browserSaves) {
        const cached = this._browserThumbCache.get(save.key);
        if (cached) save.value.galleryThumb = cached;
      }

      if (this._main._guiXR) this._main._guiXR._needsRedraw = true;
    }).catch(err => console.error("Failed to load browser saves:", err));
  }

  // The HTML→VR texture path embeds image URLs into an SVG. Feeding it every 512px legacy
  // thumbnail makes one panel paint surprisingly expensive, so only decode/downsample the
  // twelve cards on the current page. Results remain in memory for the session.
  prepareBrowserSavePage(page = this._browserSavePage, pageSize = 12) {
    const visible = this._browserSaves.slice(page * pageSize, (page + 1) * pageSize);
    return Promise.all(visible.map(save => {
      const value = save.value || {};
      if (!value.thumb || value.galleryThumb) return null;
      return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          try {
            // Matched to the capture size, or the downscale here undoes it: a 256 thumbnail
            // squeezed back to 128 at quality 0.45 is exactly the mush this was raising.
            const GALLERY_THUMB = 128;
            if (img.naturalWidth <= GALLERY_THUMB && img.naturalHeight <= GALLERY_THUMB) {
              value.galleryThumb = value.thumb;
            } else {
              const canvas = document.createElement('canvas');
              canvas.width = GALLERY_THUMB; canvas.height = GALLERY_THUMB;
              canvas.getContext('2d').drawImage(img, 0, 0, GALLERY_THUMB, GALLERY_THUMB);
              value.galleryThumb = canvas.toDataURL('image/jpeg', 0.9);
            }
            this._browserThumbCache.set(save.key, value.galleryThumb);
          } catch (_) { value.galleryThumb = value.thumb; }
          resolve();
        };
        img.onerror = () => resolve();
        img.src = value.thumb;
      });
    }));
  }

  init(guiParent) {
    // Gutted — desktop topbar uses buildMenuHTML_files + wireMenuFiles
  }

  addFile() {
    const input = document.getElementById('fileopen');
    if (input) {
      const oldPointerEvents = input.style.pointerEvents;
      const oldZIndex = input.style.zIndex;
      
      input.style.pointerEvents = 'auto';
      input.style.zIndex = '9999';
      
      input.click();
      
      setTimeout(() => {
        input.style.pointerEvents = oldPointerEvents;
        input.style.zIndex = oldZIndex;
      }, 500);
    } else {
      console.error("[GuiFiles] fileopen element not found!");
    }
  }

  onTextureSize(value) {
    this._texSize = 1 << value;
  }

  saveTextureDiffuse()  { return this.saveColor(); }
  saveTextureRoughness() { return this.saveRoughness(); }
  saveTextureMetalness() { return this.saveMetalness(); }

  _getExportMeshes() {
    if (this._exportAll) return this._main.getMeshes();
    var selected = this._main.getSelectedMeshes();
    return selected.length ? selected : undefined;
  }

  _extractTexture(gl, width, height) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    var pixels = new Uint8Array(4 * width * height);

    var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('FRAMEBUFFER not complete');
      return canvas;
    }

    gl.flush();
    gl.finish();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // copy pixels to canvas pixels (inverted image)
    var ctx = canvas.getContext('2d');
    var imageData = ctx.getImageData(0, 0, width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);

    return canvas;
  }

  _getRttPaint(gl) {
    if (!this._rttPaint) {
      this._rttPaint = new Rtt(gl, Enums.Shader.PAINTUV, null);
      this._rttPaint.setWrapRepeat(true);
      this._rttPaint.setFilterNearest(true);
      ShaderBlur.INPUT_TEXTURE = this._getRttPaint();
    }
    return this._rttPaint;
  }

  _getRttBlur(gl) {
    if (!this._rttBlur) {
      this._rttBlur = new Rtt(gl, Enums.Shader.BLUR, null);
    }
    return this._rttBlur;
  }

  _saveTexture(filename) {
    var mesh = this._main.getMesh();
    if (!mesh) {
      return;
    }

    if (!mesh.getTexCoords()) {
      (window._vrAlert || window.alert)('The selected mesh has no UV!');
      return;
    }

    var gl = mesh.getGL();

    var width = this._texSize;
    var height = this._texSize;

    var tmpShaderType = mesh.getShaderType();
    mesh.setShaderType(Enums.Shader.PAINTUV);

    var rttPaint = this._getRttPaint(gl);
    rttPaint.onResize(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rttPaint.getFramebuffer());
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.viewport(0, 0, width, height);
    mesh.render();

    mesh.setShaderType(tmpShaderType);

    this._blurImage(gl, width, height);

    var canvas = this._extractTexture(gl, width, height);
    canvas.toBlob(function (blob) {
      saveAs(blob, filename + '.png');
    }.bind(this));

    // reset viewport size
    this._main.onCanvasResize();
  }

  _blurImage(gl, width, height) {
    var rttBlur = this._getRttBlur(gl);
    rttBlur.onResize(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rttBlur.getFramebuffer());
    gl.clear(gl.COLOR_BUFFER_BIT);

    rttBlur.render(this._main);
  }

  saveColor() {
    ShaderPaintUV.CHANNEL_VALUE = 0;
    this._saveTexture('diffuse');
  }

  saveRoughness() {
    ShaderPaintUV.CHANNEL_VALUE = 1;
    this._saveTexture('roughness');
  }

  saveMetalness() {
    ShaderPaintUV.CHANNEL_VALUE = 2;
    this._saveTexture('metalness');
  }

  async saveFileAsSGL(baseName) {
    var meshes = this._getExportMeshes();
    if (!meshes) return;
    // Pull voxel-frame fields out of the worker (compressed) so exportSGL can embed them.
    if (this._main._frameGroup) await this._main._frameGroup.prepareFieldsForSave(meshes);
    this._save(Export.exportSGL(meshes, this._main), this._exportFileName(baseName, 'sxr'));
    this._main._frameGroup?.clearSaveFields?.();
  }

  async saveToBrowserStorage(saveName) {
    var meshes = this._getExportMeshes();
    if (!meshes) return;

    if (this._main._frameGroup) await this._main._frameGroup.prepareFieldsForSave(meshes);
    const blob = Export.exportSGL(meshes, this._main);
    const timestamp = Date.now();
    const key = `sculpt_${timestamp}`;

    // Grab thumbnail — always renders to a square 512×512 WebGLRenderTarget so the
    // result is never squashed regardless of the canvas/VR framebuffer dimensions.
    let thumb = '';
    const renderer = this._main._renderer;
    // Helper overlays that live INSIDE _worldGroup. Step 3 below only hides children of
    // _scene, so these would otherwise be drawn into the thumbnail — and worse,
    // Box3.setFromObject does not skip invisible objects, so anything parked wherever the
    // controller last was inflates the bounding box and the auto-framing pulls the camera
    // back until the sculpt is a speck. Detached rather than hidden, precisely because the
    // box ignores visibility.
    //
    // THE RIG ITSELF STAYS. It used to be detached wholesale, which kept the framing honest
    // but meant a skeleton with no sculpt yet photographed as an empty square — no use at all
    // for building a library of rigs to come back to. Only the preview cursor has to go, and
    // Skeleton owns the list of what that is.
    const detached = [];
    const detach = (o) => { if (o && o.parent) { detached.push([o, o.parent]); o.parent.remove(o); } };
    for (const o of Skeleton.snapshotHide(this._main)) detach(o);
    detach(this._main.getSculptManager?.()?.getTool?.(Enums.Tools.EXTRUDE)?._selectionMesh);

    if (renderer) {
      try {
        // Gallery cards are roughly 128 CSS pixels wide. A 512px capture quadrupled each
        // dimension only to be shrunk again by the VR HTML rasteriser.
        // SMALL AND SHARP, not big and mushy. The blockiness was never the pixel count -- it was
        // JPEG quality 0.25 -- and the saves list is a COLUMN of small rows, so the pixels were
        // never needed. matt: "if anything the images can be smaller, but of higher quality."
        // 128 at 0.88 is both crisper than the 256 at 0.72 it replaces and smaller on disk.
        const THUMB = 128;

        // 1. Pick camera position and auto-frame toward the sculpt bounding box
        //
        // ONE FRAMING RULE FOR BOTH PLATFORMS. VR measured the subject by the bounding box's
        // DIAGONAL and desktop by its largest AXIS, then padded by different amounts (1.3 against
        // 1.2) -- so the same sculpt photographed at two different sizes depending on where you
        // pressed save, and both left a wide dead border. The diagonal is the overestimate the
        // desktop branch's own comment warns about: it is the corner-to-corner span, which
        // nothing on screen actually occupies.
        //
        // The margin is the ratio of the frame to the subject, so the subject fills 1/margin of
        // it: 1.3 filled 77%, 1.2 filled 83%, and 1.08 fills 93%. matt: "can they fill the frame
        // a little more? i think there's too much padding at the borders."
        const FRAME_MARGIN = 1.08;
        const snapCam = new THREE.PerspectiveCamera(45, 1.0, 0.01, 1000);
        if (renderer.xr.isPresenting) {
          // VR: start from head pose — user is naturally close to the sculpt.
          const vrCam = renderer.xr.getCamera(this._main._camera._threeCamera);
          snapCam.position.copy(vrCam.position);
          snapCam.quaternion.copy(vrCam.quaternion);
          snapCam.updateMatrixWorld(true);
          if (this._main._worldGroup) {
            const box    = new THREE.Box3().setFromObject(this._main._worldGroup);
            const center = box.getCenter(new THREE.Vector3());
            const vs     = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(vs.x, vs.y, vs.z);   // the axis, not the diagonal — see above
            snapCam.lookAt(center);
            const dist = snapCam.position.distanceTo(center);
            if (dist > 0.01 && maxDim > 0.01) {
              const fov = 2 * Math.atan(maxDim / (2 * dist)) * (180 / Math.PI);
              snapCam.fov = Math.min(70, Math.max(5, fov * FRAME_MARGIN));
            }
            snapCam.updateProjectionMatrix();
            snapCam.updateMatrixWorld(true);
          }
        } else {
          // Desktop: derive position from the bounding box so the result is
          // independent of where the user has orbited/zoomed the viewport.
          if (this._main._worldGroup) {
            const box  = new THREE.Box3().setFromObject(this._main._worldGroup);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            // Use the largest single axis — avoids the 3D diagonal overestimate
            // that makes the sculpt appear tiny in the thumbnail.
            const span = Math.max(size.x, size.y, size.z);
            const snapDist = span * 1.2;
            snapCam.position.set(center.x, center.y + span * 0.1, center.z + snapDist);
            snapCam.lookAt(center);
            const dist = snapCam.position.distanceTo(center);
            const fov = 2 * Math.atan(span / (2 * dist)) * (180 / Math.PI) * FRAME_MARGIN;
            // The floor was 20 degrees, which is itself padding: a small sculpt computes a
            // narrower angle than that and got widened back out to it, putting the border
            // straight back. 12 still keeps a distant camera from a keyhole projection.
            snapCam.fov = Math.min(65, Math.max(12, fov));
            snapCam.updateProjectionMatrix();
            snapCam.updateMatrixWorld(true);
          } else {
            const dc = this._main._camera._threeCamera;
            snapCam.position.copy(dc.position);
            snapCam.quaternion.copy(dc.quaternion);
            snapCam.updateMatrixWorld(true);
          }
        }

        // 3. Hide non-scene children (UI panels, controllers, etc.)
        const hidden = [];
        this._main._scene.children.forEach(child => {
          if (child.visible && child !== this._main._worldGroup && !child.isLight) {
            child.visible = false;
            hidden.push(child);
          }
        });

        // 4. Render into a square off-screen RenderTarget — never touches the main canvas
        const wasXREnabled = renderer.xr.enabled;
        renderer.xr.enabled = false;
        const rt = new THREE.WebGLRenderTarget(THUMB, THUMB);
        renderer.setRenderTarget(rt);
        renderer.render(this._main._scene, snapCam);
        renderer.setRenderTarget(null);
        renderer.xr.enabled = wasXREnabled;

        // 5. Read pixels back (WebGL origin is bottom-left, flip Y)
        const pixels = new Uint8Array(THUMB * THUMB * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, THUMB, THUMB, pixels);
        rt.dispose();

        const flipped = new Uint8ClampedArray(THUMB * THUMB * 4);
        for (let row = 0; row < THUMB; row++) {
          const src = (THUMB - 1 - row) * THUMB * 4;
          flipped.set(pixels.subarray(src, src + THUMB * 4), row * THUMB * 4);
        }

        // 6. Write raw pixels to an intermediate canvas, then apply colour correction
        const rawCanvas = document.createElement('canvas');
        rawCanvas.width = THUMB; rawCanvas.height = THUMB;
        rawCanvas.getContext('2d').putImageData(new ImageData(flipped, THUMB, THUMB), 0, 0);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = THUMB; tempCanvas.height = THUMB;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.filter = 'contrast(1.4) brightness(0.8) saturate(1.2)';
        tempCtx.drawImage(rawCanvas, 0, 0);

        thumb = tempCanvas.toDataURL('image/jpeg', 0.88);

        // 7. Restore hidden children
        hidden.forEach(child => { child.visible = true; });

      } catch (e) {
        console.error('Screenshot failed:', e);
      } finally {
        // In a finally, not after the try: a throw mid-capture must not leave the skeleton
        // detached from the scene.
        for (const [o, p] of detached) p.add(o);
        detached.length = 0;
      }
    }
    for (const [o, p] of detached) p.add(o); // no renderer: nothing captured, still restore

    StorageDB.set(key, { 
      blob: blob, 
      thumb: thumb, 
      name: (saveName || '').trim() || this._getTimestampedFileName('browser', '').replace('.', ''), // user-named, else timestamped
      timestamp: timestamp 
    }).then(() => {
      if (window.screenLog) window.screenLog(`SUCCESS: Stashed sculpt ${key}`, 'lime');
      this.refreshBrowserSaves(); // Refresh internal list
    }).catch(err => {
      if (window.screenLog) window.screenLog(`ERROR: Stash failed: ${err}`, 'red');
    });
  }

  loadFromBrowserStorage() {
    this.loadSpecificBrowserSave('active_mesh'); // Legacy fallback
  }

  // replace=true clears the current scene first (Load); replace=false appends the
  // save's meshes to the current scene (Import). loadScene itself always appends.
  loadSpecificBrowserSave(key, replace = false) {
    if (window.screenLog) window.screenLog(`${replace ? 'Loading' : 'Importing'} ${key}...`, 'cyan');
    StorageDB.get(key).then(data => {
      if (!data) {
        if (window.screenLog) window.screenLog('No saved model found!', 'yellow');
        return;
      }

      const blob = data.blob || data; // Handle legacy unboxed blobs vs new structured values
      if (typeof blob.arrayBuffer === 'function') {
        return blob.arrayBuffer();
      } else {
        // Fallback or binary typed array
        return blob;
      }
    }).then(buf => {
      if (buf) {
        if (replace) this._main.clearScene();
        this._main.loadScene(buf, 'sgl');
        if (window.screenLog) window.screenLog('Loaded from browser storage!', 'lime');
      }
    }).catch(err => {
      console.error(`[GuiFiles] Failed to load:`, err);
      if (window.screenLog) window.screenLog('Failed to load: ' + err, 'red');
    });
  }

  deleteBrowserSave(key) {
    if (window.screenLog) window.screenLog(`Deleting ${key} from storage...`, 'orange');
    
    StorageDB.delete(key).then(() => {
      if (window.screenLog) window.screenLog(`SUCCESS: Deleted ${key}`, 'lime');
      this.refreshBrowserSaves(); // Refresh list
    }).catch(err => {
      if (window.screenLog) window.screenLog(`ERROR: Delete failed: ${err}`, 'red');
    });
  }

  saveFileAsGLB(baseName) {
    var meshes = this._getExportMeshes();
    if (!meshes) return;
    this._save(Export.exportGLB(meshes, { bake: this._bakeAnimation, main: this._main }), this._exportFileName(baseName, 'glb'));
  }

  saveFileAsOBJ(baseName) {
    var meshes = this._getExportMeshes();
    if (!meshes) return;
    this._save(Export.exportOBJ(meshes, this._objColorZbrush, this._objColorAppended), this._exportFileName(baseName, 'obj'));
  }

  // Low-brow universal animation export: a per-FRAME OBJ sequence (anim.0000.obj,
  // anim.0001.obj, …) zipped. Samples the HELD geometry of every frame-by-frame cel
  // sequence (voxel OR baked) at each sampled timeline frame, so any DCC can import it
  // as a mesh/stop-motion sequence — sidestepping glTF's lack of a per-frame mesh-swap
  // channel. No bake needed: reads the stored per-frame geom (voxel surfaces included).
  // World-space (each frame's geom is baked through its object matrix). Static
  // (non-animated) meshes are NOT included — export those separately.
  saveObjSequence(baseName) {
    const fg = window._frameGroup;
    const groups = fg ? this._main.getMeshes().filter(m => m && m._isFrameGroup) : [];
    if (!groups.length) {
      if (window.screenLog) window.screenLog('[OBJ seq] No frame-by-frame animation to export', '#f9e2af');
      return;
    }

    const fps = Math.max(1, Math.round(window._animFPS || 24));
    const loopStart = window._animLoopStart || 0;
    let loopEnd = window._animLoopEnd ?? window._animMasterDuration;
    if (!(loopEnd > loopStart)) {
      // No explicit range → span the latest keyed frame, plus one frame of trailing hold.
      loopEnd = loopStart;
      groups.forEach(g => fg.children(g).forEach(c => { const t = c._srFrameTime || 0; if (t > loopEnd) loopEnd = t; }));
      loopEnd += 1 / fps;
    }
    let nFrames = Math.max(1, Math.round((loopEnd - loopStart) * fps));
    const CAP = 3000;
    if (nFrames > CAP) {
      if (window.screenLog) window.screenLog(`[OBJ seq] ${nFrames} frames clamped to ${CAP}`, '#f9e2af');
      nFrames = CAP;
    }

    const base = (baseName || '').trim() || 'anim';
    const colZ = this._objColorZbrush, colA = this._objColorAppended;

    const files = {};
    for (let f = 0; f < nFrames; f++) {
      const t = loopStart + f / fps;
      let data = 's 0\n';
      const offsets = [1, 1];
      let mi = 0;
      // Each frame group contributes its HELD child (a real MeshStatic) at time t — its
      // matrix is already world-space (the group is identity), so ExportOBJ reads it directly.
      groups.forEach(g => {
        const child = fg.visibleChild(g, t);
        if (!child || (child.getNbVertices?.() || 0) === 0) return; // blank/held-empty frame
        data += 'o mesh_' + (mi++) + '\n';
        data = ExportOBJ.addMesh(child, data, offsets, colZ, colA);
      });
      files[`${base}.${String(f).padStart(4, '0')}.obj`] = strToU8(data);
    }

    const zipped = zipSync(files);
    saveAs(new Blob([zipped], { type: 'application/zip' }), `${base}_objseq.zip`);
    if (window.screenLog) window.screenLog(`[OBJ seq] Exported ${nFrames} frames @ ${fps}fps`, '#a6e3a1');
  }

  saveFileAsPLY(baseName) {
    var meshes = this._getExportMeshes();
    if (!meshes) return;
    this._save(Export.exportBinaryPLY(meshes), this._exportFileName(baseName, 'ply'));
  }

  saveFileAsSTL(baseName) {
    var meshes = this._getExportMeshes();
    if (!meshes) return;
    this._save(Export.exportBinarySTL(meshes), this._exportFileName(baseName, 'stl'));
  }

  // Use the caller-supplied name (from the VR/desktop keyboard) when given, else fall back
  // to the timestamped default so a bare click still produces a unique file.
  _exportFileName(baseName, ext) {
    const b = (baseName || '').trim();
    return b ? `${b}.${ext}` : this._getTimestampedFileName('yourMesh', ext);
  }

  _getTimestampedFileName(baseName, ext) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    return `${baseName}_${year}${month}${day}_${hours}${mins}.${ext}`;
  }

  _save(data, fileName, useZip) {
    if (window.screenLog) {
      window.screenLog('SUCCESS: Exported ' + fileName, 'lime');
    }
    if (!useZip) return saveAs(data, fileName);

    zip.useWebWorkers = true;
    zip.workerScriptsPath = 'worker/';
    zip.createWriter(new zip.BlobWriter('application/zip'), function (zipWriter) {
      zipWriter.add(fileName, new zip.BlobReader(data), function () {
        zipWriter.close(function (blob) {
          saveAs(blob, 'yourMesh.zip');
        });
      });
    }, onerror);
  }

  ////////////////
  // KEY EVENTS
  ////////////////
  onKeyDown(event) {
    if (event.handled === true)
      return;

    event.stopPropagation();
    if (!this._main._focusGui)
      event.preventDefault();

    var key = event.which;
    if (event.ctrlKey && event.altKey && key === 78) { // N
      this._main.clearScene();
      event.handled = true;

    } else if (event.ctrlKey && (key === 79 || key === 73)) { // O or I
      this.addFile();
      event.handled = true;

    } else if (event.ctrlKey && key === 69) { // E
      this.saveFileAsOBJ();
      event.handled = true;
    }
  }
}

export default GuiFiles;
