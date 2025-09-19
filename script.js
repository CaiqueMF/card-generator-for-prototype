const { jsPDF } = window.jspdf;

let versos = [];
let frentes = [];

/* -----------------------
   Uploads (mesma lógica)
   -----------------------*/
// Upload versos
document.getElementById("versosInput").addEventListener("change", (e) => {
  versos = [];
  const list = document.getElementById("versosList");
  list.innerHTML = "";
  const select = document.getElementById("versoSelecionado");
  select.innerHTML = "";

  Array.from(e.target.files).forEach((file, index) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      versos.push({ name: file.name, src: ev.target.result });
      const li = document.createElement("li");
      li.textContent = file.name;
      list.appendChild(li);

      const opt = document.createElement("option");
      opt.value = index;
      opt.textContent = file.name;
      select.appendChild(opt);
    };
    reader.readAsDataURL(file);
  });
});

// Upload frentes (em lote)
document.getElementById("adicionarLote").addEventListener("click", () => {
  const input = document.getElementById("frentesInput");
  const versoIndex = document.getElementById("versoSelecionado").value;
  if (!input.files.length || versoIndex === "") {
    alert("Envie frentes e selecione um verso para o lote.");
    return;
  }

  const list = document.getElementById("frentesList");

  Array.from(input.files).forEach((file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      frentes.push({
        name: file.name,
        src: ev.target.result,
        verso: versos[versoIndex],
      });
      const li = document.createElement("li");
      li.textContent = `${file.name} (verso: ${versos[versoIndex].name})`;
      list.appendChild(li);
    };
    reader.readAsDataURL(file);
  });

  input.value = ""; // reset input
});

// Mostrar campos custom
document.getElementById("tamanhoPagina").addEventListener("change", (e) => {
  document.getElementById("customSize").style.display =
    e.target.value === "custom" ? "block" : "none";
});

/* -----------------------
   Utilitários
   -----------------------*/
function cmToPt(cm) {
  return cm * 28.346456692913385;
}

function detectImageFormat(dataURL) {
  const m = dataURL.match(/^data:(image\/\w+);base64,/);
  if (!m) return "PNG";
  const mime = m[1];
  if (mime === "image/png") return "PNG";
  if (mime === "image/jpeg" || mime === "image/jpg") return "JPEG";
  return "PNG";
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = src;
  });
}

// Função de desenho com rotação automática + crop marks
async function drawCardWithCrop(pdf, dataUrl, x, y, w, h) {
  const fmt = detectImageFormat(dataUrl);

  // Carregar imagem em <img>
  const img = await loadImage(dataUrl);

  // Proporções
  const cartaRatio = w / h;
  const imgRatio = img.width / img.height;

  let finalDataUrl = dataUrl;

  // Se a orientação da imagem não combina com a da carta → rotacionar
  if ((imgRatio > 1 && cartaRatio < 1) || (imgRatio < 1 && cartaRatio > 1)) {
    const canvas = document.createElement("canvas");
    canvas.width = img.height;
    canvas.height = img.width;
    const ctx = canvas.getContext("2d");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2); // 90 graus
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    finalDataUrl = canvas.toDataURL("image/jpeg", 1.0);
  }

  // Adicionar imagem ao PDF
  try {
    pdf.addImage(finalDataUrl, fmt, x, y, w, h);
  } catch (err) {
    pdf.addImage(finalDataUrl, "PNG", x, y, w, h);
  }

  // crop marks (2 mm)
  const mark = cmToPt(0.2);

  // top-left
  pdf.line(x - mark, y, x, y);
  pdf.line(x, y - mark, x, y);

  // top-right
  pdf.line(x + w, y - mark, x + w, y);
  pdf.line(x + w, y, x + w + mark, y);

  // bottom-left
  pdf.line(x - mark, y + h, x, y + h);
  pdf.line(x, y + h, x, y + h + mark);

  // bottom-right
  pdf.line(x + w, y + h, x + w + mark, y + h);
  pdf.line(x + w, y + h, x + w, y + h + mark);
}

/* -----------------------
   Geração do PDF
   -----------------------*/
document.getElementById("gerarPDF").addEventListener("click", async () => {
  if (!frentes.length) {
    alert("Adicione frentes antes de gerar o PDF!");
    return;
  }

  const cartaWcm = parseFloat(document.getElementById("larguraCarta").value);
  const cartaHcm = parseFloat(document.getElementById("alturaCarta").value);
  const cartaWpt0 = cmToPt(cartaWcm);
  const cartaHpt0 = cmToPt(cartaHcm);

  let pageWpt, pageHpt;
  const tamanho = document.getElementById("tamanhoPagina").value;
  if (tamanho === "A4") {
    pageWpt = cmToPt(21.0);
    pageHpt = cmToPt(29.7);
  } else if (tamanho === "A3") {
    pageWpt = cmToPt(29.7);
    pageHpt = cmToPt(42.0);
  } else {
    pageWpt = cmToPt(parseFloat(document.getElementById("larguraPaginaCustom").value));
    pageHpt = cmToPt(parseFloat(document.getElementById("alturaPaginaCustom").value));
  }

  const margemCm = 1.5;
  const margem = cmToPt(margemCm);

  const usableW = pageWpt - 2 * margem;
  const usableH = pageHpt - 2 * margem;

  function evaluateOrientation(w, h) {
    const cols = Math.floor(usableW / w);
    const rows = Math.floor(usableH / h);
    const total = cols * rows;
    const gapX = cols > 1 ? (usableW - cols * w) / (cols - 1) : 0;
    const gapY = rows > 1 ? (usableH - rows * h) / (rows - 1) : 0;
    return { w, h, cols, rows, total, gapX, gapY };
  }

  const optNormal = evaluateOrientation(cartaWpt0, cartaHpt0);
  const optRot = evaluateOrientation(cartaHpt0, cartaWpt0);

  let best = optNormal.total > optRot.total ? optNormal : optRot;

  if (best.total === 0) {
    alert("As cartas não cabem no papel com as dimensões escolhidas.");
    return;
  }

  const cartaW = best.w;
  const cartaH = best.h;
  const cols = best.cols;
  const rows = best.rows;
  const porPagina = cols * rows;
  const gapX = best.gapX;
  const gapY = best.gapY;

  function posXY(col, row) {
    const x = margem + col * (cartaW + gapX);
    const y = margem + row * (cartaH + gapY);
    return { x, y };
  }

  const pdf = new jsPDF({
    orientation: pageWpt > pageHpt ? "landscape" : "portrait",
    unit: "pt",
    format: [pageWpt, pageHpt],
  });

  for (let i = 0; i < frentes.length; i += porPagina) {
    const lote = frentes.slice(i, i + porPagina);

    // Frente
    pdf.addPage([pageWpt, pageHpt]);
    for (let idx = 0; idx < lote.length; idx++) {
      const carta = lote[idx];
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const { x, y } = posXY(col, row);
      await drawCardWithCrop(pdf, carta.src, x, y, cartaW, cartaH);
    }

    // Verso (espelhado horizontalmente)
    pdf.addPage([pageWpt, pageHpt]);
    for (let idx = 0; idx < lote.length; idx++) {
      const carta = lote[idx];
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const mirrorCol = cols - 1 - col;
      const { x, y } = posXY(mirrorCol, row);
      await drawCardWithCrop(pdf, carta.verso.src, x, y, cartaW, cartaH);
    }
  }

  try {
    pdf.deletePage(1); // remove página inicial vazia
  } catch {}

  pdf.save("cartas.pdf");
});
