import Enums from 'misc/Enums';
import TR from 'gui/GuiTR';
import Shader from 'render/ShaderLib';

export default function getRenderingWidgets(main) {
  const widgets = [];
  const mesh = main.getMesh();
  if (!mesh) return widgets;

  const shaderType = mesh.getShaderType();
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
    { label: TR('renderingNormal'), id: Enums.Shader.NORMAL },
    { label: TR('renderingUV'), id: Enums.Shader.UV }
  ];

  widgets.push({
    type: 'combobox',
    id: 'shader_type',
    label: '',
    x: col1X, y: y, w: 400, h: btnH,
    value: shaderType,
    options: shaderOptions,
    onSelect: (id) => {
      // console.log(`[GuiVR] onSelect shader id: ${id} (type: ${typeof id})`);
      if (id === Enums.Shader.UV && !mesh.hasUV()) {
        console.warn("[GuiVR] Cannot switch to UV Shader: Mesh has no UVs.");
        return;
      }
      mesh.setShaderType(id);
      main.render();
      if (main.guiXR) main.guiXR._needsUpdate = true;
    }
  });
  y += btnH + gapBtn;

  // Curvature
  widgets.push({
    type: 'slider',
    id: 'curvature',
    label: TR('renderingCurvature'),
    x: col1X, y: y, w: 400, h: 40,
    min: 0, max: 100,
    value: mesh.getCurvature() * 20.0, 
    onInput: (val) => { mesh.setCurvature(val / 20.0); main.render(); }
  });
  y += 40 + gapBtn;

  // Filmic Tonemapping
  widgets.push({
    type: 'checkbox',
    id: 'filmic',
    label: TR('renderingFilmic'),
    x: col1X, y: y, w: 400, h: btnH,
    value: ShaderMERGE.FILMIC,
    onInteract: () => {
      ShaderMERGE.FILMIC = !ShaderMERGE.FILMIC;
      main.render();
      if (main.guiXR) main.guiXR._needsUpdate = true;
    } 
  });
  y += btnH + gapSection;


  // --- 2. ENVIRONMENT (PBR) ---
  if (shaderType === Enums.Shader.PBR) {
    widgets.push({ type: 'info', label: TR('renderingEnvironment'), x: col1X, y: y });
    y += gapHeader;

    const envOptions = ShaderPBR.environments.map((env, i) => ({ label: env.name, id: i }));
    widgets.push({
      type: 'combobox',
      id: 'environment',
      label: '',
      x: col1X, y: y, w: 400, h: btnH,
      value: ShaderPBR.idEnv,
      options: envOptions,
      onSelect: (id) => {
        ShaderPBR.idEnv = id;
        main.render();
        if (main.guiXR) main.guiXR._needsUpdate = true;
      }
    });
    y += btnH + gapBtn;

    // PBR Exposure (Visible only in PBR in desktop)
    widgets.push({
      type: 'slider',
      id: 'exposure',
      label: TR('renderingExposure'),
      x: col1X, y: y, w: 400, h: 40,
      value: ShaderPBR.exposure,
      min: 0, max: 5,
      onInput: (val) => { ShaderPBR.exposure = val; main.render(); }
    });
    y += 40 + gapSection;
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
      x: col1X, y: y, w: 400, h: btnH,
      value: mesh.getMatcap(),
      options: matcapOptions,
      onSelect: (id) => {
        mesh.setMatcap(id);
        main.render();
        if (main.guiXR) main.guiXR._needsUpdate = true;
      }
    });
    y += btnH + gapBtn;

    widgets.push({
      type: 'button',
      id: 'import_matcap',
      label: TR('renderingImportMatcap'),
      x: col1X, y: y, w: 400, h: btnH,
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
      x: col1X, y: y, w: 400, h: btnH,
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
    x: col1X, y: y, w: 400, h: 40,
    value: (1.0 - mesh.getOpacity()) * 100,
    onInput: (val) => {
      mesh.setOpacity(1.0 - val / 100.0);
      main.render();
    }
  });
  y += 40 + gapBtn;

  widgets.push({
    type: 'checkbox',
    id: 'flat',
    label: TR('renderingFlat'),
    x: col1X, y: y, w: 400, h: btnH,
    value: mesh.getFlatShading(),
    onInteract: () => { mesh.setFlatShading(!mesh.getFlatShading()); main.render(); if (main.guiXR) main.guiXR._needsUpdate = true; }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'checkbox',
    id: 'wireframe',
    label: TR('renderingWireframe'),
    x: col1X, y: y, w: 400, h: btnH,
    value: mesh.getShowWireframe(),
    onInteract: () => { mesh.setShowWireframe(!mesh.getShowWireframe()); main.render(); if (main.guiXR) main.guiXR._needsUpdate = true; }
  });
  y += btnH + gapSection;

  return widgets;
}
