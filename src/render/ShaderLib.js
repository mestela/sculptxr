import Enums from 'misc/Enums';

import ShaderPBR from 'render/shaders/ShaderPBR';
import ShaderMatcap from 'render/shaders/ShaderMatcap';
import ShaderNormal from 'render/shaders/ShaderNormal';
import ShaderUV from 'render/shaders/ShaderUV';
import ShaderWireframe from 'render/shaders/ShaderWireframe';
import ShaderFlat from 'render/shaders/ShaderFlat';
import ShaderSelection from 'render/shaders/ShaderSelection';

import ShaderBackground from 'render/shaders/ShaderBackground';
import ShaderMerge from 'render/shaders/ShaderMerge';
import ShaderFxaa from 'render/shaders/ShaderFxaa';
import ShaderContour from 'render/shaders/ShaderContour';

import ShaderPaintUV from 'render/shaders/ShaderPaintUV';
import ShaderBlur from 'render/shaders/ShaderBlur';
import ShaderTexture from 'render/shaders/ShaderTexture';

import ShaderUnlit from 'render/shaders/ShaderUnlit';
import ShaderFresnel from 'render/shaders/ShaderFresnel';

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
