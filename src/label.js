import * as THREE from 'three';

// Draws the wrap-around label: white ink on a transparent sheet.
// `ratio` is label width / label height (circumference / printed height).
export function makeLabelTexture(ratio) {
  const H = 1400;
  const W = Math.round(H * ratio);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  const INK = '#f1f1ee';
  const SERIF = '"Bodoni 72", Didot, "Playfair Display", "Times New Roman", Georgia, serif';
  const MONO = '"Courier New", Courier, "American Typewriter", monospace';
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.textBaseline = 'alphabetic';

  const spaced = (text, x, y, spacing, align = 'center') => {
    // letter-spaced text, measured by hand so it works in every browser
    const widths = [...text].map((ch) => g.measureText(ch).width + spacing);
    const total = widths.reduce((a, b) => a + b, 0) - spacing;
    let cx = align === 'center' ? x - total / 2 : x;
    g.textAlign = 'left';
    [...text].forEach((ch, i) => { g.fillText(ch, cx, y); cx += widths[i]; });
  };

  // ----- front panel -----
  {
    const cx = W * 0.25;
    g.font = `bold 46px ${MONO}`;
    spaced('MIXED TOCOPHEROLS', cx, 170, 9);
    g.fillRect(cx - 330, 205, 660, 5);

    g.font = `900 900px ${SERIF}`;
    g.textAlign = 'center';
    g.fillText('E', cx, 905);

    g.fillRect(cx - 330, 975, 660, 5);
    g.font = `bold 96px ${SERIF}`;
    g.textAlign = 'center';
    g.fillText('vitamin e', cx, 1085);

    g.font = `bold 40px ${MONO}`;
    spaced('pure oil', cx, 1165, 6);
    g.font = `bold 34px ${MONO}`;
    spaced('30 ml / 1.0 fl oz', cx, 1265, 3);
  }

  // ----- back panel: facts table -----
  {
    const cx = W * 0.75;
    const w = 760, x0 = cx - w / 2, y0 = 170, h = 1010;
    g.lineWidth = 6;
    g.strokeRect(x0, y0, w, h);

    g.font = `bold 62px ${MONO}`;
    g.textAlign = 'left';
    g.fillText('supplement facts', x0 + 26, y0 + 82);
    g.fillRect(x0, y0 + 108, w, 14);

    g.font = `bold 36px ${MONO}`;
    g.fillText('serving size:', x0 + 26, y0 + 172);
    g.fillText('servings per bottle:', x0 + 26, y0 + 222);
    g.textAlign = 'right';
    g.fillText('1 drop', x0 + w - 26, y0 + 172);
    g.fillText('~600', x0 + w - 26, y0 + 222);
    g.fillRect(x0, y0 + 246, w, 8);

    g.font = `bold 30px ${MONO}`;
    g.fillText('amount     % daily', x0 + w - 26, y0 + 296);
    g.fillText('per drop      value', x0 + w - 26, y0 + 332);
    g.fillRect(x0, y0 + 352, w, 4);

    const rows = [
      ['d-alpha tocopherol', '15 mg', '100%'],
      ['d-beta tocopherol', '1 mg', '†'],
      ['d-gamma tocopherol', '24 mg', '†'],
      ['d-delta tocopherol', '9 mg', '†'],
      ['tocotrienols', '2 mg', '†'],
      ['squalane (olive)', '11 mg', '†'],
    ];
    const rowH = 92, top = y0 + 356;
    g.font = `bold 34px ${MONO}`;
    rows.forEach(([name, amount, dv], i) => {
      const y = top + rowH * i;
      g.textAlign = 'left';
      g.fillText(name, x0 + 26, y + 60);
      g.textAlign = 'right';
      g.fillText(amount, x0 + w - 150, y + 60);
      g.fillText(dv, x0 + w - 26, y + 60);
      g.fillRect(x0, y + rowH - 2, w, 4);
    });
    g.fillRect(x0 + w - 300, top, 4, rowH * rows.length);
    g.fillRect(x0 + w - 132, top, 4, rowH * rows.length);

    g.font = `bold 26px ${MONO}`;
    g.textAlign = 'left';
    g.fillText('† daily value not established', x0 + 26, top + rowH * rows.length + 56);

    g.font = `bold 30px ${MONO}`;
    spaced('no fillers / no fragrance', cx, 1262, 3);
  }

  // ----- side strips (vertical text) -----
  const vertical = (x, text, font, spacing) => {
    g.save();
    g.translate(x, H / 2);
    g.rotate(-Math.PI / 2);
    g.font = font;
    spaced(text, 0, 0, spacing);
    g.restore();
  };
  vertical(W * 0.432, 'tocopherol  tocopherol  tocopherol', `bold 58px ${MONO}`, 4);

  // ----- emblem between the panels: a sunflower head (the oil's source) -----
  {
    const cx = W * 0.515, cy = 470, R = 150;
    g.lineWidth = 5;
    for (let i = 0; i < 21; i++) {
      const a = (i / 21) * Math.PI * 2;
      g.save();
      g.translate(cx, cy);
      g.rotate(a);
      g.beginPath();
      g.moveTo(R * 0.6, 0);
      g.quadraticCurveTo(R * 0.86, -R * 0.14, R * 1.2, 0);
      g.quadraticCurveTo(R * 0.86, R * 0.14, R * 0.6, 0);
      g.stroke();
      g.restore();
    }
    for (let i = 1; i < 150; i++) {
      const rr = R * 0.56 * Math.sqrt(i / 150), a = i * 2.39996;
      g.beginPath();
      g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2.2 + 3.2 * (i / 150), 0, Math.PI * 2);
      g.fill();
    }
    g.font = `bold 34px ${MONO}`;
    spaced('cold pressed', cx, 760, 3);
    spaced('from sunflower', cx, 812, 3);
    g.fillRect(cx - 120, 850, 240, 4);
    g.font = `bold 30px ${MONO}`;
    spaced('batch 05', cx, 905, 3);
    spaced('made in small', cx, 1010, 2);
    spaced('quantities', cx, 1052, 2);
  }
  vertical(W * 0.018 + 20, 'ingredients: mixed tocopherols, squalane.', `bold 30px ${MONO}`, 2);
  vertical(W * 0.982 + 6, 'store cool and dark. external and food use.', `bold 30px ${MONO}`, 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}
