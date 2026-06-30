import TR from './GuiTR.js';
import { saveAs } from 'file-saver';
import { zip } from 'zip';
import Export from '../files/Export.js';
import StorageDB from '../misc/StorageDB.js';
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
      
      // Pre-load images for thumbnails
      this._browserSaves.forEach(save => {
        if (save.value.thumb && !save.value.thumbImage) {
          const img = new Image();
          img.src = save.value.thumb;
          save.value.thumbImage = img; // Cache the Image object
          img.onload = () => {
            if (this._main._guiXR) this._main._guiXR._needsRedraw = true;
          };
        }
      });

      if (this._main._guiXR) this._main._guiXR._needsRedraw = true;
    }).catch(err => console.error("Failed to load browser saves:", err));
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

  saveFileAsSGL(baseName) {
    var meshes = this._getExportMeshes();
    if (!meshes) return;
    this._save(Export.exportSGL(meshes, this._main), this._exportFileName(baseName, 'sxr'));
  }

  saveToBrowserStorage(saveName) {
    var meshes = this._getExportMeshes();
    if (!meshes) return;
    
    const blob = Export.exportSGL(meshes, this._main);
    const timestamp = Date.now();
    const key = `sculpt_${timestamp}`;

    // Grab thumbnail — always renders to a square 512×512 WebGLRenderTarget so the
    // result is never squashed regardless of the canvas/VR framebuffer dimensions.
    let thumb = '';
    const renderer = this._main._renderer;
    if (renderer) {
      try {
        const THUMB = 512;

        // 1. Pick camera position and auto-frame toward the sculpt bounding box
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
            const maxDim = box.getSize(new THREE.Vector3()).length();
            snapCam.lookAt(center);
            const dist = snapCam.position.distanceTo(center);
            if (dist > 0.01 && maxDim > 0.01) {
              const fov = 2 * Math.atan(maxDim / (2 * dist)) * (180 / Math.PI);
              snapCam.fov = Math.min(70, Math.max(5, fov * 1.3));
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
            const fov = 2 * Math.atan(span / (2 * dist)) * (180 / Math.PI) * 1.2;
            snapCam.fov = Math.min(65, Math.max(20, fov));
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

        thumb = tempCanvas.toDataURL('image/jpeg', 0.25);

        // 7. Restore hidden children
        hidden.forEach(child => { child.visible = true; });

      } catch (e) {
        console.error('Screenshot failed:', e);
      }
    }

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
    this._save(Export.exportGLB(meshes, { bake: this._bakeAnimation }), this._exportFileName(baseName, 'glb'));
  }

  saveFileAsOBJ(baseName) {
    var meshes = this._getExportMeshes();
    if (!meshes) return;
    this._save(Export.exportOBJ(meshes, this._objColorZbrush, this._objColorAppended), this._exportFileName(baseName, 'obj'));
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
