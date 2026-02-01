import Enums from 'misc/Enums';
import TR from 'gui/GuiTR';

export default function getRenderingWidgets(main) {
  const widgets = [];
  const col1X = 20;

  const btnH = 60;
  const gapBtn = 20;
  const gapSection = 40;
  const gapHeader = 40;

  let y = 130;

  // --- SHADER ---
  widgets.push({ type: 'info', label: 'Shader', x: col1X, y: y });
  y += gapHeader;

  const shaderOptions = [
    { label: TR('renderingMatcap'), id: Enums.Shader.MATCAP },
    { label: TR('renderingPBR'), id: Enums.Shader.PBR },
    { label: TR('renderingNormal'), id: Enums.Shader.NORMAL },
    { label: TR('renderingUV'), id: Enums.Shader.UV }
  ];

  widgets.push({
    type: 'combobox',
    id: 'shader_type',
    label: 'Shader',
    x: col1X, y: y, w: 400, h: btnH,
    value: main.getMesh() ? main.getMesh().getShaderType() : 0,
    options: shaderOptions,
    onSelect: (id) => {
      if (main.getMesh()) {
        main.getMesh().setShaderType(id);
        main.render();
        if (main.guiXR) main.guiXR._needsUpdate = true;
      }
    }
  });
  y += btnH + gapSection;


  // --- OPTIONS ---
  widgets.push({ type: 'info', label: 'Options', x: col1X, y: y });
  y += gapHeader;

  const mesh = main.getMesh();
  const flat = mesh ? mesh.getFlatShading() : false;
  const wire = mesh ? mesh.getShowWireframe() : false;

  widgets.push({ type: 'slider', id: 'exposure', label: 'Exposure', x: col1X, y: y, w: 400, h: 40, value: 0.2 }); // Corrected value binding needed?
  y += 40 + gapBtn;

  widgets.push({ type: 'slider', id: 'curvature', label: 'Curvature', x: col1X, y: y, w: 400, h: 40, value: 0.2 });
  y += 40 + gapSection;

  widgets.push({ type: 'checkbox', id: 'flat', label: 'Flat Shading', x: col1X, y: y, w: 250, h: btnH, value: flat });
  widgets.push({ type: 'checkbox', id: 'wireframe', label: 'Wireframe', x: 270, y: y, w: 250, h: btnH, value: wire });
  y += btnH + gapSection;


  // --- ENVIRONMENT / MATCAP ---
  widgets.push({ type: 'info', label: 'Env / Matcap', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'combobox', id: 'environment', label: 'Environment', x: col1X, y: y, w: 400, h: btnH });
  y += btnH + gapBtn;
  widgets.push({ type: 'combobox', id: 'matcap', label: 'Matcap', x: col1X, y: y, w: 400, h: btnH });
  y += btnH + gapBtn;

  widgets.push({ type: 'button', id: 'import_matcap', label: 'Import Matcap', x: col1X, y: y, w: 400, h: btnH, disabled: true });
  y += btnH + gapSection;

  return widgets;
}
