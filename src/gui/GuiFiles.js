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

    this._objColorZbrush = true;
    this._objColorAppended = false;
    this._browserSaves = []; // Cache for gallery
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
    var menu = this._menu = guiParent.addMenu(TR('fileTitle'));

    // import
    menu.addTitle(TR('fileImportTitle'));
    menu.addButton(TR('fileAdd'), this, 'addFile' /*, 'CTRL+O/I'*/ );
    menu.addCheckbox(TR('fileAutoMatrix'), this._main, '_autoMatrix');
    menu.addCheckbox(TR('fileVertexSRGB'), this._main, '_vertexSRGB');

    // export
    menu.addTitle(TR('fileExportSceneTitle'));
    menu.addCheckbox(TR('fileExportAll'), this, '_exportAll');
    menu.addButton(TR('fileExportSGL'), this, 'saveFileAsSGL');
    menu.addButton('Export .sxr (SculptXR)', this, 'saveFileAsSGL');
    menu.addButton('Export GLB (Anim)', this, 'saveFileAsGLB');
    menu.addButton(TR('fileExportOBJ'), this, 'saveFileAsOBJ' /*, 'CTRL+E'*/ );
    menu.addButton(TR('fileExportPLY'), this, 'saveFileAsPLY');
    menu.addButton(TR('fileExportSTL'), this, 'saveFileAsSTL');
    menu.addCheckbox('OBJ color zbrush', this, '_objColorZbrush');
    menu.addCheckbox('OBJ color append', this, '_objColorAppended');
    menu.addButton(TR('sketchfabTitle'), this._ctrlGui, 'exportSketchfab');

    // export texture
    menu.addTitle(TR('fileExportTextureTitle'));
    this._guiTexSize = menu.addSlider(TR('fileExportTextureSize'), 10, this.onTextureSize.bind(this), 8, 12, 1);
    this._guiTexSize.setValue(10);
    menu.addButton(TR('fileExportColor'), this, 'saveColor');
    menu.addButton(TR('fileExportRoughness'), this, 'saveRoughness');
    menu.addButton(TR('fileExportMetalness'), this, 'saveMetalness');
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
    this._guiTexSize.domInputText.value = this._texSize;
  }

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
      window.alert('The selected mesh has no UV!');
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

  saveFileAsSGL() {
    var meshes = this._getExportMeshes();
    if (!meshes) return;
    this._save(Export.exportSGL(meshes, this._main), this._getTimestampedFileName('yourMesh', 'sxr'));
  }

  saveToBrowserStorage() {
    var meshes = this._getExportMeshes();
    if (!meshes) return;
    
    const blob = Export.exportSGL(meshes, this._main);
    const timestamp = Date.now();
    const key = `sculpt_${timestamp}`;

    // Grab thumbnail from canvas
    let thumb = '';
    const canvas = document.getElementById('canvas');
    if (canvas && this._main._renderer) {
      if (!this._main._renderer.xr.isPresenting) {
        this._main._renderer.render(this._main._scene, this._main._camera._threeCamera);
        thumb = canvas.toDataURL('image/jpeg', 0.3); 
      } else {
        // VR Real Screenshot: Temporarily disable XR to render a flat pass to the DOM canvas!
        const renderer = this._main._renderer;
        const wasXREnabled = renderer.xr.enabled;
        
        let camToUse = this._main._camera._threeCamera;
        if (renderer.xr.isPresenting) {
          const vrCam = renderer.xr.getCamera(this._main._camera._threeCamera);
          if (vrCam && vrCam.cameras && vrCam.cameras.length > 0) {
            camToUse = vrCam.cameras[0]; // Use left eye perspective!
          }
        }
        
        try {
          renderer.xr.enabled = false; // Bypass VR layer for one draw
          renderer.setRenderTarget(null); // Force bind to DOM canvas
          camToUse.updateMatrixWorld(true); // Ensure matrix is accurate!
          
          // 1. Calculate bounding box of the world group (where the sculpt lives)
          const box = new THREE.Box3().setFromObject(this._main._worldGroup);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);

          // 2. Hide ALL scene children except the worldGroup and lights (Ultra clean!)
          const activeChildren = [];
          this._main._scene.children.forEach(child => {
            if (child.visible) {
              activeChildren.push(child);
              if (child !== this._main._worldGroup && !child.isLight) {
                child.visible = false;
              }
            }
          });

          // 3. Create transient camera at user's head, looking at the sculpture
          const midCam = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
          midCam.position.copy(renderer.xr.getCamera(this._main._camera._threeCamera).position);
          midCam.lookAt(center); // Lock on!

          // 4. Auto-FOV to fill the screen
          const distanceToCenter = midCam.position.distanceTo(center);
          if (distanceToCenter > 0.01 && maxDim > 0.01) {
            const requiredFov = 2 * Math.atan(maxDim / (2 * distanceToCenter)) * (180 / Math.PI);
            midCam.fov = Math.min(70, Math.max(5, requiredFov * 1.3)); // Soft padding clip
            midCam.updateProjectionMatrix();
          }
          midCam.updateMatrixWorld(true);

          renderer.render(this._main._scene, midCam);
          
          // Capture to offscreen 2D canvas to apply color correction synchronously!
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = canvas.width;
          tempCanvas.height = canvas.height;
          const tempCtx = tempCanvas.getContext('2d');
          
          tempCtx.filter = 'contrast(1.4) brightness(0.8) saturate(1.2)';
          tempCtx.drawImage(canvas, 0, 0);
          
          thumb = tempCanvas.toDataURL('image/jpeg', 0.2); // Compressed
          
          // 5. Restore UI
          activeChildren.forEach(child => {
            child.visible = true;
          });
          
        } catch (e) {
          console.error("Screenshot failed:", e);
        } finally {
          renderer.xr.enabled = wasXREnabled; // Restore VR loop immediately
        }
      }
    }

    StorageDB.set(key, { 
      blob: blob, 
      thumb: thumb, 
      name: this._getTimestampedFileName('browser', '').replace('.', ''), // Clean name without extension
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

  loadSpecificBrowserSave(key) {
    if (window.screenLog) window.screenLog(`Loading ${key}...`, 'cyan');
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

  saveFileAsGLB() {
    var meshes = this._getExportMeshes();
    if (!meshes) return;
    this._save(Export.exportGLB(meshes), this._getTimestampedFileName('yourMesh', 'glb'));
  }

  saveFileAsOBJ() {
    var meshes = this._getExportMeshes();
    if (!meshes) return;
    this._save(Export.exportOBJ(meshes, this._objColorZbrush, this._objColorAppended), this._getTimestampedFileName('yourMesh', 'obj'));
  }

  saveFileAsPLY() {
    var meshes = this._getExportMeshes();
    if (!meshes) return;
    this._save(Export.exportBinaryPLY(meshes), this._getTimestampedFileName('yourMesh', 'ply'));
  }

  saveFileAsSTL() {
    var meshes = this._getExportMeshes();
    if (!meshes) return;
    this._save(Export.exportBinarySTL(meshes), this._getTimestampedFileName('yourMesh', 'stl'));
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
