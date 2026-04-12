import { vec3, mat4 } from 'gl-matrix';
import TR from './GuiTR.js';
import Remesh from '../editing/Remesh.js';
import Mesh from '../mesh/Mesh.js';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';
import Multimesh from '../mesh/multiresolution/Multimesh.js';
import MeshDynamic from '../mesh/dynamic/MeshDynamic.js';
import StateMultiresolution from '../states/StateMultiresolution.js';
import getOptionsURL from '../misc/getOptionsURL.js';
import Enums from '../misc/Enums.js';
import VoxelDensityOverlay from '../render/VoxelDensityOverlay.js';


class GuiMultiresolution {

  constructor(guiParent, ctrlGui) {
    this._ctrlGui = ctrlGui;
    this._main = ctrlGui._main; // main application
    this._menu = null; // ui menu
    this._ctrlResolution = null; // multiresolution controller
    this._ctrlDynamic = null; // dynamic topology controller
    this._targetFaces = 1000; // Target faces for quad remeshing
    this.init(guiParent);
  }

  init(guiParent) {
    var menu = this._menu = guiParent.addMenu(TR('topologyTitle'));
    menu.close();

    // multires
    menu.addTitle(TR('multiresTitle'));
    this._ctrlResolution = menu.addSlider(TR('multiresResolution'), 1, this.onResolutionChanged.bind(this), 1, 1, 1);
    var dual = menu.addDualButton(TR('multiresReverse'), TR('multiresSubdivide'), this, this, 'reverse', 'subdivide');
    this._ctrlReverse = dual[0];
    this._ctrlSubdivide = dual[1];
    dual = this._dualButtonDel = menu.addDualButton(TR('multiresDelLower'), TR('multiresDelHigher'), this, this, 'deleteLower', 'deleteHigher');
    this._ctrlDelLower = dual[0];
    this._ctrlDelHigher = dual[1];
    this._ctrlDelLower.domButton.style.background = this._ctrlDelHigher.domButton.style.background = 'rgba(230,53,59,0.35)';

    var cbResolution = this.remeshResolution.bind(this);

    // surface nets remeshing
    menu.addTitle(TR('remeshTitle'));
    this._ctrlRes1 = menu.addSlider(TR('remeshResolution'), Remesh.RESOLUTION, cbResolution, 8, 400, 1);
    menu.addCheckbox(TR('remeshBlock'), Remesh, 'BLOCK');
    menu.addButton(TR('remeshRemesh'), this, 'remesh');

    // marching cube remeshing
    menu.addTitle(TR('remeshTitleMC'));
    this._ctrlRes2 = menu.addSlider(TR('remeshResolution'), Remesh.RESOLUTION, cbResolution, 8, 400, 1);
    menu.addCheckbox(TR('remeshSmoothingMC'), Remesh, 'SMOOTHING');
    menu.addButton(TR('remeshRemeshMC'), this, 'remeshMC');

    // dynamic
    menu.addTitle(TR('dynamicTitle'));
    this._ctrlDynamic = menu.addCheckbox(TR('dynamicActivated'), false, this.dynamicToggleActivate.bind(this));
    this._ctrlDynSubd = menu.addSlider(TR('dynamicSubdivision'), MeshDynamic, 'SUBDIVISION_FACTOR', 0, 100, 1);
    this._ctrlDynDec = menu.addSlider(TR('dynamicDecimation'), MeshDynamic, 'DECIMATION_FACTOR', 0, 100, 1);
    this._ctrlDynLin = menu.addCheckbox(TR('dynamicLinear'), MeshDynamic, 'LINEAR');
    // voxel conversion
    menu.addTitle('Voxel Conversion');
    menu.addButton('Convert Mesh to Voxels', this, 'meshToVoxel');

    // quad remeshing
    menu.addTitle('Quad Remeshing');
    menu.addSlider('Target Faces', this, '_targetFaces', 100, 10000, 100);
    menu.addButton('Quadremesh', this, 'remeshQuads');

    menu.addTitle('Mesh Validation');
    menu.addButton('Validate Topology', this, 'validateMesh');

    this.updateDynamicVisibility(false);
  }

