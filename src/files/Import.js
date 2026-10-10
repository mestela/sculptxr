import ImportGLTF from './ImportGLTF.js';
import ImportNOM from './ImportNOM.js';
import ImportOBJ from './ImportOBJ.js';
import ImportSGL from './ImportSGL.js';
import ImportPLY from './ImportPLY.js';
import ImportSTL from './ImportSTL.js';

var Import = {
  importGLTF: ImportGLTF.importGLTF,
  importNOM: ImportNOM.importNOM,
  buildNOMLevels: ImportNOM.buildLevels,
  importOBJ: ImportOBJ.importOBJ,
  importSGL: ImportSGL.importSGL,
  importPLY: ImportPLY.importPLY,
  importSTL: ImportSTL.importSTL
};

export default Import;
