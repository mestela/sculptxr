import Enums from '../misc/Enums.js?v=fix_3';

import ShaderPBR from './shaders/ShaderPBR.js?v=fix_3';
import ShaderMatcap from './shaders/ShaderMatcap.js?v=fix_3';
import ShaderNormal from './shaders/ShaderNormal.js?v=fix_3';
import ShaderUV from './shaders/ShaderUV.js?v=fix_3';
import ShaderWireframe from './shaders/ShaderWireframe.js?v=fix_3';
import ShaderFlat from './shaders/ShaderFlat.js?v=fix_3';
import ShaderSelection from './shaders/ShaderSelection.js?v=fix_3';

import ShaderBackground from './shaders/ShaderBackground.js?v=fix_3';
import ShaderMerge from './shaders/ShaderMerge.js?v=fix_3';
import ShaderFxaa from './shaders/ShaderFxaa.js?v=fix_3';
import ShaderContour from './shaders/ShaderContour.js?v=fix_3';

import ShaderPaintUV from './shaders/ShaderPaintUV.js?v=fix_3';
import ShaderBlur from './shaders/ShaderBlur.js?v=fix_3';
import ShaderTexture from './shaders/ShaderTexture.js?v=fix_3';

import ShaderUnlit from './shaders/ShaderUnlit.js?v=fix_3';
import ShaderFresnel from './shaders/ShaderFresnel.js?v=fix_3';

var ShaderLib = [];

// 3D shaders
ShaderLib[Enums.Shader.PBR] = ShaderPBR;
ShaderLib[Enums.Shader.MATCAP] = ShaderMatcap;
ShaderLib[Enums.Shader.NORMAL] = ShaderNormal;
ShaderLib[Enums.Shader.UV] = ShaderUV;
ShaderLib[Enums.Shader.WIREFRAME] = ShaderWireframe;
ShaderLib[Enums.Shader.FLAT] = ShaderFlat;
ShaderLib[Enums.Shader.SELECTION] = ShaderSelection;
ShaderLib[Enums.Shader.UNLIT] = ShaderUnlit;
ShaderLib[Enums.Shader.FRESNEL] = ShaderFresnel;

// 2D screen shaders
ShaderLib[Enums.Shader.BACKGROUND] = ShaderBackground;
ShaderLib[Enums.Shader.MERGE] = ShaderMerge;
ShaderLib[Enums.Shader.FXAA] = ShaderFxaa;
ShaderLib[Enums.Shader.CONTOUR] = ShaderContour;

// misc
ShaderLib[Enums.Shader.PAINTUV] = ShaderPaintUV;
ShaderLib[Enums.Shader.BLUR] = ShaderBlur;
ShaderLib[Enums.Shader.TEXTURE] = ShaderTexture;

export default ShaderLib;