  meshToVoxel() {
    var main = this._main;
    var mesh = main.getMesh();
    if (!mesh)
      return;

    main.getSculptManager().meshToVoxel();
    
    // Switch to Voxel tool
    if (main.getGui() && main.getGui()._ctrlSculpting) {
      const vTool = Enums.Tools.VOXEL;
      main.getGui()._ctrlSculpting._ctrlSculpt.setValue(String(vTool)); // Ensure string for dat.gui keys
    }
  }

  remeshQuads() {
    var main = this._main;
    var mesh = main.getMesh();
    if (!mesh)
      return;

    const sculptMgr = main.getSculptManager();
    if (sculptMgr.isProcessingQuads && sculptMgr.isProcessingQuads()) return; // Prevent duplicate clicks!

    sculptMgr.remeshQuads(this._targetFaces);
  }

  validateMesh() {
    var mesh = this._main.getMesh();
    if (!mesh) {
      console.warn('Validate: No active mesh found.');
      return;
    }

    // Dereference multires wrapper if active
    var activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    var fAr = activeMesh.getFaces();
    var vAr = activeMesh.getVertices();
    var nbFaces = activeMesh.getNbFaces();
    
    var degenerateFaces = 0;
    var nonManifoldEdges = 0;
    var inconsistentWinding = 0;
    
    // Track directional edges map (stringified A_B -> count) to detect winding consistency and valence > 2
    var edgeMap = new Map();

    for (var i = 0; i < nbFaces; i++) {
      var id = i * 4;
      var v1 = fAr[id];
      var v2 = fAr[id + 1];
      var v3 = fAr[id + 2];
      var isQuad = fAr[id + 3] !== (4294967295); // TRI_INDEX
      var v4 = isQuad ? fAr[id + 3] : -1;

      // 1. Degenerate Face Check
      if (v1 === v2 || v2 === v3 || v3 === v1 || (isQuad && (v4 === v1 || v4 === v2 || v4 === v3))) {
        degenerateFaces++;
      }

      // Build directed edges
      var edges = [
        [v1, v2],
        [v2, v3]
      ];
      if (isQuad) {
        edges.push([v3, v4], [v4, v1]);
      } else {
        edges.push([v3, v1]);
      }

      for (var e = 0; e < edges.length; e++) {
        var a = edges[e][0];
        var b = edges[e][1];
        var key = a + '_' + b;
        var invKey = b + '_' + a;

        // Multiple directed entries in the exact same direction indicates either duplicate faces or reversed winding order!
        if (edgeMap.has(key)) {
          inconsistentWinding++;
        }
        
        // Track undirected valence to find > 2 face sharing non-manifoldness
        var undirectedKey = Math.min(a, b) + '_' + Math.max(a, b);
        var currentValence = edgeMap.get(undirectedKey) || 0;
        if (currentValence >= 2) {
          nonManifoldEdges++;
        }
        edgeMap.set(undirectedKey, currentValence + 1);
        edgeMap.set(key, true);
      }
    }

    const logStr = 'Mesh Validation Results:\n' +
                   '- Degenerate Faces: ' + degenerateFaces + '\n' +
                   '- Inconsistent Windings: ' + inconsistentWinding + '\n' +
                   '- Non-Manifold Edges: ' + nonManifoldEdges;

    if (window.screenLog) {
      window.screenLog(logStr, (degenerateFaces || inconsistentWinding || nonManifoldEdges) ? 'red' : 'lime');
    } else {
      console.log(logStr);
    }
  }

  onKeyUp(event) {
    if (event.handled === true)
      return;

    var shk = getOptionsURL.getShortKey(event.which);
    event.stopPropagation();

    if (shk === Enums.KeyAction.REMESH) {
      this.remesh();
    }
  }

