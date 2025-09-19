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
  // 1 inch = 2.54 cm; 1 pt = 1/72 inch -> 72 / 2.54 = 28.3464566929
  return cm * 28.346456692913385;
}

function detectImageFormat(dataURL) {
  const m = dataURL.match(/^data:(image\/\w+);base64,/);
  if (!m) return "PNG";
  const mime = m[1];
  if (mime === "image/png") return "PNG";
  if (mime === "image/jpeg" || mime === "image/jpg") return "JPEG";
  // fallback
  return "PNG";
}

/* -----------------------
   Geração do PDF (novo algoritmo)
   -----------------------*/
document.getElementById("gerarPDF").addEventListener("click", () => {
  if (!frentes.length) {
    alert("Adicione frentes antes de gerar o PDF!");
    return;
  }

  // Dimensões carta (cm -> pt)
  const cartaWcm = parseFloat(document.getElementById("larguraCarta").value);
  const cartaHcm = parseFloat(document.getElementById("alturaCarta").value);
  const cartaWpt0 = cmToPt(cartaWcm);
  const cartaHpt0 = cmToPt(cartaHcm);

  // Dimensões página
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

  // Margem mínima em cm -> pt (fixo 1.5cm por requisito)
  const margemCm = 1.5;
  const margem = cmToPt(margemCm);

  // Área útil (dentro das margens)
  const usableW = pageWpt - 2 * margem;
  const usableH = pageHpt - 2 * margem;

  // Avalia a melhor orientação (normal ou rotacionada), priorizando:
  // 1) maior número de cartas por página, 2) maior menor folga entre cartas (minGap)
  function evaluateOrientation(w, h, tag) {
    const cols = Math.floor(usableW / w);
    const rows = Math.floor(usableH / h);
    const total = cols * rows;

    // gaps internos possíveis
    const gapX = cols > 1 ? (usableW - cols * w) / (cols - 1) : null;
    const gapY = rows > 1 ? (usableH - rows * h) / (rows - 1) : null;

    let minGap;
    if (cols > 1 && rows > 1) minGap = Math.min(gapX, gapY);
    else if (cols > 1) minGap = gapX;
    else if (rows > 1) minGap = gapY;
    else {
      // single card per page — "espaçamento interno" não existe; usar distância mínima até borda como métrica
      const dx = (usableW - w) / 2;
      const dy = (usableH - h) / 2;
      minGap = Math.min(dx, dy);
    }

    return { tag, w, h, cols, rows, total, gapX, gapY, minGap };
  }

  const optNormal = evaluateOrientation(cartaWpt0, cartaHpt0, "normal");
  const optRot = evaluateOrientation(cartaHpt0, cartaWpt0, "rot");

  // escolher por total primeiro, depois por minGap
  let best;
  if (optNormal.total > optRot.total) best = optNormal;
  else if (optRot.total > optNormal.total) best = optRot;
  else {
    // tie -> escolher maior minGap
    best = (optNormal.minGap >= optRot.minGap) ? optNormal : optRot;
  }

  if (best.total === 0) {
    alert(
      `Não cabe nenhuma carta com as dimensões fornecidas respeitando a margem de ${margemCm} cm.\n` +
        "Reduza as dimensões da carta ou diminua a margem/papel."
    );
    return;
  }

  // Adotar dimensões e grid escolhidos
  let cartaW = best.w;
  let cartaH = best.h;
  const cols = best.cols;
  const rows = best.rows;
  const porPagina = cols * rows;

  // Calcular gaps internos (distribuir *toda* folga entre cartas, deixando borda = margem)
  const gapX = cols > 1 ? (usableW - cols * cartaW) / (cols - 1) : 0;
  const gapY = rows > 1 ? (usableH - rows * cartaH) / (rows - 1) : 0;

  // Método pra calcular x,y de uma posição (col,row)
  function posXY(col, row) {
    let x, y;
    if (cols > 1) {
      x = margem + col * (cartaW + gapX);
    } else {
      // centraliza horizontalmente dentro da area útil (porque não há gap interno)
      x = margem + (usableW - cartaW) / 2;
    }

    if (rows > 1) {
      y = margem + row * (cartaH + gapY);
    } else {
      // centraliza verticalmente dentro da area útil
      y = margem + (usableH - cartaH) / 2;
    }

    return { x, y };
  }

  // Função de desenho com crop marks
  function drawCardWithCrop(pdf, dataUrl, x, y, w, h) {
    const fmt = detectImageFormat(dataUrl);
    // No jsPDF, formato espera "PNG" ou "JPEG"
    try {
      pdf.addImage(dataUrl, fmt, x, y, w, h);
    } catch (err) {
      // fallback se falhar
      pdf.addImage(dataUrl, "PNG", x, y, w, h);
    }

    // crop marks (2 mm)
    const mark = cmToPt(0.2);

    // top-left
    pdf.line(x - mark, y, x, y); // pequena linha horizontal vindo de fora
    pdf.line(x, y - mark, x, y); // pequena linha vertical vindo de fora

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

  // Criar PDF e adicionar páginas: para cada lote -> frente em uma página, verso na próxima
  const pdf = new jsPDF({
    orientation: pageWpt > pageHpt ? "landscape" : "portrait",
    unit: "pt",
    format: [pageWpt, pageHpt],
  });

  // Observação: o jsPDF cria já uma página vazia inicial; vamos adicionar páginas para cada lote e remover a primeira ao final
  for (let i = 0; i < frentes.length; i += porPagina) {
    const lote = frentes.slice(i, i + porPagina);

    // Frente
    pdf.addPage([pageWpt, pageHpt]); // cria página para frente
    lote.forEach((carta, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const { x, y } = posXY(col, row);
      drawCardWithCrop(pdf, carta.src, x, y, cartaW, cartaH);
    });

    // Verso (espelhado horizontalmente): coluna espelho
    pdf.addPage([pageWpt, pageHpt]); // página para verso
    lote.forEach((carta, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const mirrorCol = cols - 1 - col;
      const { x, y } = posXY(mirrorCol, row);
      drawCardWithCrop(pdf, carta.verso.src, x, y, cartaW, cartaH);
    });
  }

  // remover a primeira página vazia criada pelo constructor do jsPDF
  try {
    pdf.deletePage(1);
  } catch (e) {
    // se falhar, não crítico
  }

  pdf.save("cartas.pdf");
});
