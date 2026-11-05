import ExportOBJ from './ExportOBJ.js';
import ExportSGL from './ExportSGL.js';
import ExportPLY from './ExportPLY.js';
import ExportSTL from './ExportSTL.js';
import ExportSketchfab from './ExportSketchfab.js';
import ExportSculpteo from './ExportSculpteo.js';
import ExportMaterialise from './ExportMaterialise.js';
import ExportNOM from './ExportNOM.js';
import ExportGLTF from './ExportGLTF.js';
import IKSolver from '../editing/IKSolver.js';

var Export = {};
Export.exportOBJ = ExportOBJ.exportOBJ;
Export.exportSGL = (meshes, main) => IKSolver.atPoseHome(main, () => ExportSGL.exportSGL(meshes, main));
Export.exportAsciiPLY = ExportPLY.exportAsciiPLY;
Export.exportBinaryPLY = ExportPLY.exportBinaryPLY;
Export.exportAsciiSTL = ExportSTL.exportAsciiSTL;
Export.exportBinarySTL = ExportSTL.exportBinarySTL;
Export.exportSketchfab = ExportSketchfab.exportSketchfab;
Export.exportSculpteo = ExportSculpteo.exportSculpteo;
Export.exportMaterialise = ExportMaterialise.exportMaterialise;
Export.exportGLB = ExportGLTF.exportGLB;
Export.exportNOM = ExportNOM.exportNOM;
Export.writeNOM = ExportNOM.writeNOM;

export default Export;
