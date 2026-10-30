// Botão "Compartilhar" do gráfico de produção: gera um PNG e abre o compartilhamento do celular
// (Web Share API). Onde o navegador não compartilha arquivos, baixa a imagem.
(function () {
  const botao = document.getElementById('compartilhar');
  const dadosEl = document.getElementById('dados-grafico');
  if (!botao || !dadosEl) return;
  const aviso = document.getElementById('compartilhar-aviso');
  const { baldes, escala, maior, compartilhar: info } = JSON.parse(dadosEl.textContent);

  // Sempre no tema claro: a imagem precisa ficar legível em qualquer conversa
  const COR = { fundo: '#ffffff', texto: '#2b2620', sutil: '#776d60', grade: '#e3dacb', barra: '#a9671a' };
  const FONTE = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const W = 1080;
  const H = 1350; // 4:5, bom para WhatsApp e redes sociais
  const P = 64;
  const fmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

  // Escreve o texto e reduz a fonte (até um mínimo) se não couber na largura
  function texto(ctx, conteudo, x, y, { tamanho, peso = 400, cor = COR.texto, alinhar = 'left', largura = W - 2 * P, minimo = 22 }) {
    let t = tamanho;
    do {
      ctx.font = `${peso} ${t}px ${FONTE}`;
      if (ctx.measureText(conteudo).width <= largura) break;
      t -= 2;
    } while (t > minimo);
    let s = conteudo;
    while (ctx.measureText(s).width > largura && s.length > 1) s = s.slice(0, -2) + '…';
    ctx.fillStyle = cor;
    ctx.textAlign = alinhar;
    ctx.fillText(s, x, y);
  }

  function desenhar() {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = COR.fundo;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';

    // Cabeçalho
    texto(ctx, '🥚 Eggsystem', P, 92, { tamanho: 30, peso: 600, cor: COR.sutil });
    texto(ctx, info.produto, P, 168, { tamanho: 60, peso: 700 });
    texto(ctx, info.subtitulo, P, 218, { tamanho: 30, cor: COR.sutil });

    const linha = (y) => { ctx.fillStyle = COR.grade; ctx.fillRect(P, y, W - 2 * P, 2); };
    linha(252);

    // Números do topo: rótulo à esquerda, valor à direita
    info.numeros.forEach(([rotulo, valor], i) => {
      const y = 312 + i * 70;
      texto(ctx, rotulo, P, y, { tamanho: 32, cor: COR.sutil, largura: 360 });
      texto(ctx, valor, W - P, y, { tamanho: 36, peso: 700, alinhar: 'right', largura: W - 2 * P - 380 });
    });
    linha(486);

    // Gráfico de barras (mesma escala da tela)
    const area = { esq: P + 90, dir: W - P, topo: 560, base: H - 150 };
    const ph = area.base - area.topo;
    const pw = area.dir - area.esq;
    const y = (v) => area.base - (v / escala.topo) * ph;

    for (let v = 0; v <= escala.topo + 1e-9; v += escala.passo) {
      ctx.fillStyle = COR.grade;
      ctx.fillRect(area.esq, Math.round(y(v)) - 1, pw, 2);
      texto(ctx, fmt.format(v), area.esq - 14, y(v) + 9, { tamanho: 26, cor: COR.sutil, alinhar: 'right', largura: 90 });
    }

    const banda = pw / baldes.length;
    const largura = Math.max(4, Math.min(48, banda - 4));
    const cadaRotulo = Math.ceil(baldes.length / 6);
    baldes.forEach((b, i) => {
      const cx = area.esq + banda * i + banda / 2;
      const x = cx - largura / 2;
      const topo = y(b.valor);
      if (b.valor > 0) {
        const r = Math.min(8, (area.base - topo) / 2, largura / 2); // ponta arredondada, base reta
        ctx.fillStyle = COR.barra;
        ctx.beginPath();
        ctx.moveTo(x, area.base);
        ctx.lineTo(x, topo + r);
        ctx.quadraticCurveTo(x, topo, x + r, topo);
        ctx.lineTo(x + largura - r, topo);
        ctx.quadraticCurveTo(x + largura, topo, x + largura, topo + r);
        ctx.lineTo(x + largura, area.base);
        ctx.closePath();
        ctx.fill();
      }
      if (b.inicio === maior) {
        texto(ctx, fmt.format(b.valor), cx, topo - 14, { tamanho: 28, peso: 700, alinhar: 'center', largura: 200 });
      }
      if ((baldes.length - 1 - i) % cadaRotulo === 0) {
        texto(ctx, b.rotulo, cx, area.base + 44, { tamanho: 26, cor: COR.sutil, alinhar: 'center', largura: Math.max(banda * cadaRotulo - 8, 60) });
      }
    });

    texto(ctx, info.rodape, P, H - 40, { tamanho: 24, cor: COR.sutil });
    return canvas;
  }

  // Gera o arquivo já ao abrir a página (o Safari exige que o compartilhamento comece logo no toque)
  let arquivo = null;
  const pronto = new Promise((resolve) => {
    desenhar().toBlob((blob) => {
      arquivo = blob && new File([blob], `${info.arquivo}.png`, { type: 'image/png' });
      resolve(arquivo);
    }, 'image/png');
  });

  function baixar(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    aviso.textContent = 'Imagem baixada: anexe ela na conversa.';
  }

  botao.addEventListener('click', async () => {
    aviso.textContent = '';
    const file = arquivo || (await pronto);
    if (!file) { aviso.textContent = 'Não foi possível gerar a imagem.'; return; }
    const dados = { files: [file], title: info.produto, text: info.texto };
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share(dados);
      } catch (err) {
        if (err.name === 'AbortError') return; // a pessoa fechou a tela de compartilhar
        baixar(file); // ex.: navegador recusou; entrega a imagem mesmo assim
      }
    } else {
      baixar(file);
    }
  });
})();