  updateDynamicVisibility(bool) {
    this._ctrlDynSubd.setVisibility(bool);
    this._ctrlDynDec.setVisibility(bool);
    this._ctrlDynLin.setVisibility(bool);
  }

  dynamicToggleActivate() {
    var main = this._main;
    var mesh = main.getMesh();
    if (!mesh)
      return;

    var newMesh = !mesh.isDynamic ? new MeshDynamic(mesh) : this.convertToStaticMesh(mesh);
    this.updateDynamicVisibility(!mesh.isDynamic);

    main.getStateManager().pushStateAddRemove(newMesh, mesh);
    main.replaceMesh(mesh, newMesh);
  }

  remeshResolution(val) {
    Remesh.RESOLUTION = val;
    if (this._ctrlRes1) this._ctrlRes1.setValue(val, true);
    if (this._ctrlRes2) this._ctrlRes2.setValue(val, true);

    var mesh = this._main.getMesh();
    if (mesh) {
      VoxelDensityOverlay.poke(mesh, val);
    }
  }

  remesh(manifold) {
    var main = this._main;
    var mesh = main.getMesh();
    if (!mesh) return;

    // Use the incredibly stable Rust-based Voxel -> Multimesh pipeline!
    var voxelTool = main.getSculptManager().getTool(Enums.Tools.VOXEL);
    if (voxelTool) {
      voxelTool._autoBake = true;
    }
    this.meshToVoxel();
  }

  remeshMC() {
    this.remesh(true);
  }

  /** Check if the mesh is a multiresolution one */
  isMultimesh(mesh) {
    return !!(mesh && mesh._meshes);
  }

  convertToStaticMesh(mesh) {
    if (!mesh.isDynamic) // already static
      return mesh;

    // dynamic to static mesh
    var newMesh = new MeshStatic(mesh.getGL());
    newMesh.setID(mesh.getID());
    newMesh.setTransformData(mesh.getTransformData());
    newMesh.setVertices(mesh.getVertices().subarray(0, mesh.getNbVertices() * 3));
    newMesh.setColors(mesh.getColors().subarray(0, mesh.getNbVertices() * 3));
    newMesh.setMaterials(mesh.getMaterials().subarray(0, mesh.getNbVertices() * 3));
    newMesh.setFaces(mesh.getFaces().subarray(0, mesh.getNbFaces() * 4));

    Mesh.OPTIMIZE = false;
    newMesh.init();
    Mesh.OPTIMIZE = true;

    newMesh.setRenderData(mesh.getRenderData());
    newMesh.initRender();
    return newMesh;
  }

  /** Convert a mesh into a multiresolution one */
  convertToMultimesh(mesh) {
    if (this.isMultimesh(mesh))
      return mesh;
    var multimesh = new Multimesh(this.convertToStaticMesh(mesh));
    return multimesh;
  }

  /** Subdivide the mesh */
  subdivide() {
    var main = this._main;
    var mesh = main.getMesh();
    if (!mesh)
      return;

    var mul = this.convertToMultimesh(mesh);
    if (mul._sel !== mul._meshes.length - 1) {
      if (window.screenLog) window.screenLog(TR('multiresSelectHighest'), 'orange');
      else console.warn(TR('multiresSelectHighest'));
      return;
    }

    if (mul.getNbTriangles() > 400000) {
      // In VR, assume automatic confirmation to avoid locking the XR thread
      if (window.screenLog) window.screenLog(TR('multiresWarnBigMesh', mul.getNbFaces() * 4), 'yellow');
    }

    if (mesh !== mul) {
      main.replaceMesh(mesh, mul);
      main.getStateManager().pushStateAddRemove(mul, mesh, true);
    }

    main.getStateManager().pushState(new StateMultiresolution(main, mul, StateMultiresolution.SUBDIVISION));
    mul.addLevel();
    main.setMesh(mul);
    main.render();
  }

