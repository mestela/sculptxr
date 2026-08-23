import Enums from '../../misc/Enums.js';
import getOptionsURL from '../../misc/getOptionsURL.js';
import TR from '../GuiTR.js';
import Shader from '../../render/ShaderLib.js';

export default function getRenderingWidgets(main) {
  const widgets = [];
  let mesh = main.getMesh() || main.getMeshes?.().find(m => !m._isBone && !m._isNull && !m._isReference);
  if (!mesh) return widgets;

  const meshes = main.getSelectedMeshes().length > 0 ? main.getSelectedMeshes() : [mesh];

  const shaderType = getOptionsURL().shader;
  const ShaderMERGE = Shader[Enums.Shader.MERGE];
  const ShaderPBR = Shader[Enums.Shader.PBR];
  const ShaderMATCAP = Shader[Enums.Shader.MATCAP];

  const col1X = 20;
  const btnH = 50;
  const gapBtn = 15;
  const gapSection = 30;
  const gapHeader = 30;
  let y = 130;

  // --- 1. SHADER ---
  widgets.push({ type: 'info', label: TR('renderingShader'), x: col1X, y: y });
  y += gapHeader;

  // Shader Selection
  const shaderOptions = [
    { label: TR('renderingMatcap'), id: Enums.Shader.MATCAP },
    { label: TR('renderingPBR'), id: Enums.Shader.PBR },
    { label: TR('renderingFlatMat') || 'Flat', id: Enums.Shader.FLAT },
    { label: TR('renderingNormal'), id: Enums.Shader.NORMAL },
    { label: TR('renderingUV'), id: Enums.Shader.UV }
  ];

  widgets.push({
    type: 'combobox',
    id: 'shader_type',
    label: '',
    x: col1X, y: y, w: 360, h: btnH,
    value: shaderType,
    options: shaderOptions,
    onSelect: (id) => {
      // console.log(`[GuiVR] onSelect shader id: ${id} (type: ${typeof id})`);
      getOptionsURL.setGlobalShader(main, id);
      if (main.guiXR) main.guiXR._needsUpdate = true;
    }
  });
  y += btnH + gapBtn;

  // Curvature
  widgets.push({
    type: 'slider',
    id: 'curvature',
    label: TR('renderingCurvature'),
    x: col1X, y: y, w: 360, h: 50,
    min: 0, max: 100,
    value: mesh.getCurvature() * 20.0, 
    onInput: (val) => { meshes.forEach(m => m.setCurvature(val / 20.0)); main.render(); }
  });
  y += 50 + gapBtn;

  // Tone Mapping
  const toneMappingOptions = [
    { label: 'None', id: 0 },
    { label: 'Linear', id: 1 },
    { label: 'Reinhard', id: 2 },
    { label: 'Cineon', id: 3 },
    { label: 'ACESFilmic', id: 4 }
  ];

  widgets.push({
    type: 'combobox',
    id: 'tone_mapping',
    label: 'Tone Mapping',
    x: col1X, y: y, w: 360, h: btnH,
    value: main.getToneMapping(),
    options: toneMappingOptions,
    onSelect: (id) => {
      main.setToneMapping(id);
      if (main.guiXR) main.guiXR._needsUpdate = true;
    }
  });
  y += btnH + gapBtn;

  // Exposure
  widgets.push({
    type: 'slider',
    id: 'exposure',
    label: 'Exposure',
    x: col1X, y: y, w: 360, h: 50,
    min: 0, max: 3,
    value: main.getExposure(),
    onInput: (val) => {
      main.setExposure(val);
    }
  });
  y += 50 + gapSection;


  // --- 2. ENVIRONMENT (PBR) ---
  if (shaderType === Enums.Shader.PBR) {
    widgets.push({ type: 'info', label: TR('renderingEnvironment'), x: col1X, y: y });
    y += gapHeader;

    const envOptions = ShaderPBR.environments.map((env, i) => ({ label: env.name, id: i }));
    widgets.push({
      type: 'combobox',
      id: 'environment',
      label: '',
      x: col1X, y: y, w: 360, h: btnH,
      value: ShaderPBR.idEnv,
      options: envOptions,
      onSelect: (id) => {
        ShaderPBR.idEnv = id;
        getOptionsURL.saveOption('environment', id);
        main.render();
        if (main.guiXR) main.guiXR._needsUpdate = true;
      }
    });
    y += btnH + gapBtn;


  }

  // --- 3. MATERIAL (MATCAP) ---
  if (shaderType === Enums.Shader.MATCAP) {
    widgets.push({ type: 'info', label: TR('renderingMaterial'), x: col1X, y: y });
    y += gapHeader;

    const matcaps = ShaderMATCAP.matcaps;
    const matcapOptions = matcaps.map((m, i) => ({ label: m.name, id: i }));
    widgets.push({
      type: 'combobox',
      id: 'matcap',
      label: '',
      x: col1X, y: y, w: 360, h: btnH,
      value: mesh.getMatcap(),
      options: matcapOptions,
      onSelect: (id) => {
        meshes.forEach(m => m.setMatcap(id));
        getOptionsURL.saveOption('matcap', id);
        main.render();
        if (main.guiXR) main.guiXR._needsUpdate = true;
      }
    });
    y += btnH + gapBtn;

    widgets.push({
      type: 'button',
      id: 'import_matcap',
      label: TR('renderingImportMatcap'),
      x: col1X, y: y, w: 360, h: btnH,
      onInteract: () => {
        const el = document.getElementById('matcapopen');
        if (el) el.click();
      }
    });
    y += btnH + gapSection;
  }

  // --- 4. UV (Texture) ---
  if (shaderType === Enums.Shader.UV) {
    // Desktop puts 'Import UV' button here.
    widgets.push({ type: 'info', label: TR('renderingMaterial'), x: col1X, y: y });
    y += gapHeader;

    widgets.push({
      type: 'button',
      id: 'import_uv',
      label: TR('renderingImportUV'),
      x: col1X, y: y, w: 360, h: btnH,
      onInteract: () => {
        const el = document.getElementById('textureopen');
        if (el) el.click();
      }
    });
    y += btnH + gapSection;
  }

  // --- 5. EXTRA ---
  widgets.push({ type: 'info', label: TR('renderingExtra'), x: col1X, y: y });
  y += gapHeader;

  widgets.push({
    type: 'slider',
    id: 'transparency',
    label: TR('renderingTransparency'),
    x: col1X, y: y, w: 360, h: 50,
    value: (1.0 - mesh.getOpacity()) * 100,
    onInput: (val) => {
      meshes.forEach(m => m.setOpacity(1.0 - val / 100.0));
      main.render();
    }
  });
  y += 50 + gapBtn;

  widgets.push({
    type: 'checkbox',
    id: 'flat',
    label: TR('renderingFlat'),
    x: col1X, y: y, w: 360, h: btnH,
    value: getOptionsURL().flatshading,
    onInteract: () => { 
      const target = !getOptionsURL().flatshading;
      getOptionsURL.setGlobalFlatShading(main, target);
      if (main.guiXR) main.guiXR._needsUpdate = true; 
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'checkbox',
    id: 'wireframe',
    label: TR('renderingWireframe'),
    x: col1X, y: y, w: 360, h: btnH,
    value: getOptionsURL().wireframe,
    onInteract: () => { 
      const target = !getOptionsURL().wireframe;
      getOptionsURL.setGlobalWireframe(main, target);
      if (main.guiXR) main.guiXR._needsUpdate = true; 
    }
  });
  y += btnH + gapBtn; // Fix: Separate the overlapping buttons!

  widgets.push({
    type: 'checkbox',
    id: 'solid_shading',
    label: 'Solid Shading',
    x: col1X, y: y, w: 360, h: btnH,
    value: mesh._renderData && mesh._renderData._threeMesh ? mesh._renderData._threeMesh.material.visible : true,
    onInteract: () => { 
      meshes.forEach(m => {
          if (m._renderData && m._renderData._threeMesh && m._renderData._threeMesh.material) {
              m._renderData._threeMesh.material.visible = !m._renderData._threeMesh.material.visible;
          }
      }); 
      main.render(); 
      if (main.guiXR) main.guiXR._needsUpdate = true; 
    }
  });
  y += btnH + gapSection;

  return widgets;
}