  /** Inverse subdivision */
  reverse() {
    var main = this._main;
    var mesh = main.getMesh();
    if (!mesh)
      return;

    var mul = this.convertToMultimesh(mesh);
    if (mul._sel !== 0) {
      if (window.screenLog) window.screenLog(TR('multiresSelectLowest'), 'orange');
      else console.warn(TR('multiresSelectLowest'));
      return;
    }

    var stateRes = new StateMultiresolution(main, mul, StateMultiresolution.REVERSION);
    var newMesh = mul.computeReverse();
    if (!newMesh) {
      if (window.screenLog) window.screenLog(TR('multiresNotReversible'), 'orange');
      else console.warn(TR('multiresNotReversible'));
      return;
    }

    if (mesh !== mul) {
      main.replaceMesh(mesh, mul);
      main.getStateManager().pushStateAddRemove(mul, mesh, true);
    }

    main.getStateManager().pushState(stateRes);
    main.setMesh(mul);
    main.render();
  }

  /** Delete the lower meshes */
  deleteLower() {
    var main = this._main;
    var mul = main._mesh;
    if (!this.isMultimesh(mul) || mul._sel === 0) {
      if (window.screenLog) window.screenLog(TR('multiresNoLower'), 'orange');
      else console.warn(TR('multiresNoLower'));
      return;
    }

    main.getStateManager().pushState(new StateMultiresolution(main, mul, StateMultiresolution.DELETE_LOWER));
    mul.deleteLower();
    this.updateMeshResolution();
  }

  /** Delete the higher meshes */
  deleteHigher() {
    var main = this._main;
    var mul = main.getMesh();
    if (!this.isMultimesh(mul) || mul._sel === mul._meshes.length - 1) {
      if (window.screenLog) window.screenLog(TR('multiresNoHigher'), 'orange');
      else console.warn(TR('multiresNoHigher'));
      return;
    }

    main.getStateManager().pushState(new StateMultiresolution(main, mul, StateMultiresolution.DELETE_HIGHER));
    mul.deleteHigher();
    this.updateMeshResolution();
  }

  /** Change resoltuion */
  onResolutionChanged(value) {
    var uiRes = value - 1;
    var main = this._main;
    var multimesh = main.getMesh();
    if (!multimesh) return;
    var isMulti = this.isMultimesh(multimesh);
    var isLast = isMulti && multimesh._meshes.length - 1 === uiRes;

    this._ctrlReverse.setEnable(!isMulti || uiRes === 0);
    this._ctrlSubdivide.setEnable(!isMulti || isLast);
    this._ctrlDelLower.setEnable(isMulti && uiRes !== 0);
    this._ctrlDelHigher.setEnable(isMulti && !isLast);

    if (!isMulti || multimesh._sel === uiRes)
      return;

    main.getStateManager().pushState(new StateMultiresolution(main, multimesh, StateMultiresolution.SELECTION));
    multimesh.selectResolution(uiRes);
    this._ctrlGui.updateMeshInfo();
    main.render();
  }

  /** Update the mesh resolution slider */
  updateMeshResolution() {
    var multimesh = this._main.getMesh();
    if (!multimesh || !this.isMultimesh(multimesh)) {
      this._ctrlResolution.setMax(1);
      this._ctrlResolution.setValue(0);
      return;
    }
    this._ctrlResolution.setMax(multimesh._meshes.length);
    this._ctrlResolution.setValue(multimesh._sel + 1);
  }

  /** Update topology information */
  updateMesh() {
    if (!this._main.getMesh()) {
      this._menu.setVisibility(false);
      return;
    }
    this._menu.setVisibility(true);
    this.updateMeshResolution();
    var bool = this._main.getMesh().isDynamic;
    this.updateDynamicVisibility(bool);
    this._ctrlDynamic.setValue(bool, true);
  }
}

export default GuiMultiresolution;
